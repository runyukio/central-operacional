import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { errorResponse, errorStatus } from "@/lib/api-errors";
import { isApiProfileError, searchEmployeeProfiles } from "@/lib/employee-profile-service";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const limit = Number(url.searchParams.get("limit")) || 12;
  const result = await searchEmployeeProfiles(await getApiActor(), q, limit);
  if (isApiProfileError(result)) return errorResponse(result, errorStatus(result));
  return NextResponse.json({ results: result.data });
}
