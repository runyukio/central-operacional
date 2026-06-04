import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { getApiActor } from "@/lib/api-actor";
import { PerformanceError, previewProductionImport } from "@/lib/performance-service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const file = (await request.formData()).get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: "Arquivo de Produção é obrigatório.", message: "Arquivo de Produção é obrigatório.", rows: [] }, { status: 400 });
    }
    const rows = readRowsFromWorkbook(await file.arrayBuffer(), ["producao", "produção", "production"]);
    const actor = await getApiActor();
    return NextResponse.json(await previewProductionImport(actor, rows));
  } catch (error) {
    return performanceImportErrorResponse(error, "Não foi possível validar a base de Produção.");
  }
}

function readRowsFromWorkbook(buffer: ArrayBuffer, preferredSheets: string[]) {
  const workbook = XLSX.read(buffer, { cellDates: true });
  const sheetName = workbook.SheetNames.find((name) => preferredSheets.includes(name.trim().toLowerCase())) ?? workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : null;
  if (!sheet) throw new PerformanceError("Planilha de Produção não encontrada.", 400);
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
}

function performanceImportErrorResponse(error: unknown, fallback: string) {
  if (error instanceof PerformanceError) {
    return NextResponse.json({ success: false, error: error.message, message: error.message, rows: [] }, { status: error.status });
  }
  console.error("[performance/production/preview] erro inesperado", error);
  return NextResponse.json({ success: false, error: fallback, message: fallback, rows: [] }, { status: 500 });
}
