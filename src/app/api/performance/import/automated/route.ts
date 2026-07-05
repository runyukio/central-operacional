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
      const rawRows = Array.isArray(body.rawRows) ? body.rawRows : [];
      if (!rawRows.length) {
        return NextResponse.json({ success: false, error: "rawRows é obrigatório.", message: "rawRows é obrigatório." }, { status: 400 });
      }
      const fileName = typeof body.fileName === "string" ? body.fileName : "performance_automated.json";
      return NextResponse.json(await commitProductionAutomatedRawImport(rawRows, fileName));
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

    return NextResponse.json({
      success: true,
      batchId,
      files: imports,
      importedRows: imports.reduce((sum, item) => sum + item.importedRows, 0),
      productionRows: imports.reduce((sum, item) => sum + item.productionRows, 0),
      volumeRows: imports.reduce((sum, item) => sum + item.volumeRows, 0),
      createdRows: imports.reduce((sum, item) => sum + item.createdRows, 0),
      updatedRows: imports.reduce((sum, item) => sum + item.updatedRows, 0)
    });
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
  return ["productionFile", "volumeFile", "file", "files"].flatMap((field) => formData.getAll(field)).filter((value): value is File => value instanceof File);
}

function readRowsFromWorkbook(buffer: ArrayBuffer) {
  const workbook = XLSX.read(buffer, { cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : null;
  if (!sheet) throw new PerformanceError("Planilha de Performance não encontrada.", 400);
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: true });
}
