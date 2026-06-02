import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import { errorResponse, errorStatus, mapZodError } from "@/lib/api-errors";
import { deleteWorkHourRecord, listOperationalWorkHours, requestWorkHourAdjustment } from "@/lib/work-hours-service";

const adjustmentSchema = z.object({
  workHourRecordId: z.string().min(1),
  requestedActualHours: z.union([z.string(), z.number()]).optional(),
  reason: z.string().optional(),
  justification: z.string().optional()
});

const deleteSchema = z.object({
  workHourRecordId: z.string().min(1),
  reason: z.string().optional()
});

export async function GET(request: Request) {
  const actor = await getApiActor();
  const url = new URL(request.url);
  const result = await listOperationalWorkHours(actor, {
    startDate: url.searchParams.get("startDate") ?? undefined,
    endDate: url.searchParams.get("endDate") ?? undefined,
    lob: url.searchParams.get("lob") ?? undefined,
    supervisor: url.searchParams.get("supervisor") ?? undefined,
    shift: url.searchParams.get("shift") ?? undefined,
    collaborator: url.searchParams.get("collaborator") ?? undefined,
    wbLogin: url.searchParams.get("wbLogin") ?? undefined,
    employeeStatus: url.searchParams.get("employeeStatus") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    divergentOnly: url.searchParams.get("divergentOnly") === "true",
    pendingOnly: url.searchParams.get("pendingOnly") === "true",
    noScheduleOnly: url.searchParams.get("noScheduleOnly") === "true",
    source: url.searchParams.get("source") ?? undefined,
    scope: url.searchParams.get("scope") === "mine" ? "mine" : "all",
    page: Number(url.searchParams.get("page") ?? 1),
    limit: Number(url.searchParams.get("limit") ?? 50)
  });
  if ("error" in result) return NextResponse.json(result, { status: "type" in result ? errorStatus(result as any) : 400 });
  return NextResponse.json(result);
}

export async function POST(request: Request) {
  const parsed = adjustmentSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return errorResponse(mapZodError(parsed.error));

  const actor = await getApiActor();
  const result = await requestWorkHourAdjustment(actor, parsed.data);
  if ("error" in result) return NextResponse.json(result, { status: errorStatus(result as any) });
  return NextResponse.json(result);
}

export async function DELETE(request: Request) {
  const parsed = deleteSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return errorResponse(mapZodError(parsed.error));

  const actor = await getApiActor();
  const result = await deleteWorkHourRecord(actor, parsed.data);
  if ("error" in result) return NextResponse.json(result, { status: errorStatus(result as any) });
  return NextResponse.json(result);
}
