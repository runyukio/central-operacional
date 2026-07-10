import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { PerformanceError, commitProductionAutomatedRawImport, validatePerformanceImportToken } from "@/lib/performance-service";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const tokenValidation = validatePerformanceImportToken(request.headers.get("authorization"));
  if ("error" in tokenValidation) {
    return NextResponse.json({ success: false, error: tokenValidation.error, message: tokenValidation.error }, { status: tokenValidation.status });
  }

  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = await request.json().catch(() => ({}));
      const rowSets = collectJsonRowSets(body);
      const resetSnapshot = shouldResetSnapshot(request, body);
      if (!rowSets.length) {
        return NextResponse.json({
          success: false,
          error: "rawRows, productionRows ou volumeRows é obrigatório.",
          message: "rawRows, productionRows ou volumeRows é obrigatório."
        }, { status: 400 });
      }
      const coverage = summarizePerformanceRowSets(rowSets);
      if (!coverage.hasProduction || !coverage.hasVolume) {
        return NextResponse.json(buildIncompleteImportResponse(coverage), { status: 400 });
      }

      let batchId: string | undefined;
      const imports = [];
      for (const rowSet of rowSets) {
        const result = await commitProductionAutomatedRawImport(rowSet.rows, rowSet.fileName, batchId, 0, { pruneSnapshot: true });
        batchId = result.batchId;
        imports.push({
          fileName: rowSet.fileName,
          importedRows: result.importedRows,
          productionRows: result.productionRows,
          volumeRows: result.volumeRows,
          createdRows: result.createdRows,
          updatedRows: result.updatedRows
        });
      }
      const reset = resetSnapshot && batchId ? await resetAutomatedProductionSnapshot(batchId) : null;
      return NextResponse.json(buildAutomatedImportResponse(batchId, imports, coverage, reset));
    }

    const formData = await request.formData();
    const files = collectUploadFiles(formData);
    const resetSnapshot = shouldResetSnapshot(request, formData);
    if (!files.length) {
      return NextResponse.json({
        success: false,
        error: "Envie ao menos um XLSX em file, productionFile ou volumeFile.",
        message: "Envie ao menos um XLSX em file, productionFile ou volumeFile."
      }, { status: 400 });
    }

    const rowSets: PerformanceRowSet[] = [];
    for (const file of files) {
      rowSets.push({ fileName: file.name, rows: readRowsFromWorkbook(await file.arrayBuffer()) });
    }
    const coverage = summarizePerformanceRowSets(rowSets);
    if (!coverage.hasProduction || !coverage.hasVolume) {
      return NextResponse.json(buildIncompleteImportResponse(coverage), { status: 400 });
    }

    let batchId: string | undefined;
    const imports = [];
    for (const rowSet of rowSets) {
      const result = await commitProductionAutomatedRawImport(rowSet.rows, rowSet.fileName, batchId, 0, { pruneSnapshot: true });
      batchId = result.batchId;
      imports.push({
        fileName: rowSet.fileName,
        importedRows: result.importedRows,
        productionRows: result.productionRows,
        volumeRows: result.volumeRows,
        createdRows: result.createdRows,
        updatedRows: result.updatedRows
      });
    }

    const reset = resetSnapshot && batchId ? await resetAutomatedProductionSnapshot(batchId) : null;
    return NextResponse.json(buildAutomatedImportResponse(batchId, imports, coverage, reset));
  } catch (error) {
    if (error instanceof PerformanceError) {
      return NextResponse.json({ success: false, error: error.message, message: error.message }, { status: error.status });
    }
    console.error("[performance/import/automated] erro inesperado", error);
    return NextResponse.json({
      success: false,
      error: "Não foi possível importar a base automatizada de Performance.",
      message: "Não foi possível importar a base automatizada de Performance."
    }, { status: 500 });
  }
}

function shouldResetSnapshot(request: Request, source: Record<string, unknown> | FormData) {
  if (truthyFlag(request.headers.get("x-performance-reset"))) return true;
  if (truthyFlag(request.headers.get("x-reset-performance"))) return true;
  if (source instanceof FormData) {
    return truthyFlag(source.get("reset")) || truthyFlag(source.get("resetProduction")) || truthyFlag(source.get("replaceSnapshot"));
  }
  return truthyFlag(source.reset) || truthyFlag(source.resetProduction) || truthyFlag(source.replaceSnapshot);
}

