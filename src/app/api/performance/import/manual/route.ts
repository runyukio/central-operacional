import { NextResponse } from "next/server";
import crypto from "node:crypto";
import * as XLSX from "xlsx";

import { getApiActor } from "@/lib/api-actor";
import { prisma } from "@/lib/prisma";
import {
  authorizePerformanceImport,
  commitCecCpdManualPreviewImport,
  commitProductionManualPreviewImport,
  discardQualitySnapshotImport,
  finalizeQualitySnapshotImport,
  importQualitySnapshotChunk,
  PerformanceError,
  previewCecCpdImport,
  previewProductionImport,
  replacePerformanceSnapshot,
  startQualitySnapshotImport,
  type PerformanceQualityScope,
  type PerformancePreviewRow
} from "@/lib/performance-service";
import { processFirstWorksheetInChunks, XlsxChunkError } from "@/lib/xlsx-row-chunks";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

const MAX_CHUNK_BYTES = 2.5 * 1024 * 1024;
const MAX_OPERATIONAL_FILE_BYTES = 30 * 1024 * 1024;
const MAX_QUALITY_FILE_BYTES = 250 * 1024 * 1024;
const MAX_OPERATIONAL_FILE_ROWS = 250_000;
const MAX_QUALITY_FILE_ROWS = 1_000_000;
const QUALITY_PROCESSING_CHUNK_ROWS = 10_000;
const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;

type PreviewedFile = {
  fileName: string;
  rows: PerformancePreviewRow[];
};

export async function POST(request: Request) {
  const url = new URL(request.url);
  const action = url.searchParams.get("action")?.trim().toLowerCase();
  try {
    const actor = await getApiActor();
    const importUser = await authorizePerformanceImport(actor);

    if (action === "start") {
      await prisma.performanceManualUploadChunk.deleteMany({
        where: { createdAt: { lt: new Date(Date.now() - UPLOAD_TTL_MS) } }
      });
      return NextResponse.json({ success: true, uploadId: crypto.randomUUID() });
    }

    if (action === "chunk") {
      return receiveUploadChunk(request, url, importUser.email);
    }

    if (action === "finalize") {
      const uploadId = requiredUploadId(url);
      const qualityScope = readQualityScope(url);
      try {
        const uploadedFiles = await rebuildUploadedFiles(uploadId, importUser.email);
        const hasOperationalFiles = Boolean(uploadedFiles.production || uploadedFiles.volume || uploadedFiles.cecCpd);
        if (hasOperationalFiles && (!uploadedFiles.production || !uploadedFiles.volume || !uploadedFiles.cecCpd)) {
          throw new PerformanceError("As bases Produção / Output, Filas / Input e CEC CPD / Output devem ser enviadas juntas.", 400);
        }
        const operationalResult = uploadedFiles.production && uploadedFiles.volume && uploadedFiles.cecCpd
          ? await processPerformanceFiles(actor, uploadedFiles.production, uploadedFiles.volume, uploadedFiles.cecCpd)
          : null;
        const qualityResult = uploadedFiles.quality
          ? await processQualityFile(actor, uploadedFiles.quality, qualityScope)
          : null;
        if (!operationalResult && !qualityResult) throw new PerformanceError("Nenhum arquivo válido foi recebido.", 400);
        return NextResponse.json({ success: true, ...(operationalResult ?? {}), ...(qualityResult ?? {}) });
      } finally {
        await prisma.performanceManualUploadChunk.deleteMany({ where: { uploadId, uploadedByEmail: importUser.email } });
      }
    }

    const formData = await request.formData();
    const productionFile = readXlsxFile(formData.get("productionFile"), "Produção / Output");
    const volumeFile = readXlsxFile(formData.get("volumeFile"), "Filas / Input");
    const cecCpdFile = readXlsxFile(formData.get("cecCpdFile"), "CEC CPD / Output");
    return NextResponse.json(await processPerformanceFiles(actor, {
      fileName: productionFile.name,
      buffer: await productionFile.arrayBuffer()
    }, {
      fileName: volumeFile.name,
      buffer: await volumeFile.arrayBuffer()
    }, {
      fileName: cecCpdFile.name,
      buffer: await cecCpdFile.arrayBuffer()
    }));
  } catch (error) {
    if (error instanceof PerformanceError) {
      return NextResponse.json({ success: false, error: error.message, message: error.message }, { status: error.status });
    }
    console.error("[performance/import/manual] erro inesperado", error);
    return NextResponse.json({
      success: false,
      error: "Não foi possível substituir a base manual de Performance.",
      message: "Não foi possível substituir a base manual de Performance."
    }, { status: 500 });
  }
}

