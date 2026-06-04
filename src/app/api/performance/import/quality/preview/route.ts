import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { getApiActor } from "@/lib/api-actor";
import { PerformanceError, previewQualityImport } from "@/lib/performance-service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    const actor = await getApiActor();
    if (contentType.includes("application/json")) {
      const body = await request.json().catch(() => ({}));
      const rows = Array.isArray(body.rows) ? body.rows : [];
      const rowOffset = Number.isFinite(Number(body.rowOffset)) ? Number(body.rowOffset) : 0;
      return NextResponse.json(await previewQualityImport(actor, rows, { rowNumberOffset: rowOffset }));
    }
    const file = (await request.formData()).get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: "Arquivo de Qualidade é obrigatório.", message: "Arquivo de Qualidade é obrigatório.", rows: [] }, { status: 400 });
    }
    const rows = readRowsFromWorkbook(await file.arrayBuffer(), ["qualidade", "quality"]);
    return NextResponse.json(await previewQualityImport(actor, rows));
  } catch (error) {
    return performanceImportErrorResponse(error, "Não foi possível validar a base de Qualidade.");
  }
}

function readRowsFromWorkbook(buffer: ArrayBuffer, preferredSheets: string[]) {
  const workbook = XLSX.read(buffer, { cellDates: true });
  const sheetName = workbook.SheetNames.find((name) => preferredSheets.includes(name.trim().toLowerCase())) ?? workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : null;
  if (!sheet) throw new PerformanceError("Planilha de Qualidade não encontrada.", 400);
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
}

function performanceImportErrorResponse(error: unknown, fallback: string) {
  if (error instanceof PerformanceError) {
    return NextResponse.json({ success: false, error: error.message, message: error.message, rows: [] }, { status: error.status });
  }
  console.error("[performance/quality/preview] erro inesperado", error);
  return NextResponse.json({ success: false, error: fallback, message: fallback, rows: [] }, { status: 500 });
}
