import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import { redeemReward } from "@/lib/mock-db";

const schema = z.object({
  employeeId: z.string().min(1).optional(),
  rewardId: z.string().min(1),
  balance: z.number().int().nonnegative().optional(),
  cost: z.number().int().positive().optional()
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos", issues: parsed.error.flatten() }, { status: 400 });
  }

  const actor = await getApiActor();
  const result = redeemReward(actor, parsed.data);

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }

  return NextResponse.json(result);
}
