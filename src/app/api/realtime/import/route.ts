import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { importRealtimeSnapshot, validateRealtimeImportToken } from "@/lib/realtime-service";

export const dynamic = "force-dynamic";

const queueSheetAliases = new Set(["filas", "fila", "queue", "queues"]);
const agentSheetAliases = new Set(["agentes", "agente", "agent", "agents", "auditor", "auditors", "auditores"]);

export async function POST(request: Request) {
  const tokenValidation = validateRealtimeImportToken(request.headers.get("authorization"));
  if ("error" in tokenValidation) {
    return NextResponse.json({ success: false, error: tokenValidation.error, message: tokenValidation.error }, { status: tokenValidation.status });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const source = String(formData.get("source") ?? "kap-local");
    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: "Arquivo XLSX é obrigatório.", message: "Arquivo XLSX é obrigatório." }, { status: 400 });
    }

    const workbook = XLSX.read(await file.arrayBuffer(), { cellDates: true });
    const queueSheetName = findSheetName(workbook.SheetNames, queueSheetAliases);
    const agentSheetName = findSheetName(workbook.SheetNames, agentSheetAliases);

    if (!queueSheetName || !agentSheetName) {
      return NextResponse.json({
        success: false,
        error: "O arquivo precisa conter as abas Filas e Agentes.",
        message: "O arquivo precisa conter as abas Filas e Agentes.",
        sheets: workbook.SheetNames
      }, { status: 400 });
    }

    const queueRows = readRows(workbook, queueSheetName);
    const agentRows = readRows(workbook, agentSheetName);
    const result = await importRealtimeSnapshot({ fileName: file.name, source, queueRows, agentRows });
    if ("error" in result) {
      return NextResponse.json({ success: false, error: result.error, message: result.error }, { status: result.status ?? 400 });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error("[realtime/import] erro inesperado", error);
    return NextResponse.json({ success: false, error: "Não foi possível importar o snapshot de Real Time.", message: "Não foi possível importar o snapshot de Real Time." }, { status: 500 });
  }
}

function readRows(workbook: XLSX.WorkBook, sheetName: string) {
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], { defval: "", raw: true });
}

function findSheetName(sheetNames: string[], aliases: Set<string>) {
  return sheetNames.find((sheetName) => aliases.has(normalizeSheetName(sheetName))) ?? null;
}

function normalizeSheetName(value: string) {
  return value.trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/g, "");
}
