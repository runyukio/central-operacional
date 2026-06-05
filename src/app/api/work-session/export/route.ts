import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { errorStatus } from "@/lib/api-errors";
import { exportWorkSessionXlsxData } from "@/lib/work-session-service";
import { buildXlsxResponse } from "@/lib/xlsx-export";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await getApiActor();
  const url = new URL(request.url);
  const result = await exportWorkSessionXlsxData(actor, {
    date: url.searchParams.get("date") ?? undefined,
    lob: url.searchParams.get("lob") ?? undefined,
    supervisor: url.searchParams.get("supervisor") ?? undefined,
    roleTitle: url.searchParams.get("roleTitle") ?? undefined,
    skill: url.searchParams.get("skill") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    collaborator: url.searchParams.get("collaborator") ?? undefined,
    wbLogin: url.searchParams.get("wbLogin") ?? undefined,
    employeeId: url.searchParams.get("employeeId") ?? undefined
  });
  if ("error" in result) return NextResponse.json(result, { status: errorStatus(result as any) });
  return buildXlsxResponse(result);
}
