import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import { errorResponse, errorStatus, mapZodError } from "@/lib/api-errors";
import { commitOperationalWorkHoursImport } from "@/lib/work-hours-service";

const commitSchema = z.object({
  fileName: z.string().min(1),
  allowPartial: z.boolean().default(false),
  rows: z.array(z.record(z.unknown())).default([])
});

export async function POST(request: Request) {
  const parsed = commitSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return errorResponse(mapZodError(parsed.error));

  const actor = await getApiActor();
  const result = await commitOperationalWorkHoursImport(actor, parsed.data);
  if ("error" in result) return NextResponse.json(result, { status: errorStatus(result as any) || 409 });
  return NextResponse.json(result);
}
