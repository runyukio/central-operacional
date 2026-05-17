import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { errorResponse, errorStatus } from "@/lib/api-errors";
import { getOperationalEmployeeDetail } from "@/lib/employee-service";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const actor = await getApiActor();
  const result = await getOperationalEmployeeDetail(actor, params.id);
  if ("error" in result) return errorResponse(result, errorStatus(result));
  return NextResponse.json(result);
}
