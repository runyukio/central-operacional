import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import { saveAnonymousFeedback } from "@/lib/mock-db";

const schema = z.object({
  category: z.string().min(1),
  message: z.string().min(8),
  evidenceUrl: z.string().optional()
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos", issues: parsed.error.flatten() }, { status: 400 });
  }
  const actor = await getApiActor();
  return NextResponse.json({ data: { ...saveAnonymousFeedback(actor, parsed.data), identityStored: false } }, { status: 201 });
}
