import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import { errorResponse, errorStatus, mapZodError } from "@/lib/api-errors";
import { previewCaptureWorkHoursImport } from "@/lib/work-hours-capture-integration-service";
import { capturePeriodShape, validateCapturePeriod } from "@/lib/work-hours-capture-period-schema";

const filtersSchema = z.object({
  ...capturePeriodShape,
  employeeId: z.string().optional(),
  lob: z.string().optional(),
  supervisor: z.string().optional(),
  shift: z.string().optional(),
  collaborator: z.string().optional(),
  employeeStatus: z.string().optional()
}).superRefine(validateCapturePeriod);

export async function POST(request: Request) {
  const parsed = filtersSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return errorResponse(mapZodError(parsed.error));
  const result = await previewCaptureWorkHoursImport(await getApiActor(), parsed.data);
  if ("error" in result) return NextResponse.json(result, { status: errorStatus(result as any) });
  return NextResponse.json(result);
}
