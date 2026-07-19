import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { canAccessRealtimeHoursCapture } from "@/lib/realtime-hours-permissions";
import { getRealtimeHoursTimeline } from "@/lib/realtime-hours-service";
import {
  compareRealtimeHoursPlannedShift,
  filterRealtimeHoursTimelineRows,
  primaryRealtimeHoursPlannedShift,
  realtimeHoursPlannedShiftLabel,
  realtimeHoursScheduleStatusLabel,
  realtimeHoursShiftDateActivity
} from "@/lib/realtime-hours-timeline";
import { buildXlsxResponse, xlsxDurationFormat } from "@/lib/xlsx-export";

export const dynamic = "force-dynamic";

const millisecondsPerDay = 24 * 60 * 60 * 1000;

export async function GET(request: Request) {
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

  try {
    const url = new URL(request.url);
    const date = validDate(url.searchParams.get("date")) ?? todayInSaoPaulo();
    const filters = {
      date,
      search: url.searchParams.get("search"),
      lob: url.searchParams.get("lob"),
      presence: url.searchParams.get("presence"),
      supervisor: url.searchParams.get("supervisor"),
      shift: url.searchParams.get("shift"),
      schedule: url.searchParams.get("schedule")
    };
    const timeline = await getRealtimeHoursTimeline({ date, includeOvernightShiftTail: true });
    const filteredRows = filterRealtimeHoursTimelineRows(timeline.rows, filters);

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
      "Sessões",
      "Máquinas",
      "Usuários Windows",
      "IP",
      "Último sinal"
    ];

    const rows = filteredRows.map((row) => {
      const comparison = compareRealtimeHoursPlannedShift(row, date, timeline.window.calculationEnd);
      const plannedShift = primaryRealtimeHoursPlannedShift(row, date);
      const shiftActivity = realtimeHoursShiftDateActivity(row, date, timeline.window.calculationEnd);

      return [
        new Date(`${date}T12:00:00.000-03:00`),
        row.employeeName || row.wbLogin || row.windowsUser || row.hostname,
        row.wbLogin,
        row.employeeId,
        presenceStatusLabel(row.currentStatus),
        row.lob || "Sem LOB",
        row.supervisor || "Sem supervisor",
        row.shift || "Sem turno",
        plannedShift ? realtimeHoursScheduleStatusLabel(plannedShift.status) : "Sem escala",
        realtimeHoursPlannedShiftLabel(row, date),
        plannedShift ? new Date(plannedShift.start) : null,
        plannedShift ? new Date(plannedShift.end) : null,
        shiftActivity.firstActiveAt !== null ? new Date(shiftActivity.firstActiveAt) : null,
        shiftActivity.lastActiveAt !== null ? new Date(shiftActivity.lastActiveAt) : null,
        durationForExcel(shiftActivity.activeMs),
        durationForExcel(shiftActivity.noActivityMs),
        durationForExcel(comparison.arrivalDelayMs),
        shiftActivity.sessionCount,
        row.hostnames.join(", ") || row.hostname,
        row.windowsUsers.join(", ") || row.windowsUser,
        row.ipAddress,
        row.lastSeenAt ? new Date(row.lastSeenAt) : null
      ];
    });

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
        21: "dd/mm/yyyy hh:mm:ss"
      }
    });
  } catch (error) {
    console.error("[realtime-hours/export] erro inesperado", error);
    return NextResponse.json(
      { success: false, error: "Não foi possível gerar a exportação da Captura de Horas.", message: "Não foi possível gerar a exportação da Captura de Horas." },
      { status: 500 }
    );
  }
}

function durationForExcel(milliseconds: number) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return 0;
  return milliseconds / millisecondsPerDay;
}

function presenceStatusLabel(status: string) {
  const labels: Record<string, string> = {
    ONLINE: "Online",
    LOCKED: "Tela bloqueada",
    IDLE: "Ocioso",
    OFFLINE: "Offline"
  };
  return labels[status] ?? status;
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
