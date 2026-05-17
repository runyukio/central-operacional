import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { getApiActor } from "@/lib/api-actor";
import { createValidationError, errorResponse } from "@/lib/api-errors";
import { previewOperationalWorkHoursImport } from "@/lib/work-hours-service";

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return errorResponse(createValidationError({ file: "Arquivo não enviado." }));
  }

  const workbook = XLSX.read(await file.arrayBuffer(), { cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  const actor = await getApiActor();
  return NextResponse.json({ fileName: file.name, ...(await previewOperationalWorkHoursImport(actor, rows)) });
}
