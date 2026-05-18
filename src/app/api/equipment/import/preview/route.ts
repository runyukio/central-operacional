import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { getApiActor } from "@/lib/api-actor";
import { previewEquipmentImport } from "@/lib/equipment-service";

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ success: false, message: "Arquivo de equipamentos é obrigatório.", rows: [] }, { status: 400 });
  }

  const workbook = XLSX.read(await file.arrayBuffer(), { cellDates: true });
  const sheetName = workbook.SheetNames.find((name) => name.toLowerCase() === "equipamentos") ?? workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  const actor = await getApiActor();
  return NextResponse.json(await previewEquipmentImport(actor, rows));
}
