import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { exportRealtimeAgents } from "@/lib/realtime-service";
import { buildXlsxResponse } from "@/lib/xlsx-export";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await getApiActor();
  const { searchParams } = new URL(request.url);
  const result = await exportRealtimeAgents(actor, {
    cycleDownload: searchParams.get("cycleDownload") ?? undefined,
    view: searchParams.get("view"),
    search: searchParams.get("search"),
    crossingStatus: searchParams.get("crossingStatus"),
    personType: searchParams.get("personType"),
    employeeStatus: searchParams.get("employeeStatus"),
    lob: searchParams.get("lob"),
    supervisor: searchParams.get("supervisor"),
    shift: searchParams.get("shift"),
    skill: searchParams.get("skill"),
    roleTitle: searchParams.get("roleTitle"),
    queueSearch: searchParams.get("queueSearch"),
    queueLob: searchParams.get("queueLob"),
    queueStatus: searchParams.get("queueStatus"),
    queueSlaTarget: searchParams.get("queueSlaTarget"),
    queueId: searchParams.get("queueId"),
    sortBy: searchParams.get("sortBy")
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error, message: result.error }, { status: result.status ?? 400 });
  }

  return buildXlsxResponse(result);
}
