import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { errorStatus } from "@/lib/api-errors";
import { getStaffCoverageDetails } from "@/lib/staff-coverage-service";

export async function GET(request: Request) {
  const actor = await getApiActor();
  const url = new URL(request.url);
  const result = await getStaffCoverageDetails(actor, {
    date: url.searchParams.get("date") ?? undefined,
    lob: url.searchParams.get("lob") ?? undefined,
    shift: url.searchParams.get("shift") ?? undefined,
    supervisor: url.searchParams.get("supervisor") ?? undefined,
    skill: url.searchParams.get("skill") ?? undefined,
    page: url.searchParams.get("page") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined
  });
  if ("error" in result) return NextResponse.json(result, { status: (result as { status?: number }).status ?? errorStatus(result as any) });
  return NextResponse.json(result);
}