function truthyFlag(value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "y", "sim", "s", "reset", "replace"].includes(normalized);
}

async function resetAutomatedProductionSnapshot(batchIdToKeep: string) {
  if (!batchIdToKeep) throw new PerformanceError("Lote de importação obrigatório para limpar Performance.", 400);
  const [productionDeleted, volumeDeleted, batchesDeleted] = await prisma.$transaction([
    prisma.productionRecord.deleteMany({
      where: {
        OR: [
          { importBatchId: null },
          { importBatchId: { not: batchIdToKeep } }
        ]
      }
    }),
    prisma.performanceQueueVolumeRecord.deleteMany({
      where: {
        OR: [
          { importBatchId: null },
          { importBatchId: { not: batchIdToKeep } }
        ]
      }
    }),
    prisma.performanceImportBatch.deleteMany({
      where: {
        type: "PRODUCTION",
        id: { not: batchIdToKeep }
      }
    })
  ]);

  return {
    batchIdKept: batchIdToKeep,
    productionRowsDeleted: productionDeleted.count,
    volumeRowsDeleted: volumeDeleted.count,
    importBatchesDeleted: batchesDeleted.count
  };
}

function collectUploadFiles(formData: FormData) {
  const knownFields = ["productionFile", "volumeFile", "file", "files", "files[]", "production", "volume"];
  const files = new Map<string, File>();
  for (const field of knownFields) {
    for (const value of formData.getAll(field)) {
      addUploadFile(files, value);
    }
  }
  for (const value of formData.values()) {
    addUploadFile(files, value);
  }
  return Array.from(files.values());
}

function addUploadFile(files: Map<string, File>, value: FormDataEntryValue) {
  if (!(value instanceof File)) return;
  const fileName = value.name || "performance_automated.xlsx";
  if (!fileName.toLowerCase().endsWith(".xlsx")) return;
  files.set(`${fileName}:${value.size}`, value);
}

function collectJsonRowSets(body: Record<string, unknown>) {
  const defaultFileName = typeof body.fileName === "string" ? body.fileName : "performance_automated.json";
  const rowSets: Array<{ fileName: string; rows: Record<string, unknown>[] }> = [];
  if (Array.isArray(body.rawRows) && body.rawRows.length) {
    rowSets.push({ fileName: defaultFileName, rows: body.rawRows.filter(isRecord) });
  }
  if (Array.isArray(body.productionRows) && body.productionRows.length) {
    rowSets.push({
      fileName: typeof body.productionFileName === "string" ? body.productionFileName : "performance_production_latest.json",
      rows: body.productionRows.filter(isRecord)
    });
  }
  if (Array.isArray(body.volumeRows) && body.volumeRows.length) {
    rowSets.push({
      fileName: typeof body.volumeFileName === "string" ? body.volumeFileName : "performance_volume_latest.json",
      rows: body.volumeRows.filter(isRecord)
    });
  }
  return rowSets.filter((rowSet) => rowSet.rows.length);
}

type PerformanceRowSet = { fileName: string; rows: Record<string, unknown>[] };

function summarizePerformanceRowSets(rowSets: PerformanceRowSet[]) {
  const summary = {
    hasProduction: false,
    hasVolume: false,
    productionRows: 0,
    volumeRows: 0,
    files: rowSets.map((rowSet) => rowSet.fileName)
  };

  for (const rowSet of rowSets) {
    for (const row of rowSet.rows) {
      const type = classifyPerformanceRow(row);
      if (type === "production") {
        summary.hasProduction = true;
        summary.productionRows += 1;
      } else if (type === "volume") {
        summary.hasVolume = true;
        summary.volumeRows += 1;
      }
    }
  }

  return summary;
}

