import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import { addOperationalRequestComment } from "@/lib/request-service";

const commentSchema = z.object({
  id: z.string().min(1),
  body: z.string().min(1)
});

export async function POST(request: Request) {
  const parsed = commentSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos", issues: parsed.error.flatten() }, { status: 400 });
  }

  const actor = await getApiActor();
  const result = await addOperationalRequestComment(actor, parsed.data.id, parsed.data.body);

  if (!result) return NextResponse.json({ error: "Solicitação não encontrada" }, { status: 404 });
  if (result === "FORBIDDEN") return NextResponse.json({ error: "Sem permissão para comentar nesta solicitação" }, { status: 403 });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json({ data: result.data, persisted: result.persisted }, { status: 201 });
}
