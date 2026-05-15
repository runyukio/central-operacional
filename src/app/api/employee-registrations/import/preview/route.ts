import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import { errorResponse, errorStatus, mapZodError } from "@/lib/api-errors";
import { previewEmployeeImport } from "@/lib/employee-registration-service";

const schema = z.object({
  rows: z.array(z.record(z.unknown())).default([])
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return errorResponse(mapZodError(parsed.error));
  }

  const actor = await getApiActor();
  const result = await previewEmployeeImport(actor, parsed.data.rows);
  if ("error" in result) return NextResponse.json(result, { status: errorStatus(result as any) });

  return NextResponse.json(result);
}
