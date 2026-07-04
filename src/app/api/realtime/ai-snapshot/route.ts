import { NextResponse } from "next/server";

import { getRealtimeAiSnapshot, validateRealtimeReportToken, type RealtimeAiSnapshotQuery } from "@/lib/realtime-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const tokenValidation = validateRealtimeReportToken(request.headers.get("authorization"));
  if ("error" in tokenValidation) {
    return NextResponse.json(
      { success: false, error: tokenValidation.error, message: tokenValidation.error },
      { status: tokenValidation.status }
    );
  }

  const { searchParams } = new URL(request.url);
  const query: RealtimeAiSnapshotQuery = {
    cycleDownload: optionalParam(searchParams, "cycleDownload"),
    reportLob: optionalParam(searchParams, "reportLob"),
    requiredLob: optionalParam(searchParams, "requiredLob"),
    limit: optionalParam(searchParams, "limit"),
    agentLimit: optionalParam(searchParams, "agentLimit"),
    queueLimit: optionalParam(searchParams, "queueLimit"),
    departmentLimit: optionalParam(searchParams, "departmentLimit"),
    search: optionalParam(searchParams, "search"),
    crossingStatus: optionalParam(searchParams, "crossingStatus"),
    personType: optionalParam(searchParams, "personType"),
    employeeStatus: optionalParam(searchParams, "employeeStatus"),
    presenceStatus: optionalParam(searchParams, "presenceStatus"),
    lob: optionalParam(searchParams, "lob"),
    supervisor: optionalParam(searchParams, "supervisor"),
    shift: optionalParam(searchParams, "shift"),
    skill: optionalParam(searchParams, "skill"),
    roleTitle: optionalParam(searchParams, "roleTitle"),
    queueSearch: optionalParam(searchParams, "queueSearch"),
    queueLob: optionalParam(searchParams, "queueLob"),
    queueStatus: optionalParam(searchParams, "queueStatus"),
    queueSlaTarget: optionalParam(searchParams, "queueSlaTarget"),
    queueId: optionalParam(searchParams, "queueId"),
    sortBy: optionalParam(searchParams, "sortBy")
  };

  const result = await getRealtimeAiSnapshot(query);
  if ("error" in result) {
    return NextResponse.json(
      { success: false, error: result.error, message: result.error },
      { status: result.status }
    );
  }

  return NextResponse.json(result, {
    headers: {
      "Cache-Control": "no-store"
    }
  });
}

function optionalParam(searchParams: URLSearchParams, key: string) {
  const value = searchParams.get(key);
  return value === null || value.trim() === "" ? undefined : value.trim();
}
