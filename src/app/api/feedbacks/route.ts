import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import { createFormalFeedback, FormalFeedbackError, listFormalFeedbacks } from "@/lib/formal-feedback-service";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  employeeId: z.string().min(1),
  type: z.string().min(1),
  category: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1)
});

export async function GET(request: Request) {
  const actor = await getApiActor();
  const url = new URL(request.url);
  try {
    return NextResponse.json(await listFormalFeedbacks(actor, {
      startDate: url.searchParams.get("startDate") ?? undefined,
      endDate: url.searchParams.get("endDate") ?? undefined,
      employeeId: url.searchParams.get("employeeId") ?? undefined,
      authorId: url.searchParams.get("authorId") ?? undefined,
      type: url.searchParams.get("type") ?? undefined,
      category: url.searchParams.get("category") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      lob: url.searchParams.get("lob") ?? undefined,
      jobTitle: url.searchParams.get("jobTitle") ?? undefined,
      skill: url.searchParams.get("skill") ?? undefined,
      supervisor: url.searchParams.get("supervisor") ?? undefined,
      search: url.searchParams.get("search") ?? undefined,
      page: Number(url.searchParams.get("page") ?? 1),
      limit: Number(url.searchParams.get("limit") ?? 25)
    }));
  } catch (error) {
    return formalFeedbackErrorResponse(error, "Não foi possível carregar Feedback Formal.");
  }
}

export async function POST(request: Request) {
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos", issues: parsed.error.flatten() }, { status: 400 });
  }
  const actor = await getApiActor();
  try {
    return NextResponse.json(await createFormalFeedback(actor, parsed.data), { status: 201 });
  } catch (error) {
    return formalFeedbackErrorResponse(error, "Não foi possível criar Feedback Formal.");
  }
}

function formalFeedbackErrorResponse(error: unknown, fallback: string) {
  if (error instanceof FormalFeedbackError) {
    return NextResponse.json({ error: error.message, message: error.message }, { status: error.status });
  }
  console.error("[feedbacks] erro inesperado", error);
  return NextResponse.json({ error: fallback, message: fallback }, { status: 500 });
}
