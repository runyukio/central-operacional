import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import { errorResponse, errorStatus, mapZodError } from "@/lib/api-errors";
import { previewCaptureWorkHoursImport } from "@/lib/work-hours-capture-integration-service";

const filtersSchema = z.object({
  shiftDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  employeeId: z.string().optional(),
  lob: z.string().optional(),
  supervisor: z.string().optional(),
  shift: z.string().optional(),
  collaborator: z.string().optional(),
  employeeStatus: z.string().optional()
});

export async function POST(request: Request) {
  const parsed = filtersSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return errorResponse(mapZodError(parsed.error));
  const result = await previewCaptureWorkHoursImport(await getApiActor(), parsed.data);
  if ("error" in result) return NextResponse.json(result, { status: errorStatus(result as any) });
  return NextResponse.json(result);
}
