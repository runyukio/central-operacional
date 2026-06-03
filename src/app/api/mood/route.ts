import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import { getOwnMood, submitOwnMood } from "@/lib/mood-service";

const moodSchema = z.object({
  date: z.string().optional(),
  moodScore: z.number().int().min(1).max(5),
  comment: z.string().optional()
});

export async function GET(request: Request) {
  const actor = await getApiActor();
  const url = new URL(request.url);
  const result = await getOwnMood(actor, url.searchParams.get("date") ?? undefined);
  if ("error" in result) return NextResponse.json({ error: result.error, message: result.error }, { status: 400 });
  return NextResponse.json(result);
}

export async function POST(request: Request) {
  const parsed = moodSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos para registrar humor.", message: "Dados inválidos para registrar humor." }, { status: 400 });
  }
  const actor = await getApiActor();
  const result = await submitOwnMood(actor, parsed.data);
  if ("error" in result) return NextResponse.json({ error: result.error, message: result.error }, { status: 400 });
  return NextResponse.json(result, { status: 201 });
}
