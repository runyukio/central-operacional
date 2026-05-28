import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { getApiActor } from "@/lib/api-actor";
import { previewStaffCoverageImport } from "@/lib/staff-coverage-service";

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ success: false, error: "Arquivo de requerido é obrigatório.", message: "Arquivo de requerido é obrigatório.", rows: [] }, { status: 400 });
  }

  const workbook = XLSX.read(await file.arrayBuffer(), { cellDates: true });
  const sheetName = workbook.SheetNames.find((name) => /requerido|staff|cobertura/i.test(name)) ?? workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : null;
  if (!sheet) {
    return NextResponse.json({ success: false, error: "Planilha de requerido não encontrada.", message: "Planilha de requerido não encontrada.", rows: [] }, { status: 400 });
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  const actor = await getApiActor();
  const result = await previewStaffCoverageImport(actor, rows);
  return NextResponse.json(result, { status: result.success ? 200 : result.summary?.errorRows ? 200 : 400 });
}
