import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { errorStatus } from "@/lib/api-errors";
import { exportStaffCoverageXlsxData } from "@/lib/staff-coverage-service";
import { buildXlsxResponse } from "@/lib/xlsx-export";

export async function GET(request: Request) {
  const actor = await getApiActor();
  const url = new URL(request.url);
  const result = await exportStaffCoverageXlsxData(actor, {
    startDate: url.searchParams.get("startDate") ?? undefined,
    endDate: url.searchParams.get("endDate") ?? undefined,
    lob: url.searchParams.get("lob") ?? undefined,
    shift: url.searchParams.get("shift") ?? undefined,
    supervisor: url.searchParams.get("supervisor") ?? undefined,
    skill: url.searchParams.get("skill") ?? undefined,
    roleTitle: url.searchParams.get("roleTitle") ?? undefined
  });
  if ("error" in result) return NextResponse.json(result, { status: errorStatus(result as any) });
  return buildXlsxResponse(result);
}
