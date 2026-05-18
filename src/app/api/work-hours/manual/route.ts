import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import { errorResponse, errorStatus, mapZodError } from "@/lib/api-errors";
import { upsertManualWorkHourRecord } from "@/lib/work-hours-service";

const manualWorkHourSchema = z.object({
  employeeId: z.string().min(1),
  date: z.string().min(1),
  actualStart: z.string().optional(),
  actualEnd: z.string().optional(),
  breakMinutes: z.coerce.number().optional(),
  actualHours: z.coerce.number().optional(),
  observation: z.string().optional(),
  source: z.string().optional(),
  confirmOverwrite: z.boolean().optional()
});

export async function POST(request: Request) {
  const parsed = manualWorkHourSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return errorResponse(mapZodError(parsed.error));

  const actor = await getApiActor();
  const result = await upsertManualWorkHourRecord(actor, parsed.data);
  if ("error" in result) return NextResponse.json(result, { status: errorStatus(result as any) });
  return NextResponse.json(result);
}
