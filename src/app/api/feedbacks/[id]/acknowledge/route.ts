import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import { acknowledgeFormalFeedback, FormalFeedbackError } from "@/lib/formal-feedback-service";

export const dynamic = "force-dynamic";

const schema = z.object({
  response: z.string().optional()
});

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos", issues: parsed.error.flatten() }, { status: 400 });
  }
  const actor = await getApiActor();
  try {
    return NextResponse.json(await acknowledgeFormalFeedback(actor, params.id, parsed.data));
  } catch (error) {
    if (error instanceof FormalFeedbackError) {
      return NextResponse.json({ error: error.message, message: error.message }, { status: error.status });
    }
    console.error("[feedbacks/acknowledge] erro inesperado", error);
    return NextResponse.json({ error: "Não foi possível confirmar ciência.", message: "Não foi possível confirmar ciência." }, { status: 500 });
  }
}
