import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import { listInternalNotifications, markInternalNotificationRead } from "@/lib/notification-service";

const markSchema = z.object({
  id: z.string().default("ALL")
});

export async function GET() {
  const actor = await getApiActor();
  const data = await listInternalNotifications(actor);
  return NextResponse.json({ data, unread: data.filter((item) => !item.isRead).length });
}

export async function PATCH(request: Request) {
  const actor = await getApiActor();
  const parsed = markSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  const data = await markInternalNotificationRead(actor, parsed.data.id);
  return NextResponse.json({ data, unread: data.filter((item) => !item.isRead).length });
}
