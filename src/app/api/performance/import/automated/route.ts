import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { commitProductionAutomatedRawImport, PerformanceError, validatePerformanceImportToken } from "@/lib/performance-service";

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
      if (!rowSets.length) {
        return NextResponse.json({
          success: false,
          error: "rawRows, productionRows ou volumeRows é obrigatório.",
          message: "rawRows, productionRows ou volumeRows é obrigatório."
        }, { status: 400 });
      }

      let batchId: string | undefined;
      const imports = [];
      for (const rowSet of rowSets) {
        const result = await commitProductionAutomatedRawImport(rowSet.rows, rowSet.fileName, batchId);
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
      return NextResponse.json(buildAutomatedImportResponse(batchId, imports));
    }

    const formData = await request.formData();
    const files = collectUploadFiles(formData);
    if (!files.length) {
      return NextResponse.json({
        success: false,
        error: "Envie ao menos um XLSX em file, productionFile ou volumeFile.",
        message: "Envie ao menos um XLSX em file, productionFile ou volumeFile."
      }, { status: 400 });
    }

    let batchId: string | undefined;
    const imports = [];
    for (const file of files) {
      const rows = readRowsFromWorkbook(await file.arrayBuffer());
      const result = await commitProductionAutomatedRawImport(rows, file.name, batchId);
      batchId = result.batchId;
      imports.push({
        fileName: file.name,
        importedRows: result.importedRows,
        productionRows: result.productionRows,
        volumeRows: result.volumeRows,
        createdRows: result.createdRows,
        updatedRows: result.updatedRows
      });
    }

    return NextResponse.json(buildAutomatedImportResponse(batchId, imports));
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function buildAutomatedImportResponse(
  batchId: string | undefined,
  imports: Array<{ fileName: string; importedRows: number; productionRows: number; volumeRows: number; createdRows: number; updatedRows: number }>
) {
  return {
    success: true,
    batchId,
    files: imports,
    importedRows: imports.reduce((sum, item) => sum + item.importedRows, 0),
    productionRows: imports.reduce((sum, item) => sum + item.productionRows, 0),
    volumeRows: imports.reduce((sum, item) => sum + item.volumeRows, 0),
    createdRows: imports.reduce((sum, item) => sum + item.createdRows, 0),
    updatedRows: imports.reduce((sum, item) => sum + item.updatedRows, 0)
  };
}

function readRowsFromWorkbook(buffer: ArrayBuffer) {
  const workbook = XLSX.read(buffer, { cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : null;
  if (!sheet) throw new PerformanceError("Planilha de Performance não encontrada.", 400);
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: true });
}
