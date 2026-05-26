import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import { createMonthlyAdvanceChangeRequest } from "@/lib/monthly-advance-service";

const changeSchema = z.object({
  referenceMonth: z.string().min(1),
  requestedOptIn: z.boolean(),
  reason: z.string().min(1),
  observation: z.string().optional()
});

export async function POST(request: Request) {
  const parsed = changeSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Motivo é obrigatório.", message: "Motivo é obrigatório." }, { status: 400 });
  }

  const actor = await getApiActor();
  const result = await createMonthlyAdvanceChangeRequest(actor, parsed.data);
  if ("error" in result) return NextResponse.json({ error: result.error, message: result.error }, { status: result.status ?? 400 });
  return NextResponse.json(result, { status: 201 });
}
