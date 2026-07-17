import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import {
  createAnonymousFeedback,
  EngagementError,
  listAnonymousFeedback,
  updateAnonymousFeedback
} from "@/lib/engagement-service";

const schema = z.object({
  category: z.string().min(1),
  urgency: z.string().min(1),
  comment: z.string().min(8),
  allowContact: z.boolean().optional(),
  evidenceUrl: z.string().optional()
});

const patchSchema = z.object({
  id: z.string().min(1),
  status: z.string().min(1).optional(),
  response: z.string().min(3).max(4000).optional()
}).refine((data) => data.status !== undefined || data.response !== undefined, {
  message: "Informe o status ou a resposta."
});

export async function GET(request: Request) {
  const actor = await getApiActor();
  const url = new URL(request.url);
  try {
    return NextResponse.json(await listAnonymousFeedback(actor, {
      startDate: url.searchParams.get("startDate") ?? undefined,
      endDate: url.searchParams.get("endDate") ?? undefined,
      category: url.searchParams.get("category") ?? undefined,
      urgency: url.searchParams.get("urgency") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      lobId: url.searchParams.get("lobId") ?? undefined,
      lob: url.searchParams.get("lob") ?? undefined,
      jobTitle: url.searchParams.get("jobTitle") ?? undefined,
      search: url.searchParams.get("search") ?? undefined,
      page: Number(url.searchParams.get("page") ?? 1),
      limit: Number(url.searchParams.get("limit") ?? 25)
    }));
  } catch (error) {
    return engagementErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos", issues: parsed.error.flatten() }, { status: 400 });
  }
  const actor = await getApiActor();
  try {
    return NextResponse.json(await createAnonymousFeedback(actor, parsed.data), { status: 201 });
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
    return NextResponse.json(await updateAnonymousFeedback(actor, parsed.data));
  } catch (error) {
    return engagementErrorResponse(error);
  }
}

function engagementErrorResponse(error: unknown) {
  if (error instanceof EngagementError) {
    return NextResponse.json({ error: error.message, message: error.message }, { status: error.status });
  }
  console.error("[anonymous-feedback] erro inesperado", error);
  return NextResponse.json({ error: "Não foi possível processar Feedback Anônimo." }, { status: 500 });
}
