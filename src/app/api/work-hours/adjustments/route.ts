import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import { errorResponse, errorStatus, mapZodError } from "@/lib/api-errors";
import { reviewWorkHourAdjustment } from "@/lib/work-hours-service";

const reviewSchema = z.object({
  id: z.string().min(1),
  action: z.enum(["approve", "reject"]),
  rejectionReason: z.string().optional()
});

export async function PATCH(request: Request) {
  const parsed = reviewSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return errorResponse(mapZodError(parsed.error));

  const actor = await getApiActor();
  const result = await reviewWorkHourAdjustment(actor, parsed.data);
  if ("error" in result) return NextResponse.json(result, { status: errorStatus(result as any) });
  return NextResponse.json(result);
}
