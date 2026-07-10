import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { canAccessRealtimeHoursCapture } from "@/lib/realtime-hours-permissions";
import { authorizeRealtimeHoursRead, getRealtimeHoursTimeline } from "@/lib/realtime-hours-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await authorizeRealtimeHoursAdminRead(request);
  if ("error" in access) {
    return NextResponse.json({ success: false, error: access.error, message: access.error }, { status: access.status });
  }

  const url = new URL(request.url);
  const result = await getRealtimeHoursTimeline({
    date: url.searchParams.get("date"),
    search: url.searchParams.get("search")
  });
  return NextResponse.json(result);
}

async function authorizeRealtimeHoursAdminRead(request: Request) {
  if (request.headers.get("authorization")) return authorizeRealtimeHoursRead(request);

  const actor = await getApiActor();
  if (!canAccessRealtimeHoursCapture({ role: actor.role, email: actor.email, name: actor.name, roleTitle: actor.roleTitle, jobTitle: actor.jobTitle, skill: actor.skill, status: "ACTIVE" })) {
    return { error: "Você não tem permissão para acessar a captura de horas.", status: 403 };
  }
  return { ok: true };
}
