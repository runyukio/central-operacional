import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { exportShiftReportWorkspace } from "@/lib/shift-report-workspace-service";
import { buildXlsxResponse } from "@/lib/xlsx-export";

export async function GET(request: Request) {
  const actor = await getApiActor();
  const url = new URL(request.url);
  const payload = await exportShiftReportWorkspace(actor, {
    startDate: url.searchParams.get("startDate") ?? undefined,
    endDate: url.searchParams.get("endDate") ?? undefined,
    shift: url.searchParams.get("shift") ?? undefined,
    lob: url.searchParams.get("lob") ?? undefined,
    responsible: url.searchParams.get("responsible") ?? undefined,
    importance: url.searchParams.get("importance") ?? undefined,
    mood: url.searchParams.get("mood") ?? undefined,
    search: url.searchParams.get("search") ?? undefined
  });
  if ("error" in payload) return NextResponse.json({ error: payload.error }, { status: 403 });
  return buildXlsxResponse(payload);
}
