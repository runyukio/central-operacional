import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import { createQualityFeedback, listQualityFeedback } from "@/lib/mock-db";

const schema = z.object({
  employeeId: z.string().min(1),
  type: z.string().min(1),
  theme: z.string().min(1),
  message: z.string().min(1),
  classification: z.enum(["POSITIVO", "ATENCAO", "CRITICO"])
});

export async function GET() {
  const actor = await getApiActor();
  return NextResponse.json({ data: listQualityFeedback(actor) });
}

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos", issues: parsed.error.flatten() }, { status: 400 });
  }
  const actor = await getApiActor();
  return NextResponse.json({ data: createQualityFeedback(actor, parsed.data) }, { status: 201 });
}
