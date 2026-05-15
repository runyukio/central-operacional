import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import { markAnnouncementRead } from "@/lib/mock-db";

const schema = z.object({
  announcementId: z.string().min(1)
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  }

  const actor = await getApiActor();
  return NextResponse.json({ data: markAnnouncementRead(actor, parsed.data.announcementId) });
}