async function receiveUploadChunk(request: Request, url: URL, uploadedByEmail: string) {
  const uploadId = requiredUploadId(url);
  const fileType = url.searchParams.get("fileType");
  if (fileType !== "production" && fileType !== "volume" && fileType !== "cecCpd" && fileType !== "quality") throw new PerformanceError("Tipo de arquivo inválido.", 400);
  const chunkIndex = integerParam(url, "chunkIndex", 0);
  const totalChunks = integerParam(url, "totalChunks", 1);
  if (chunkIndex >= totalChunks) throw new PerformanceError("Índice da parte do arquivo inválido.", 400);
  const fileName = (url.searchParams.get("fileName") ?? "").trim();
  if (!fileName.toLowerCase().endsWith(".xlsx")) throw new PerformanceError("O arquivo enviado deve ser XLSX.", 400);
  const buffer = await request.arrayBuffer();
  if (!buffer.byteLength) throw new PerformanceError("A parte enviada está vazia.", 400);
  if (buffer.byteLength > MAX_CHUNK_BYTES) throw new PerformanceError("Parte do arquivo acima do limite de 2,5 MB.", 413);

  await prisma.performanceManualUploadChunk.upsert({
    where: { uploadId_fileType_chunkIndex: { uploadId, fileType, chunkIndex } },
    create: {
      uploadId,
      uploadedByEmail,
      fileType,
      fileName,
      chunkIndex,
      totalChunks,
      data: Buffer.from(buffer)
    },
    update: {
      uploadedByEmail,
      fileName,
      totalChunks,
      data: Buffer.from(buffer),
      createdAt: new Date()
    }
  });
  return NextResponse.json({ success: true, uploadId, fileType, chunkIndex, totalChunks });
}

async function rebuildUploadedFiles(uploadId: string, uploadedByEmail: string) {
  const chunks = await prisma.performanceManualUploadChunk.findMany({
    where: { uploadId, uploadedByEmail },
    orderBy: [{ fileType: "asc" }, { chunkIndex: "asc" }]
  });
  if (!chunks.length) throw new PerformanceError("Nenhuma parte do upload foi encontrada.", 400);

  const rebuild = (fileType: "production" | "volume" | "cecCpd" | "quality") => {
    const fileChunks = chunks.filter((chunk) => chunk.fileType === fileType);
    if (!fileChunks.length) return null;
    const expected = fileChunks[0].totalChunks;
    if (fileChunks.length !== expected || fileChunks.some((chunk, index) => chunk.chunkIndex !== index || chunk.totalChunks !== expected)) {
      throw new PerformanceError(`O arquivo ${fileChunks[0].fileName} está incompleto. Envie novamente.`, 400);
    }
    const data = Buffer.concat(fileChunks.map((chunk) => Buffer.from(chunk.data)));
    const maxBytes = fileType === "quality" ? MAX_QUALITY_FILE_BYTES : MAX_OPERATIONAL_FILE_BYTES;
    if (data.byteLength > maxBytes) {
      throw new PerformanceError(
        `${fileChunks[0].fileName} excede o limite de ${Math.round(maxBytes / 1024 / 1024)} MB.`,
        413
      );
    }
    return { fileName: fileChunks[0].fileName, buffer: data };
  };

  return { production: rebuild("production"), volume: rebuild("volume"), cecCpd: rebuild("cecCpd"), quality: rebuild("quality") };
}

async function processQualityFile(
  actor: Awaited<ReturnType<typeof getApiActor>>,
  qualityFile: { fileName: string; buffer: Buffer },
  qualityScope: PerformanceQualityScope
) {
  const stagingBatch = await startQualitySnapshotImport(actor, qualityFile.fileName, qualityScope);
  let qualityRows = 0;
  let qualityRowsError = 0;
  let qualityRowsIgnored = 0;
  try {
    await processFirstWorksheetInChunks(qualityFile.buffer, {
      chunkRows: QUALITY_PROCESSING_CHUNK_ROWS,
      maxRows: MAX_QUALITY_FILE_ROWS,
      onChunk: async ({ rows, rowNumberOffset }) => {
        const result = await importQualitySnapshotChunk(
          actor,
          rows,
          qualityFile.fileName,
          stagingBatch.id,
          rowNumberOffset,
          qualityScope
        );
        qualityRows += result.imported.importedRows;
        qualityRowsError += result.preview.errorRows;
        qualityRowsIgnored += Math.max(
          0,
          result.preview.totalRows - result.imported.importedRows - result.preview.errorRows
        );
      }
    });
    const reset = await finalizeQualitySnapshotImport(actor, stagingBatch.id, qualityScope);
    return {
      qualityScope,
      qualityRows,
      qualityRowsError,
      qualityRowsIgnored,
      qualityBatchId: stagingBatch.id,
      qualityReset: reset
    };
  } catch (error) {
    await discardQualitySnapshotImport(actor, stagingBatch.id, qualityScope).catch((discardError) => {
      console.error("[performance/import/manual] falha ao descartar lote incompleto de Qualidade", discardError);
    });
    if (error instanceof XlsxChunkError) {
      throw new PerformanceError(error.message, /excede o limite/i.test(error.message) ? 413 : 400);
    }
    throw error;
  }
}

function readQualityScope(url: URL): PerformanceQualityScope {
  const scope = url.searchParams.get("qualityScope")?.trim().toUpperCase();
  if (scope === "CEC") return "CEC";
  return scope === "TNS" ? "TNS" : "ADS";
}

