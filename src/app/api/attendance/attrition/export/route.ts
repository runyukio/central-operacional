import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { exportAttritionXlsxData } from "@/lib/schedule-service";
import { buildXlsxResponse } from "@/lib/xlsx-export";

export async function GET(request: Request) {
  const actor = await getApiActor();
  const url = new URL(request.url);
  const result = await exportAttritionXlsxData(actor, {
    date: url.searchParams.get("date") ?? undefined,
    startDate: url.searchParams.get("startDate") ?? undefined,
    endDate: url.searchParams.get("endDate") ?? undefined,
    month: url.searchParams.get("month") ? Number(url.searchParams.get("month")) : undefined,
    year: url.searchParams.get("year") ? Number(url.searchParams.get("year")) : undefined,
    lob: url.searchParams.get("lob") ?? undefined,
    supervisor: url.searchParams.get("supervisor") ?? undefined,
    shift: url.searchParams.get("shift") ?? undefined,
    collaborator: url.searchParams.get("collaborator") ?? undefined,
    roleTitle: url.searchParams.get("roleTitle") ?? undefined,
    skill: url.searchParams.get("skill") ?? undefined
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error, message: result.error }, { status: result.status ?? 400 });
  }

  return buildXlsxResponse(result);
}
