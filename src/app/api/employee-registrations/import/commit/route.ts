import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import { importEmployeeRows } from "@/lib/employee-registration-service";

const schema = z.object({
  rows: z.array(z.record(z.unknown())).default([]),
  allowPartial: z.boolean().optional()
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos para importação.", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const actor = await getApiActor();
  const result = await importEmployeeRows(actor, parsed.data.rows, Boolean(parsed.data.allowPartial));
  if ("error" in result) return NextResponse.json(result, { status: 409 });

  return NextResponse.json(result);
}
