import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { errorStatus } from "@/lib/api-errors";
import { listRequiredStaffCoverage } from "@/lib/required-staff-service";

export async function GET(request: Request) {
  const actor = await getApiActor();
  const url = new URL(request.url);
  const result = await listRequiredStaffCoverage(actor, {
    startDate: url.searchParams.get("startDate") ?? undefined,
    endDate: url.searchParams.get("endDate") ?? undefined,
    lob: url.searchParams.get("lob") ?? undefined,
    shift: url.searchParams.get("shift") ?? undefined,
    supervisor: url.searchParams.get("supervisor") ?? undefined,
    includeRta: url.searchParams.get("includeRta") ?? undefined
  });
  if ("error" in result) return NextResponse.json(result, { status: errorStatus(result as any) });
  return NextResponse.json(result);
}
