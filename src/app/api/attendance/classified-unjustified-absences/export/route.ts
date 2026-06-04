import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { exportClassifiedUnjustifiedAbsencesXlsxData } from "@/lib/schedule-service";
import { buildXlsxResponse } from "@/lib/xlsx-export";

export async function GET(request: Request) {
  const actor = await getApiActor();
  const url = new URL(request.url);
  const startDate = url.searchParams.get("startDate") ?? undefined;
  const endDate = url.searchParams.get("endDate") ?? undefined;
  const result = await exportClassifiedUnjustifiedAbsencesXlsxData(actor, {
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
    skill: url.searchParams.get("skill") ?? undefined,
    reason: url.searchParams.get("reason") ?? undefined
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error, message: result.error }, { status: result.status ?? 400 });
  }

  return buildXlsxResponse(result);
}
