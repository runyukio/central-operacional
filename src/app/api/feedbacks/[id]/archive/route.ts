import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { archiveFormalFeedback, FormalFeedbackError } from "@/lib/formal-feedback-service";

export const dynamic = "force-dynamic";

export async function PATCH(_request: Request, { params }: { params: { id: string } }) {
  const actor = await getApiActor();
  try {
    return NextResponse.json(await archiveFormalFeedback(actor, params.id));
  } catch (error) {
    if (error instanceof FormalFeedbackError) {
      return NextResponse.json({ error: error.message, message: error.message }, { status: error.status });
    }
    console.error("[feedbacks/archive] erro inesperado", error);
    return NextResponse.json({ error: "Não foi possível arquivar o feedback.", message: "Não foi possível arquivar o feedback." }, { status: 500 });
  }
}
