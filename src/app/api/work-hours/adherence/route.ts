import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import { errorResponse, errorStatus, mapZodError } from "@/lib/api-errors";
import {
  answerWorkHourAdherenceJustification,
  listWorkHourAdherenceJustifications
} from "@/lib/work-hours-capture-integration-service";

const answerSchema = z.object({ id: z.string().min(1), justification: z.string().trim().min(5) });

export async function GET(request: Request) {
  const url = new URL(request.url);
  const result = await listWorkHourAdherenceJustifications(await getApiActor(), {
    startDate: url.searchParams.get("startDate") ?? undefined,
    endDate: url.searchParams.get("endDate") ?? undefined,
    employeeId: url.searchParams.get("employeeId") ?? undefined,
    lob: url.searchParams.get("lob") ?? undefined,
    supervisor: url.searchParams.get("supervisor") ?? undefined,
    shift: url.searchParams.get("shift") ?? undefined,
    employeeStatus: url.searchParams.get("employeeStatus") ?? undefined,
    collaborator: url.searchParams.get("collaborator") ?? undefined
  });
  if ("error" in result) return NextResponse.json(result, { status: errorStatus(result as any) });
  return NextResponse.json(result);
}

export async function POST(request: Request) {
  const parsed = answerSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return errorResponse(mapZodError(parsed.error));
  const result = await answerWorkHourAdherenceJustification(await getApiActor(), parsed.data);
  if ("error" in result) return NextResponse.json(result, { status: errorStatus(result as any) });
  return NextResponse.json(result);
}
