import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import { createChatMessage, listChatMessages } from "@/lib/mock-db";

const schema = z.object({
  roomId: z.string().min(1),
  content: z.string().min(1)
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  return NextResponse.json({ data: listChatMessages(url.searchParams.get("roomId") ?? "equipe-alfa") });
}

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos", issues: parsed.error.flatten() }, { status: 400 });
  }

  const actor = await getApiActor();
  return NextResponse.json({ data: createChatMessage(actor, parsed.data) }, { status: 201 });
}
