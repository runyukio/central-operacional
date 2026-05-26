import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { exportJustifiedAbsencesCsv } from "@/lib/schedule-service";

export async function GET(request: Request) {
  const actor = await getApiActor();
  const url = new URL(request.url);
  const startDate = url.searchParams.get("startDate") ?? undefined;
  const endDate = url.searchParams.get("endDate") ?? undefined;
  const result = await exportJustifiedAbsencesCsv(actor, {
    date: url.searchParams.get("date") ?? undefined,
    startDate,
    endDate,
    month: url.searchParams.get("month") ? Number(url.searchParams.get("month")) : undefined,
    year: url.searchParams.get("year") ? Number(url.searchParams.get("year")) : undefined,
    lob: url.searchParams.get("lob") ?? undefined,
    supervisor: url.searchParams.get("supervisor") ?? undefined,
    shift: url.searchParams.get("shift") ?? undefined,
    collaborator: url.searchParams.get("collaborator") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    roleTitle: url.searchParams.get("roleTitle") ?? undefined,
    reason: url.searchParams.get("reason") ?? undefined
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error, message: result.error }, { status: result.status ?? 400 });
  }

  const fileStart = startDate ?? "inicio";
  const fileEnd = endDate ?? startDate ?? "fim";
  return new NextResponse(result.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="faltas_justificadas_${fileStart}_${fileEnd}.csv"`,
      "Cache-Control": "no-store"
    }
  });
}
