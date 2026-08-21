import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { prisma } from "@/lib/prisma";
import { applyApprovedRealtimeHoursAdjustments, applyApprovedRealtimeHoursAdjustmentsForRange } from "@/lib/realtime-hours-adjustments-service";
import { canAccessOwnRealtimeHours } from "@/lib/realtime-hours-permissions";
import { getRealtimeHoursTimeline, getRealtimeHoursTimelineRange } from "@/lib/realtime-hours-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await getApiActor();
  if (!actor.email) {
    return NextResponse.json({ success: false, error: "Faça login para visualizar suas horas.", message: "Faça login para visualizar suas horas." }, { status: 401 });
  }
  if (!canAccessOwnRealtimeHours({ role: actor.role, email: actor.email, name: actor.name, roleTitle: actor.roleTitle, jobTitle: actor.jobTitle, skill: actor.skill, status: "ACTIVE" })) {
    return NextResponse.json({ success: false, error: "Você não tem permissão para visualizar horas capturadas.", message: "Você não tem permissão para visualizar horas capturadas." }, { status: 403 });
  }

  const email = actor.email.trim().toLowerCase();
  const emailLogin = email.split("@")[0] ?? "";
  const employee = await prisma.employeeProfile.findFirst({
    where: {
      OR: [
        { user: { email: { equals: email, mode: "insensitive" } } },
        ...(emailLogin ? [{ wbLogin: { equals: emailLogin, mode: "insensitive" as const } }] : [])
      ]
    },
    select: {
      id: true,
      wbLogin: true,
      fullName: true,
      roleTitle: true,
      lob: { select: { name: true } },
      shift: { select: { name: true } }
    }
  });

  if (!employee) {
    return NextResponse.json({
      success: false,
      error: "Não encontrei um vínculo de parceiro para seu login.",
      message: "Não encontrei um vínculo de parceiro para seu login. Peça ao supervisor para conferir seu cadastro/vínculo."
    }, { status: 404 });
  }

  const url = new URL(request.url);
  const requestedStartDate = url.searchParams.get("startDate");
  const requestedEndDate = url.searchParams.get("endDate");
  if (requestedStartDate || requestedEndDate) {
    const range = resolveDateRange(requestedStartDate, requestedEndDate);
    if ("error" in range) {
      return NextResponse.json({ success: false, error: range.error, message: range.error }, { status: 400 });
    }

    const timelines = await getRealtimeHoursTimelineRange({
      dates: range.dates,
      employeeId: employee.id,
      wbLogin: employee.wbLogin
    });
    const employeeWbLogin = normalizeLogin(employee.wbLogin);
    const adjustedDays = await applyApprovedRealtimeHoursAdjustmentsForRange(timelines.map((timeline) => ({
      date: timeline.date,
      window: timeline.window,
      rows: timeline.rows.filter((row) => row.employeeId === employee.id || normalizeLogin(row.wbLogin) === employeeWbLogin)
    })));
    const days = adjustedDays.map((day) => {
      const activeMs = day.rows.reduce((sum, row) => sum + row.consideredActiveMs, 0);
      const capturedActiveMs = day.rows.reduce((sum, row) => sum + row.capturedActiveMs, 0);
      const noActivityMs = day.rows.reduce((sum, row) => sum + row.consideredNoActivityMs, 0);
      return {
        ...day,
        summary: {
          users: day.rows.length,
          activeMs,
          capturedActiveMs,
          noActivityMs,
          sessions: day.rows.reduce((sum, row) => sum + row.sessionCount, 0),
          approvedAdjustments: day.rows.filter((row) => row.approvedAdjustment).length
        }
      };
    });

    return NextResponse.json({
      success: true,
      range: {
        startDate: range.startDate,
        endDate: range.endDate,
        days: range.dates.length
      },
      summary: {
        users: days.filter((day) => day.rows.length > 0).length,
        activeMs: days.reduce((sum, day) => sum + day.summary.activeMs, 0),
        capturedActiveMs: days.reduce((sum, day) => sum + day.summary.capturedActiveMs, 0),
        noActivityMs: days.reduce((sum, day) => sum + day.summary.noActivityMs, 0),
        sessions: days.reduce((sum, day) => sum + day.summary.sessions, 0),
        approvedAdjustments: days.reduce((sum, day) => sum + day.summary.approvedAdjustments, 0)
      },
      days,
      employee: employeePayload(employee)
    });
  }

  const result = await getRealtimeHoursTimeline({
    date: url.searchParams.get("date"),
    search: url.searchParams.get("search"),
    employeeId: employee.id,
    wbLogin: employee.wbLogin
  });
  const employeeWbLogin = normalizeLogin(employee.wbLogin);
  const rows = await applyApprovedRealtimeHoursAdjustments(
    result.date,
    result.rows.filter((row) => row.employeeId === employee.id || normalizeLogin(row.wbLogin) === employeeWbLogin)
  );
  const activeMs = rows.reduce((sum, row) => sum + row.consideredActiveMs, 0);
  const capturedActiveMs = rows.reduce((sum, row) => sum + row.capturedActiveMs, 0);
  const noActivityMs = rows.reduce((sum, row) => sum + row.consideredNoActivityMs, 0);

  return NextResponse.json({
    ...result,
    summary: {
      users: rows.length,
      activeMs,
      capturedActiveMs,
      noActivityMs,
      sessions: rows.reduce((sum, row) => sum + row.sessionCount, 0),
      approvedAdjustments: rows.filter((row) => row.approvedAdjustment).length
    },
    rows,
    employee: employeePayload(employee)
  });
}

function resolveDateRange(startDate: string | null, endDate: string | null) {
  if (!startDate || !endDate) return { error: "Informe a data inicial e a data final do período." } as const;
  const start = parseInputDate(startDate);
  const end = parseInputDate(endDate);
  if (!start || !end) return { error: "Período inválido. Use datas válidas no formato AAAA-MM-DD." } as const;
  if (start.getTime() > end.getTime()) return { error: "A data inicial não pode ser posterior à data final." } as const;

  const totalDays = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (totalDays > 93) return { error: "Selecione um período de no máximo 93 dias." } as const;

  const dates = Array.from({ length: totalDays }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    return formatInputDate(date);
  });
  return { startDate, endDate, dates } as const;
}

function parseInputDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return formatInputDate(date) === value ? date : null;
}

function formatInputDate(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function employeePayload(employee: {
  id: string;
  wbLogin: string;
  fullName: string;
  roleTitle: string;
  lob: { name: string } | null;
  shift: { name: string } | null;
}) {
  return {
    id: employee.id,
    wbLogin: employee.wbLogin,
    fullName: employee.fullName,
    roleTitle: employee.roleTitle,
    lob: employee.lob?.name ?? "",
    shift: employee.shift?.name ?? ""
  };
}

function normalizeLogin(value?: string | null) {
  return String(value ?? "").trim().toLowerCase();
}
