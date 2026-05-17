import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { errorStatus } from "@/lib/api-errors";
import { exportOperationalWorkHoursCsv } from "@/lib/work-hours-service";

export async function GET(request: Request) {
  const actor = await getApiActor();
  const url = new URL(request.url);
  const result = await exportOperationalWorkHoursCsv(actor, {
    startDate: url.searchParams.get("startDate") ?? undefined,
    endDate: url.searchParams.get("endDate") ?? undefined,
    lob: url.searchParams.get("lob") ?? undefined,
    supervisor: url.searchParams.get("supervisor") ?? undefined,
    shift: url.searchParams.get("shift") ?? undefined,
    collaborator: url.searchParams.get("collaborator") ?? undefined,
    wbLogin: url.searchParams.get("wbLogin") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    divergentOnly: url.searchParams.get("divergentOnly") === "true",
    pendingOnly: url.searchParams.get("pendingOnly") === "true",
    noScheduleOnly: url.searchParams.get("noScheduleOnly") === "true"
  });

  if (!("csv" in result)) return NextResponse.json(result, { status: errorStatus(result as any) });

  return new NextResponse(result.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="horas_operacionais.csv"'
    }
  });
}
