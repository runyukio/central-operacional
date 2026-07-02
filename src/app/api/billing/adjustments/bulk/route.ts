import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { getApiActor } from "@/lib/api-actor";
import { bulkCreateBillingAdjustments } from "@/lib/billing-service";

export async function POST(request: Request) {
  const actor = await getApiActor();
  const formData = await request.formData();
  const file = formData.get("file");
  const referenceMonth = String(formData.get("referenceMonth") ?? "");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Arquivo XLSX obrigatório.", message: "Arquivo XLSX obrigatório." }, { status: 400 });
  }

  const workbook = XLSX.read(await file.arrayBuffer(), { cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : null;
  if (!sheet) {
    return NextResponse.json({ error: "Planilha sem abas para importar.", message: "Planilha sem abas para importar." }, { status: 400 });
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: true });
  const result = await bulkCreateBillingAdjustments(actor, { referenceMonth, rows, fileName: file.name });
  if ("error" in result) return NextResponse.json({ error: result.error, message: result.error }, { status: result.status ?? 400 });
  return NextResponse.json(result);
}
