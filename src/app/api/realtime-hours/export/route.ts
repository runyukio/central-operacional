import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import {
  buildRealtimeHoursExportRows,
  type RealtimeHoursExportRow
} from "@/lib/realtime-hours-export";
import { canAccessRealtimeHoursCapture } from "@/lib/realtime-hours-permissions";
import { getRealtimeHoursTimeline } from "@/lib/realtime-hours-service";
import { filterRealtimeHoursTimelineRows } from "@/lib/realtime-hours-timeline";
import {
  buildXlsxResponse,
  excelDateSerial,
  excelDateTimeSerial,
  xlsxDurationFormat
} from "@/lib/xlsx-export";

export const dynamic = "force-dynamic";

const millisecondsPerDay = 24 * 60 * 60 * 1000;

const exportRowSchema = z.object({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  employeeName: z.string().max(300),
  wbLogin: z.string().max(200),
  employeeId: z.string().max(200),
  presenceStatus: z.string().max(100),
  lob: z.string().max(200),
  supervisor: z.string().max(300),
  shift: z.string().max(200),
  scheduleStatus: z.string().max(200),
  plannedShiftLabel: z.string().max(200),
  plannedStart: z.string().nullable(),
  plannedEnd: z.string().nullable(),
  entryAt: z.string().nullable(),
  exitAt: z.string().nullable(),
  durationMs: z.number().finite(),
  noActivityMs: z.number().finite(),
  rawDelayMs: z.number().finite(),
  delayMs: z.number().finite(),
  overtimeMs: z.number().finite(),
  sessionCount: z.number().int().nonnegative(),
  hostnames: z.string().max(2_000),
  windowsUsers: z.string().max(2_000),
  ipAddress: z.string().max(200),
  lastSeenAt: z.string()
});

const exportPayloadSchema = z.object({
  rows: z.array(exportRowSchema).max(2_000)
});

export async function POST(request: Request) {
  const accessError = await authorizeExport();
  if (accessError) return accessError;

  const parsed = exportPayloadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Os dados da exportação são inválidos.", message: "Os dados da exportação são inválidos." },
      { status: 400 }
    );
  }

  return buildCaptureHoursExportResponse(parsed.data.rows);
}

export async function GET(request: Request) {
  const accessError = await authorizeExport();
  if (accessError) return accessError;

  try {
    const url = new URL(request.url);
    const date = validDate(url.searchParams.get("date")) ?? todayInSaoPaulo();
    const timeline = await getRealtimeHoursTimeline({ date });
    const filteredRows = filterRealtimeHoursTimelineRows(timeline.rows, {
      date,
      search: url.searchParams.get("search"),
      lob: url.searchParams.get("lob"),
      presence: url.searchParams.get("presence"),
      supervisor: url.searchParams.get("supervisor"),
      shift: url.searchParams.get("shift"),
      schedule: url.searchParams.get("schedule")
    });
    const calculationEnd = timeline.window.calculationEnd ?? timeline.window.end;
    return buildCaptureHoursExportResponse(buildRealtimeHoursExportRows(filteredRows, calculationEnd));
  } catch (error) {
    console.error("[realtime-hours/export] erro inesperado", error);
    return NextResponse.json(
      { success: false, error: "Não foi possível gerar a exportação da Captura de Horas.", message: "Não foi possível gerar a exportação da Captura de Horas." },
      { status: 500 }
    );
  }
}

async function authorizeExport() {
  const actor = await getApiActor();
  if (!canAccessRealtimeHoursCapture({
    role: actor.role,
    email: actor.email,
    name: actor.name,
    roleTitle: actor.roleTitle,
    jobTitle: actor.jobTitle,
    skill: actor.skill,
    status: "ACTIVE"
  })) {
    return NextResponse.json(
      { success: false, error: "Você não tem permissão para exportar a Captura de Horas.", message: "Você não tem permissão para exportar a Captura de Horas." },
      { status: 403 }
    );
  }
  return null;
}

function buildCaptureHoursExportResponse(exportRows: RealtimeHoursExportRow[]) {
  const headers = [
    "Data",
    "Colaborador",
    "WB/Login",
    "ID do agente",
    "Status online",
    "LOB",
    "Supervisor",
    "Turno",
    "Situação da escala",
    "Escala prevista",
    "Início previsto",
    "Fim previsto",
    "Entrada registrada",
    "Saída registrada",
    "Duração",
    "Tempo sem atividade",
    "Tempo de atraso",
    "Atraso",
    "Hora extra",
    "Sessões",
    "Máquinas",
    "Usuários Windows",
    "IP",
    "Último sinal"
  ];

  const rows = exportRows.map((row) => [
    excelDateSerial(row.data),
    row.employeeName,
    row.wbLogin,
    row.employeeId,
    row.presenceStatus,
    row.lob,
    row.supervisor,
    row.shift,
    row.scheduleStatus,
    row.plannedShiftLabel,
    excelDateTimeSerial(row.plannedStart),
    excelDateTimeSerial(row.plannedEnd),
    excelDateTimeSerial(row.entryAt),
    excelDateTimeSerial(row.exitAt),
    durationForExcel(row.durationMs),
    durationForExcel(row.noActivityMs),
    durationForExcel(row.rawDelayMs),
    durationForExcel(row.delayMs),
    durationForExcel(row.overtimeMs),
    row.sessionCount,
    row.hostnames,
    row.windowsUsers,
    row.ipAddress,
    excelDateTimeSerial(row.lastSeenAt)
  ]);

  return buildXlsxResponse({
    fileName: `captura_de_horas_${todayInSaoPaulo()}.xlsx`,
    sheetName: "Captura de Horas",
    headers,
    rows,
    autoFilter: true,
    columnFormats: {
      0: "dd/mm/yyyy",
      10: "dd/mm/yyyy hh:mm:ss",
      11: "dd/mm/yyyy hh:mm:ss",
      12: "dd/mm/yyyy hh:mm:ss",
      13: "dd/mm/yyyy hh:mm:ss",
      14: xlsxDurationFormat,
      15: xlsxDurationFormat,
      16: xlsxDurationFormat,
      17: xlsxDurationFormat,
      18: xlsxDurationFormat,
      23: "dd/mm/yyyy hh:mm:ss"
    }
  });
}

function durationForExcel(milliseconds: number) {
  if (!Number.isFinite(milliseconds)) return 0;
  return Math.trunc(milliseconds / 1_000) / (millisecondsPerDay / 1_000);
}

function validDate(value: string | null) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "")) ? String(value) : null;
}

function todayInSaoPaulo() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}
