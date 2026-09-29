import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { errorStatus } from "@/lib/api-errors";
import { exportOperationalWorkHoursXlsxData } from "@/lib/work-hours-service";
import { buildXlsxResponse } from "@/lib/xlsx-export";

export const maxDuration = 300;

export async function GET(request: Request) {
  const startedAt = Date.now();
  const log = { route: "/api/work-hours/export", requestId: request.headers.get("x-vercel-id") };
  console.info({ ...log, event: "start" });
  try {
    const response = await exportResponse(request);
    console.info({ ...log, event: "done", status: response.status, durationMs: Date.now() - startedAt });
    return response;
  } catch (error) {
    console.error({ ...log, event: "failed", error: error instanceof Error ? error.name : "UnknownError", durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Não foi possível exportar as horas. Tente novamente ou selecione um período menor." }, { status: 500 });
  }
}

async function exportResponse(request: Request) {
  const actor = await getApiActor();
  const url = new URL(request.url);
  const result = await exportOperationalWorkHoursXlsxData(actor, {
    startDate: url.searchParams.get("startDate") ?? undefined,
    endDate: url.searchParams.get("endDate") ?? undefined,
    employeeId: url.searchParams.get("employeeId") ?? undefined,
    lob: url.searchParams.get("lob") ?? undefined,
    supervisor: url.searchParams.get("supervisor") ?? undefined,
    shift: url.searchParams.get("shift") ?? undefined,
    collaborator: url.searchParams.get("collaborator") ?? undefined,
    wbLogin: url.searchParams.get("wbLogin") ?? undefined,
    employeeStatus: url.searchParams.get("employeeStatus") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    overtimeOnly: url.searchParams.get("overtimeOnly") === "true",
    hoursPendingOnly: url.searchParams.get("hoursPendingOnly") === "true",
    divergentOnly: url.searchParams.get("divergentOnly") === "true",
    pendingOnly: url.searchParams.get("pendingOnly") === "true",
    noScheduleOnly: url.searchParams.get("noScheduleOnly") === "true"
  });

  if (!("headers" in result) || !result.headers) {
    return NextResponse.json(result, { status: "status" in result && typeof result.status === "number" ? result.status : errorStatus(result as any) });
  }

  return buildXlsxResponse(result);
}
