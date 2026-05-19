import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { exportShiftReports } from "@/lib/shift-report-service";

export async function GET(request: Request) {
  const actor = await getApiActor();
  const url = new URL(request.url);
  const format = url.searchParams.get("format") ?? "csv";
  const payload = await exportShiftReports(actor, {
    startDate: url.searchParams.get("startDate") ?? undefined,
    endDate: url.searchParams.get("endDate") ?? undefined,
    shift: url.searchParams.get("shift") ?? undefined,
    lob: url.searchParams.get("lob") ?? undefined,
    rta: url.searchParams.get("rta") ?? undefined,
    importance: url.searchParams.get("importance") ?? undefined,
    mood: url.searchParams.get("mood") ?? undefined,
    followUp: url.searchParams.get("followUp") ?? undefined,
    search: url.searchParams.get("search") ?? undefined
  });

  if (format === "json") {
    return NextResponse.json({ reports: payload.data, dashboard: payload.dashboard });
  }

  return new NextResponse(payload.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="reports_turno.csv"'
    }
  });
}
