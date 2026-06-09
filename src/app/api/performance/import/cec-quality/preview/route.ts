import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { getApiActor } from "@/lib/api-actor";
import { PerformanceError, previewCecQualityImport } from "@/lib/performance-service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    const actor = await getApiActor();
    if (contentType.includes("application/json")) {
      const body = await request.json().catch(() => ({}));
      const rows = Array.isArray(body.rows) ? body.rows : [];
      const rowOffset = Number.isFinite(Number(body.rowOffset)) ? Number(body.rowOffset) : 0;
      const yearReference = Number.isFinite(Number(body.yearReference)) ? Number(body.yearReference) : undefined;
      return NextResponse.json(await previewCecQualityImport(actor, rows, { rowNumberOffset: rowOffset, yearReference }));
    }
    const formData = await request.formData();
    const file = formData.get("file");
    const yearReference = Number.isFinite(Number(formData.get("yearReference"))) ? Number(formData.get("yearReference")) : undefined;
    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: "Arquivo de Qualidade CEC é obrigatório.", message: "Arquivo de Qualidade CEC é obrigatório.", rows: [] }, { status: 400 });
    }
    const rows = readRowsFromWorkbook(await file.arrayBuffer(), ["planilha1", "qualidade cec", "qualidade_cec", "cec quality", "quality cec", "cec"]);
    return NextResponse.json(await previewCecQualityImport(actor, rows, { yearReference }));
  } catch (error) {
    return performanceImportErrorResponse(error, "Não foi possível validar a base de Qualidade CEC.");
  }
}

function readRowsFromWorkbook(buffer: ArrayBuffer, preferredSheets: string[]) {
  const workbook = XLSX.read(buffer, { cellDates: true });
  const sheetName = workbook.SheetNames.find((name) => preferredSheets.includes(normalizeSheetName(name))) ?? workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : null;
  if (!sheet) throw new PerformanceError("Planilha de Qualidade CEC não encontrada.", 400);
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
}

function normalizeSheetName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

function performanceImportErrorResponse(error: unknown, fallback: string) {
  if (error instanceof PerformanceError) {
    return NextResponse.json({ success: false, error: error.message, message: error.message, rows: [] }, { status: error.status });
  }
  console.error("[performance/cec-quality/preview] erro inesperado", error);
  return NextResponse.json({ success: false, error: fallback, message: fallback, rows: [] }, { status: 500 });
}
