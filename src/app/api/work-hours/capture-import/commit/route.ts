import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import { errorResponse, errorStatus, mapZodError } from "@/lib/api-errors";
import { commitCaptureWorkHoursImport } from "@/lib/work-hours-capture-integration-service";
import { capturePeriodShape, validateCapturePeriod } from "@/lib/work-hours-capture-period-schema";

const inputSchema = z.object({
  ...capturePeriodShape,
  employeeId: z.string().optional(),
  lob: z.string().optional(),
  supervisor: z.string().optional(),
  shift: z.string().optional(),
  collaborator: z.string().optional(),
  employeeStatus: z.string().optional(),
  confirmReprocessing: z.boolean().optional()
}).superRefine(validateCapturePeriod);

export async function POST(request: Request) {
  const parsed = inputSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return errorResponse(mapZodError(parsed.error));
  const result = await commitCaptureWorkHoursImport(await getApiActor(), parsed.data);
  if ("error" in result) {
    const status = "code" in result && result.code === "REPROCESS_CONFIRMATION_REQUIRED" ? 409 : errorStatus(result as any);
    return NextResponse.json(result, { status });
  }
  return NextResponse.json(result);
}
