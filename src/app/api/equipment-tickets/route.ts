import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import { createEquipmentTicket, listEquipmentTickets } from "@/lib/mock-db";

const schema = z.object({
  equipmentId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  impact: z.enum(["Baixo", "Médio", "Alto"])
});

export async function GET() {
  return NextResponse.json({ data: listEquipmentTickets() });
}

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos", issues: parsed.error.flatten() }, { status: 400 });
  }

  const actor = await getApiActor();
  return NextResponse.json({ data: createEquipmentTicket(actor, parsed.data) }, { status: 201 });
}
