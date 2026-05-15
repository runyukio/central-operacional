import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
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
    return NextResponse.json({ error: "Dados inválidos", issues: parsed.error.flatten() }, { status: 400 });
  }

  const actor = await getApiActor();
  const result = await commitOperationalScheduleImport(actor, parsed.data);

  if ("error" in result) {
    return NextResponse.json(result, { status: 409 });
  }

  return NextResponse.json(result);
}
