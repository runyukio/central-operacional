import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { getApiActor } from "@/lib/api-actor";
import { canAccessRealTime } from "@/lib/permissions";
import { importRealtimeSnapshot, validateRealtimeImportToken } from "@/lib/realtime-service";

export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 30 * 1024 * 1024;
const MAX_TOTAL_ROWS = 250_000;
const queueSheetAliases = new Set(["filas", "fila", "queue", "queues"]);
const agentSheetAliases = new Set(["agentes", "agente", "agent", "agents", "auditor", "auditors", "auditores"]);

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  if (authorization) {
    const tokenValidation = validateRealtimeImportToken(authorization);
    if ("error" in tokenValidation) {
      return NextResponse.json({ success: false, error: tokenValidation.error, message: tokenValidation.error }, { status: tokenValidation.status });
    }
  } else {
    const actor = await getApiActor();
    if (!canAccessRealTime({ role: actor.role, email: actor.email, name: actor.name, roleTitle: actor.roleTitle, jobTitle: actor.jobTitle, skill: actor.skill, status: "ACTIVE" })) {
      return NextResponse.json({ success: false, error: "Você não tem permissão para importar Real Time.", message: "Você não tem permissão para importar Real Time." }, { status: 403 });
    }
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const source = String(formData.get("source") ?? "kap-local");
    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: "Arquivo XLSX é obrigatório.", message: "Arquivo XLSX é obrigatório." }, { status: 400 });
    }
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      return NextResponse.json({ success: false, error: "O arquivo enviado deve ser XLSX.", message: "O arquivo enviado deve ser XLSX." }, { status: 400 });
    }
    if (!file.size) {
      return NextResponse.json({ success: false, error: "O arquivo enviado está vazio.", message: "O arquivo enviado está vazio." }, { status: 400 });
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ success: false, error: "O arquivo excede o limite de 30 MB.", message: "O arquivo excede o limite de 30 MB." }, { status: 413 });
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
    if (queueRows.length + agentRows.length > MAX_TOTAL_ROWS) {
      return NextResponse.json({
        success: false,
        error: "O arquivo excede o limite de 250.000 linhas.",
        message: "O arquivo excede o limite de 250.000 linhas."
      }, { status: 413 });
    }
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
