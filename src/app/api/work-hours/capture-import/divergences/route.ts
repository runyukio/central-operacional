import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import { errorResponse, errorStatus, mapZodError } from "@/lib/api-errors";
import {
  listCaptureWorkHourDivergences,
  resolveCaptureWorkHourDivergence
} from "@/lib/work-hours-capture-integration-service";

const actionSchema = z.object({
  id: z.string().min(1),
  action: z.enum(["CONFIRM_PRESENCE", "CONFIRM_ATTENDANCE", "CONFIRM_ABSENCE", "CONFIRM_DAY_OFF", "KEEP_PENDING"]),
  confirmed: z.boolean()
});

export async function GET(request: Request) {
  const actor = await getApiActor();
  const url = new URL(request.url);
  const result = await listCaptureWorkHourDivergences(actor, {
    startDate: url.searchParams.get("startDate") ?? undefined,
    endDate: url.searchParams.get("endDate") ?? undefined,
    employeeId: url.searchParams.get("employeeId") ?? undefined,
    lob: url.searchParams.get("lob") ?? undefined,
    supervisor: url.searchParams.get("supervisor") ?? undefined,
    shift: url.searchParams.get("shift") ?? undefined,
    collaborator: url.searchParams.get("collaborator") ?? undefined,
    employeeStatus: url.searchParams.get("employeeStatus") ?? undefined
  });
  if ("error" in result) return NextResponse.json(result, { status: errorStatus(result as any) });
  return NextResponse.json(result);
}

export async function PATCH(request: Request) {
  const parsed = actionSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return errorResponse(mapZodError(parsed.error));
  const result = await resolveCaptureWorkHourDivergence(await getApiActor(), parsed.data);
  if ("error" in result) return NextResponse.json(result, { status: errorStatus(result as any) });
  return NextResponse.json(result);
}
