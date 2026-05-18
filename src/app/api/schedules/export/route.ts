import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { errorStatus } from "@/lib/api-errors";
import { exportOperationalSchedulesCsv } from "@/lib/schedule-service";

export async function GET(request: Request) {
  const actor = await getApiActor();
  const url = new URL(request.url);
  const result = await exportOperationalSchedulesCsv(actor, {
    startDate: url.searchParams.get("startDate") ?? undefined,
    endDate: url.searchParams.get("endDate") ?? undefined,
    month: Number(url.searchParams.get("month")) || undefined,
    year: Number(url.searchParams.get("year")) || undefined,
    collaborator: url.searchParams.get("collaborator") ?? undefined,
    lob: url.searchParams.get("lob") ?? undefined,
    supervisor: url.searchParams.get("supervisor") ?? undefined,
    shift: url.searchParams.get("shift") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    roleTitle: url.searchParams.get("roleTitle") ?? undefined
  });

  if ("error" in result) {
    return NextResponse.json(result, { status: errorStatus(result as any) || 403 });
  }

  return new NextResponse(result.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="escalas_consolidadas.csv"'
    }
  });
}
