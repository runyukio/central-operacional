import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { getApiActor } from "@/lib/api-actor";
import { errorStatus } from "@/lib/api-errors";
import { importAdsHourlyRequirements, listAdsHourlyCoverage } from "@/lib/ads-hourly-coverage-service";

export async function GET(request: Request) {
  const actor = await getApiActor();
  const url = new URL(request.url);
  const result = await listAdsHourlyCoverage(actor, {
    startDate: url.searchParams.get("startDate") ?? undefined,
    endDate: url.searchParams.get("endDate") ?? undefined
  });
  if ("error" in result) {
    const status = "type" in result ? errorStatus(result as any) : result.status ?? 400;
    return NextResponse.json(result, { status });
  }
  return NextResponse.json(result);
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Arquivo XLSX é obrigatório.", message: "Arquivo XLSX é obrigatório." }, { status: 400 });
  }
  if (!/\.xlsx?$/i.test(file.name)) {
    return NextResponse.json({ error: "Envie um arquivo XLSX ou XLS.", message: "Envie um arquivo XLSX ou XLS." }, { status: 400 });
  }
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "O arquivo excede 10 MB.", message: "O arquivo excede 10 MB." }, { status: 400 });
  }

  const workbook = XLSX.read(await file.arrayBuffer(), { cellDates: true });
  const sheetName = workbook.SheetNames.find((name) => /ads|requerido|necessidade/i.test(name)) ?? workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : null;
  if (!sheet) return NextResponse.json({ error: "A planilha não possui uma aba válida.", message: "A planilha não possui uma aba válida." }, { status: 400 });

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  const actor = await getApiActor();
  const result = await importAdsHourlyRequirements(actor, rows, file.name);
  if ("error" in result) return NextResponse.json(result, { status: result.status ?? 400 });
  return NextResponse.json(result);
}
