import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { canAccessRealTime } from "@/lib/permissions";
import { getRealtimeFreshChatSnapshot } from "@/lib/realtime-fresh-chat-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await getApiActor();
  if (!canAccessRealTime({ role: actor.role, email: actor.email, name: actor.name, roleTitle: actor.roleTitle, jobTitle: actor.jobTitle, skill: actor.skill, status: "ACTIVE" })) {
    return NextResponse.json({ success: false, error: "Você não tem permissão para acessar Fresh Chat.", message: "Você não tem permissão para acessar Fresh Chat." }, { status: 403 });
  }

  const url = new URL(request.url);
  const cycleDownload = url.searchParams.get("cycleDownload") ?? "";
  const snapshot = await getRealtimeFreshChatSnapshot(cycleDownload);
  return NextResponse.json({ success: true, data: snapshot });
}
