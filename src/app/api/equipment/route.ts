import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import { createEquipment, listEquipment } from "@/lib/mock-db";

const schema = z.object({
  code: z.string().min(1),
  type: z.string().min(1),
  employeeId: z.string().optional(),
  status: z.string().min(1),
  impact: z.string().min(1)
});

export async function GET() {
  const actor = await getApiActor();
  return NextResponse.json({ data: listEquipment(actor) });
}

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos", issues: parsed.error.flatten() }, { status: 400 });
  }
  const actor = await getApiActor();
  const result = createEquipment(actor, parsed.data);

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }

  return NextResponse.json(result, { status: 201 });
}
