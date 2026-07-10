import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { prisma } from "@/lib/prisma";
import { applyApprovedRealtimeHoursAdjustments } from "@/lib/realtime-hours-adjustments-service";
import { canAccessOwnRealtimeHours } from "@/lib/realtime-hours-permissions";
import { getRealtimeHoursTimeline } from "@/lib/realtime-hours-service";

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
      error: "Não encontrei um vínculo de colaborador para seu login.",
      message: "Não encontrei um vínculo de colaborador para seu login. Peça ao supervisor para conferir seu cadastro/vínculo."
    }, { status: 404 });
  }

  const url = new URL(request.url);
  const result = await getRealtimeHoursTimeline({
    date: url.searchParams.get("date"),
    search: url.searchParams.get("search")
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
    employee: {
      id: employee.id,
      wbLogin: employee.wbLogin,
      fullName: employee.fullName,
      roleTitle: employee.roleTitle,
      lob: employee.lob?.name ?? "",
      shift: employee.shift?.name ?? ""
    }
  });
}

function normalizeLogin(value?: string | null) {
  return String(value ?? "").trim().toLowerCase();
}
