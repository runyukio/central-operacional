import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { getApiActor } from "@/lib/api-actor";
import { previewMonthlyAdvanceImport } from "@/lib/monthly-advance-service";

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");
  const referenceMonth = String(formData.get("referenceMonth") ?? "");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Arquivo obrigatório.", message: "Arquivo obrigatório." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = XLSX.read(buffer);
  const sheetName = workbook.SheetNames.find((name) => /adiantamento/i.test(name)) ?? workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : null;
  if (!sheet) {
    return NextResponse.json({ error: "Planilha de adiantamento não encontrada.", message: "Planilha de adiantamento não encontrada." }, { status: 400 });
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  const actor = await getApiActor();
  const result = await previewMonthlyAdvanceImport(actor, rows, referenceMonth);
  if ("error" in result) return NextResponse.json({ error: result.error, message: result.error }, { status: result.status ?? 400 });
  return NextResponse.json(result);
}