function classifyPerformanceRow(row: Record<string, unknown>) {
  const normalizedRow = normalizePerformanceRow(row);
  const hasAgent = Boolean(text(performanceRowValue(normalizedRow, ["agentes", "agente", "agentname", "wb_login", "wb login"])));
  const hasSubmit = Boolean(text(performanceRowValue(normalizedRow, ["submit_num", "submit num", "submit"])));
  const hasInput = Boolean(text(performanceRowValue(normalizedRow, ["enqueue", "enqueue_num", "enqueue num", "input", "input_num", "input num", "进审量", "recebidos"])));
  const hasQueue = Boolean(text(performanceRowValue(normalizedRow, ["id-queue_id", "id_queue_id", "id queue id", "队列id-queue_id", "队列id", "queue_id", "queueid", "queue id", "fila", "queue"])));
  const hasProductionTime = Boolean(text(performanceRowValue(normalizedRow, ["bz_time", "bz time", "brasiltime/hour", "brasiltime hour", "br_time(hour)", "br time(hour)", "br_time", "br time"])));
  const hasVolumeTime = Boolean(text(performanceRowValue(normalizedRow, ["bz_enqueue_time", "bz enqueue time", "bz_enqueue_time(hour)", "brasiltime/hour", "brasiltime hour", "br_time(hour)", "br time(hour)", "br_time", "br time", "bz_time", "bz time"])));

  if (hasInput && hasQueue && hasVolumeTime && !hasAgent && !hasSubmit) return "volume";
  if (hasSubmit && hasAgent && hasQueue && hasProductionTime) return "production";
  return "unknown";
}

function normalizePerformanceRow(row: Record<string, unknown>) {
  const normalizedRow: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) normalizedRow[normalizePerformanceHeader(key)] = value;
  return normalizedRow;
}

function performanceRowValue(normalizedRow: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = normalizedRow[normalizePerformanceHeader(key)];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

function normalizePerformanceHeader(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[（）]/g, (char) => (char === "（" ? "(" : ")"))
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function buildIncompleteImportResponse(coverage: ReturnType<typeof summarizePerformanceRowSets>) {
  const missing = [];
  if (!coverage.hasProduction) missing.push("produção/output (submit)");
  if (!coverage.hasVolume) missing.push("volume/input (enqueue)");
  const message = `Importação automatizada incompleta. Envie produção/output (submit) e volume/input (enqueue) no mesmo upload. Faltando: ${missing.join(" e ")}.`;
  return {
    success: false,
    error: message,
    message,
    productionRowsDetected: coverage.productionRows,
    volumeRowsDetected: coverage.volumeRows,
    files: coverage.files
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function buildAutomatedImportResponse(
  batchId: string | undefined,
  imports: Array<{ fileName: string; importedRows: number; productionRows: number; volumeRows: number; createdRows: number; updatedRows: number }>,
  coverage: ReturnType<typeof summarizePerformanceRowSets>,
  reset: Awaited<ReturnType<typeof resetAutomatedProductionSnapshot>> | null = null
) {
  return {
    success: true,
    batchId,
    reset,
    hasProduction: coverage.hasProduction,
    hasVolume: coverage.hasVolume,
    warnings: buildCoverageWarnings(coverage),
    files: imports,
    importedRows: imports.reduce((sum, item) => sum + item.importedRows, 0),
    productionRows: imports.reduce((sum, item) => sum + item.productionRows, 0),
    volumeRows: imports.reduce((sum, item) => sum + item.volumeRows, 0),
    createdRows: imports.reduce((sum, item) => sum + item.createdRows, 0),
    updatedRows: imports.reduce((sum, item) => sum + item.updatedRows, 0)
  };
}

function buildCoverageWarnings(coverage: ReturnType<typeof summarizePerformanceRowSets>) {
  const warnings = [];
  if (!coverage.hasProduction) warnings.push("Upload sem produção/output: apenas input/enqueue foi importado.");
  if (!coverage.hasVolume) warnings.push("Upload sem input/enqueue: apenas produção/output foi importada.");
  return warnings;
}

function readRowsFromWorkbook(buffer: ArrayBuffer) {
  const workbook = XLSX.read(buffer, { cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : null;
  if (!sheet) throw new PerformanceError("Planilha de Performance não encontrada.", 400);
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: true });
}
