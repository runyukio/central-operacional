import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { getShiftReportWorkspaceOptions } from "@/lib/shift-report-workspace-service";

export async function GET() {
  const actor = await getApiActor();
  const result = await getShiftReportWorkspaceOptions(actor);
  return NextResponse.json(result, { status: "error" in result ? 403 : 200 });
}
