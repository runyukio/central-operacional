import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import { EngagementError, submitClimateSurveyAnswer } from "@/lib/engagement-service";

const schema = z.object({
  surveyId: z.string().min(1),
  answers: z.array(z.object({ questionId: z.string().min(1), value: z.any() }))
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos", issues: parsed.error.flatten() }, { status: 400 });
  }
  const actor = await getApiActor();
  try {
    return NextResponse.json(await submitClimateSurveyAnswer(actor, parsed.data), { status: 201 });
  } catch (error) {
    if (error instanceof EngagementError) {
      return NextResponse.json({ error: error.message, message: error.message }, { status: error.status });
    }
    console.error("[climate/answers] erro inesperado", error);
    return NextResponse.json({ error: "Não foi possível salvar a resposta da pesquisa." }, { status: 500 });
  }
}
