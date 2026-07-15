import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { canAccessRealtimeHoursCapture } from "@/lib/realtime-hours-permissions";
import { authorizeRealtimeHoursRead, getRealtimeHoursOperationalPresence } from "@/lib/realtime-hours-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await authorizeOperationalPresenceRead(request);
  if ("error" in access) {
    return NextResponse.json({ success: false, error: access.error, message: access.error }, { status: access.status });
  }

  return NextResponse.json(await getRealtimeHoursOperationalPresence());
}

async function authorizeOperationalPresenceRead(request: Request) {
  if (request.headers.get("authorization")) return authorizeRealtimeHoursRead(request);

  const actor = await getApiActor();
  if (!canAccessRealtimeHoursCapture({
    role: actor.role,
    email: actor.email,
    name: actor.name,
    roleTitle: actor.roleTitle,
    jobTitle: actor.jobTitle,
    skill: actor.skill,
    status: "ACTIVE"
  })) {
    return { error: "Você não tem permissão para acessar a presença operacional.", status: 403 };
  }
  return { ok: true };
}
