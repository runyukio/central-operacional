import { NextResponse } from "next/server";
import crypto from "node:crypto";
import * as XLSX from "xlsx";

import { getApiActor } from "@/lib/api-actor";
import { prisma } from "@/lib/prisma";
import {
  authorizePerformanceImport,
  discardQualitySnapshotImport,
  finalizeQualitySnapshotImport,
  importQualitySnapshotChunk,
  PerformanceError,
  previewCecCpdImport,
  previewProductionImport,
  startQualitySnapshotImport,
  type PerformanceQualityScope
} from "@/lib/performance-service";
import { processFirstWorksheetInChunks, XlsxChunkError } from "@/lib/xlsx-row-chunks";
import { prepareCecFrtSnapshot } from "@/lib/cec-frt-service";
import { performanceManualBases, validateManualFileManifest, type PerformanceManualBase } from "@/lib/performance-manual-bases";
import { replaceSelectedManualSnapshots, type ManualSnapshotFiles } from "@/lib/performance-manual-snapshot";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

const MAX_CHUNK_BYTES = 2.5 * 1024 * 1024;
const MAX_OPERATIONAL_FILE_BYTES = 30 * 1024 * 1024;
const MAX_QUALITY_FILE_BYTES = 250 * 1024 * 1024;
const MAX_OPERATIONAL_FILE_ROWS = 250_000;
const MAX_QUALITY_FILE_ROWS = 1_000_000;
const QUALITY_PROCESSING_CHUNK_ROWS = 10_000;
const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;

type UploadedFile = { fileName: string; buffer: Buffer | ArrayBuffer };
type UploadedBases = Partial<Record<PerformanceManualBase, UploadedFile | null>>;

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
      return await receiveUploadChunk(request, url, importUser.email);
    }

    if (action === "finalize") {
      const uploadId = requiredUploadId(url);
      const qualityScope = readQualityScope(url);
      try {
        const uploadedFiles = await rebuildUploadedFiles(uploadId, importUser.email);
        try {
          validateManualFileManifest(url.searchParams.get("fileTypes"), Object.entries(uploadedFiles).filter(([, file]) => file).map(([key]) => key));
        } catch (error) {
          throw new PerformanceError((error as Error).message, 400);
        }
        const hasOperationalFiles = performanceManualBases.some((base) => uploadedFiles[base.key]);
        if (hasOperationalFiles && uploadedFiles.quality) {
          throw new PerformanceError("Envie Qualidade pela janela de Qualidade, separadamente das bases operacionais. Nenhuma base foi alterada.", 400);
        }
        const operationalResult = hasOperationalFiles
          ? await processPerformanceFiles(actor, uploadedFiles)
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
    const files: UploadedBases = {};
    for (const base of performanceManualBases) {
      const value = formData.get(`${base.key}File`);
      if (value === null) continue;
      const file = readXlsxFile(value, base.label);
      files[base.key] = { fileName: file.name, buffer: await file.arrayBuffer() };
    }
    return NextResponse.json({ success: true, ...await processPerformanceFiles(actor, files) });
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
  if (fileType !== "production" && fileType !== "volume" && fileType !== "cecCpd" && fileType !== "quality" && fileType !== "cecFrt") throw new PerformanceError("Tipo de arquivo inválido.", 400);
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

  const rebuild = (fileType: "production" | "volume" | "cecCpd" | "quality" | "cecFrt") => {
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

  return { production: rebuild("production"), volume: rebuild("volume"), cecCpd: rebuild("cecCpd"), quality: rebuild("quality"), cecFrt: rebuild("cecFrt") };
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
  files: UploadedBases
) {
  const previews: ManualSnapshotFiles = {};
  for (const { key } of performanceManualBases) {
    const file = files[key];
    if (!file) continue;
    const rawRows = readWorkbookRows(file.buffer);
    if (key === "cecFrt") {
      previews.cecFrt = { fileName: file.fileName, ...await prepareCecFrtSnapshot(actor, rawRows) };
    } else {
      const preview = key === "cecCpd"
        ? await previewCecCpdImport(actor, rawRows, { skipExistingCheck: true })
        : await previewProductionImport(actor, rawRows, { skipExistingCheck: true });
      previews[key] = { fileName: file.fileName, rows: preview.rows };
    }
  }
  return replaceSelectedManualSnapshots(actor, previews);
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
  let workbook: XLSX.WorkBook;
  try { workbook = XLSX.read(buffer, { cellDates: true }); }
  catch { throw new PerformanceError("Não foi possível ler o XLSX. Verifique o arquivo e envie novamente. Nenhuma base foi alterada.", 400); }
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : null;
  if (!sheet) throw new PerformanceError("Planilha de Performance não encontrada no arquivo.", 400);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: true });
  if (!rows.length) throw new PerformanceError("A planilha enviada está vazia.", 400);
  if (rows.length > MAX_OPERATIONAL_FILE_ROWS) throw new PerformanceError("A planilha excede o limite de 250.000 linhas.", 413);
  return rows;
}
