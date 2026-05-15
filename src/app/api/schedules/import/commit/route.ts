import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import { errorStatus, mapZodError, errorResponse } from "@/lib/api-errors";
import { commitOperationalScheduleImport } from "@/lib/schedule-service";

const commitSchema = z.object({
  fileName: z.string().min(1),
  allowPartial: z.boolean().default(false),
  rows: z.array(z.record(z.unknown())).default([])
});

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = commitSchema.safeParse(body);

  if (!parsed.success) {
    return errorResponse(mapZodError(parsed.error));
  }

  const actor = await getApiActor();
  const result = await commitOperationalScheduleImport(actor, parsed.data);

  if ("error" in result) {
    return NextResponse.json(result, { status: errorStatus(result as any) || 409 });
  }

  return NextResponse.json(result);
}
