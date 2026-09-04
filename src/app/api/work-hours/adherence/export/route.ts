import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { errorStatus } from "@/lib/api-errors";
import { exportWorkHourAdherenceJustifications } from "@/lib/work-hours-capture-integration-service";
import { buildXlsxResponse } from "@/lib/xlsx-export";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const result = await exportWorkHourAdherenceJustifications(await getApiActor(), {
    startDate: url.searchParams.get("startDate") ?? undefined,
    endDate: url.searchParams.get("endDate") ?? undefined,
    employeeId: url.searchParams.get("employeeId") ?? undefined,
    lob: url.searchParams.get("lob") ?? undefined,
    supervisor: url.searchParams.get("supervisor") ?? undefined,
    shift: url.searchParams.get("shift") ?? undefined,
    employeeStatus: url.searchParams.get("employeeStatus") ?? undefined,
    collaborator: url.searchParams.get("collaborator") ?? undefined
  });
  if ("error" in result) return NextResponse.json(result, { status: errorStatus(result) });
  return buildXlsxResponse(result);
}
