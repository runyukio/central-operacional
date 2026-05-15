import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import { saveClimateAnswer } from "@/lib/mock-db";

const schema = z.object({
  surveyId: z.string().min(1),
  answers: z.array(z.object({ questionId: z.string().min(1), value: z.unknown() }))
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos", issues: parsed.error.flatten() }, { status: 400 });
  }
  const actor = await getApiActor();
  return NextResponse.json({ data: saveClimateAnswer(actor, parsed.data), anonymousAggregateOnly: false }, { status: 201 });
}
