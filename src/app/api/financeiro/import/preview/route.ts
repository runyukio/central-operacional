import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { getApiActor } from "@/lib/api-actor";
import { previewFinanceiroImport } from "@/lib/financeiro-service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const actor = await getApiActor();
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = await request.json().catch(() => ({}));
      const rows = Array.isArray(body.rows) ? body.rows : [];
      const result = await previewFinanceiroImport(actor, rows, String(body.fileName ?? "financeiro.xlsx"));
      if ("error" in result) return NextResponse.json({ error: result.error, message: result.error }, { status: result.status ?? 400 });
      return NextResponse.json(result);
    }

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Arquivo XLSX é obrigatório.", message: "Arquivo XLSX é obrigatório." }, { status: 400 });
    }
    const rows = readRowsFromWorkbook(await file.arrayBuffer());
    const result = await previewFinanceiroImport(actor, rows, file.name);
    if ("error" in result) return NextResponse.json({ error: result.error, message: result.error }, { status: result.status ?? 400 });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[financeiro/import/preview] erro inesperado", error);
    return NextResponse.json({ error: "Não foi possível validar o arquivo financeiro.", message: "Não foi possível validar o arquivo financeiro." }, { status: 500 });
  }
}

function readRowsFromWorkbook(buffer: ArrayBuffer) {
  const workbook = XLSX.read(buffer, { cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : null;
  if (!sheet) throw new Error("Planilha não encontrada.");
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
}
