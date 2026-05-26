import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import {
  createClimateSurvey,
  EngagementError,
  listClimateSurveys,
  updateClimateSurveyStatus
} from "@/lib/engagement-service";

const questionSchema = z.object({
  text: z.string().min(1),
  type: z.string().min(1),
  options: z.array(z.string()).optional(),
  required: z.boolean().optional()
});

const createSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  startsAt: z.string().min(1),
  endsAt: z.string().min(1),
  anonymous: z.boolean().optional(),
  status: z.string().optional(),
  targetType: z.string().optional(),
  targetValue: z.string().optional(),
  questions: z.array(questionSchema).optional()
});

const patchSchema = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  description: z.string().optional(),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
  anonymous: z.boolean().optional(),
  status: z.string().optional(),
  targetType: z.string().optional(),
  targetValue: z.string().optional()
});

export async function GET() {
  const actor = await getApiActor();
  try {
    return NextResponse.json(await listClimateSurveys(actor));
  } catch (error) {
    return engagementErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos", issues: parsed.error.flatten() }, { status: 400 });
  }
  const actor = await getApiActor();
  try {
    return NextResponse.json(await createClimateSurvey(actor, parsed.data), { status: 201 });
  } catch (error) {
    return engagementErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos", issues: parsed.error.flatten() }, { status: 400 });
  }
  const actor = await getApiActor();
  try {
    return NextResponse.json(await updateClimateSurveyStatus(actor, parsed.data));
  } catch (error) {
    return engagementErrorResponse(error);
  }
}

function engagementErrorResponse(error: unknown) {
  if (error instanceof EngagementError) {
    return NextResponse.json({ error: error.message, message: error.message }, { status: error.status });
  }
  console.error("[climate/surveys] erro inesperado", error);
  return NextResponse.json({ error: "Não foi possível processar Pesquisa de Clima." }, { status: 500 });
}
