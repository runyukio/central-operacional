import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { FormalFeedbackError, getFormalFeedbackDetail } from "@/lib/formal-feedback-service";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const actor = await getApiActor();
  try {
    return NextResponse.json(await getFormalFeedbackDetail(actor, params.id));
  } catch (error) {
    if (error instanceof FormalFeedbackError) {
      return NextResponse.json({ error: error.message, message: error.message }, { status: error.status });
    }
    console.error("[feedbacks/detail] erro inesperado", error);
    return NextResponse.json({ error: "Não foi possível carregar o feedback.", message: "Não foi possível carregar o feedback." }, { status: 500 });
  }
}
