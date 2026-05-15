import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { previewOperationalScheduleImport } from "@/lib/schedule-service";

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Arquivo não enviado" }, { status: 400 });
  }

  const workbook = XLSX.read(await file.arrayBuffer());
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: "" });
  return NextResponse.json({ fileName: file.name, ...(await previewOperationalScheduleImport(rows)) });
}