async function processPerformanceFiles(
  actor: Awaited<ReturnType<typeof getApiActor>>,
  productionFile: { fileName: string; buffer: Buffer | ArrayBuffer },
  volumeFile: { fileName: string; buffer: Buffer | ArrayBuffer },
  cecCpdFile: { fileName: string; buffer: Buffer | ArrayBuffer }
) {
  const previews: PreviewedFile[] = [];

  for (const file of [productionFile, volumeFile]) {
    const rawRows = readWorkbookRows(file.buffer);
    const preview = await previewProductionImport(actor, rawRows, { skipExistingCheck: true });
    previews.push({ fileName: file.fileName, rows: preview.rows });
  }
  const cecCpdPreview = await previewCecCpdImport(actor, readWorkbookRows(cecCpdFile.buffer), { skipExistingCheck: true });
  previews.push({ fileName: cecCpdFile.fileName, rows: cecCpdPreview.rows });

  const coverage = summarizeCoverage(previews);
  if (!coverage.productionRows || !coverage.volumeRows || !coverage.cecCpdRows) {
    throw new PerformanceError(
      "As três bases são obrigatórias: Produção / Output precisa conter submit, Filas / Input precisa conter enqueue e CEC CPD / Output precisa conter tickets.",
      400
    );
  }

  let batchId: string | undefined;
  const imports = [];
  const batchFileName = `${productionFile.fileName} + ${volumeFile.fileName} + ${cecCpdFile.fileName}`;
  for (const [index, preview] of previews.slice(0, 2).entries()) {
    const result = await commitProductionManualPreviewImport(
      actor,
      preview.rows,
      index === 0 ? batchFileName : preview.fileName,
      batchId
    );
    batchId = result.batchId;
    imports.push({
      fileName: preview.fileName,
      importedRows: result.importedRows,
      productionRows: result.productionRows,
      volumeRows: result.volumeRows
    });
  }
  const cecCpdResult = await commitCecCpdManualPreviewImport(
    actor,
    cecCpdPreview.rows,
    cecCpdFile.fileName,
    batchId
  );
  batchId = cecCpdResult.batchId;
  imports.push({
    fileName: cecCpdFile.fileName,
    importedRows: cecCpdResult.importedRows,
    productionRows: 0,
    volumeRows: 0,
    cecCpdRows: cecCpdResult.cecCpdRows
  });

  if (!batchId) throw new PerformanceError("Não foi possível criar o lote manual de Performance.", 500);
  const reset = await replacePerformanceSnapshot(actor, batchId);
  return {
    success: true,
    batchId,
    productionRows: coverage.productionRows,
    volumeRows: coverage.volumeRows,
    cecCpdRows: coverage.cecCpdRows,
    rowsError: coverage.rowsError,
    files: imports,
    reset
  };
}

function requiredUploadId(url: URL) {
  const uploadId = url.searchParams.get("uploadId")?.trim() ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(uploadId)) throw new PerformanceError("Identificador do upload inválido.", 400);
  return uploadId;
}

function integerParam(url: URL, name: string, minimum: number) {
  const value = Number(url.searchParams.get(name));
  if (!Number.isInteger(value) || value < minimum) throw new PerformanceError(`Parâmetro ${name} inválido.`, 400);
  return value;
}

function readXlsxFile(value: FormDataEntryValue | null, label: string) {
  if (!(value instanceof File) || !value.size) throw new PerformanceError(`Selecione o arquivo de ${label}.`, 400);
  if (!value.name.toLowerCase().endsWith(".xlsx")) throw new PerformanceError(`${label} deve ser um arquivo XLSX.`, 400);
  if (value.size > MAX_OPERATIONAL_FILE_BYTES) throw new PerformanceError(`${label} excede o limite de 30 MB.`, 413);
  return value;
}

function readWorkbookRows(buffer: Buffer | ArrayBuffer) {
  const workbook = XLSX.read(buffer, { cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : null;
  if (!sheet) throw new PerformanceError("Planilha de Performance não encontrada no arquivo.", 400);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: true });
  if (!rows.length) throw new PerformanceError("A planilha enviada está vazia.", 400);
  if (rows.length > MAX_OPERATIONAL_FILE_ROWS) throw new PerformanceError("A planilha excede o limite de 250.000 linhas.", 413);
  return rows;
}

function summarizeCoverage(files: PreviewedFile[]) {
  let productionRows = 0;
  let volumeRows = 0;
  let cecCpdRows = 0;
  let rowsError = 0;
  for (const file of files) {
    for (const row of file.rows) {
      if (row.errors.length) {
        rowsError += 1;
        continue;
      }
      if (row.type === "PRODUCTION") productionRows += 1;
      if (row.type === "PRODUCTION_VOLUME") volumeRows += 1;
      if (row.type === "CEC_CPD") cecCpdRows += 1;
    }
  }
  return { productionRows, volumeRows, cecCpdRows, rowsError };
}
