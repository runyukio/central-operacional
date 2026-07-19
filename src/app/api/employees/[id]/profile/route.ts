import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { errorResponse, errorStatus } from "@/lib/api-errors";
import { getEmployeeProfileDashboard, isApiProfileError } from "@/lib/employee-profile-service";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await getApiActor();
  const result = await getEmployeeProfileDashboard(actor, id);
  if (isApiProfileError(result)) return errorResponse(result, errorStatus(result));
  return NextResponse.json(result);
}
