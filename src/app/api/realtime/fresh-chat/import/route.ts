import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { canAccessRealTime } from "@/lib/permissions";
import { importRealtimeFreshChatSnapshot } from "@/lib/realtime-fresh-chat-service";
import { validateRealtimeImportToken } from "@/lib/realtime-service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  if (authorization) {
    const tokenValidation = validateRealtimeImportToken(authorization);
    if ("error" in tokenValidation) {
      return NextResponse.json({ success: false, error: tokenValidation.error, message: tokenValidation.error }, { status: tokenValidation.status });
    }
  } else {
    const actor = await getApiActor();
    if (!canAccessRealTime({ role: actor.role, email: actor.email, name: actor.name, roleTitle: actor.roleTitle, jobTitle: actor.jobTitle, skill: actor.skill, status: "ACTIVE" })) {
      return NextResponse.json({ success: false, error: "Você não tem permissão para importar Fresh Chat.", message: "Você não tem permissão para importar Fresh Chat." }, { status: 403 });
    }
  }

  try {
    const body = await request.json();
    const result = await importRealtimeFreshChatSnapshot({
      cycleDownload: String(body?.cycleDownload ?? ""),
      fileName: typeof body?.fileName === "string" ? body.fileName : "fresh_chat_backlog.json",
      source: typeof body?.source === "string" ? body.source : "fresh-chat",
      generatedDate: typeof body?.generatedDate === "string" ? body.generatedDate : null,
      rows: Array.isArray(body?.rows) ? body.rows : [],
      tickets: Array.isArray(body?.tickets) ? body.tickets : [],
      rawText: typeof body?.rawText === "string" ? body.rawText : ""
    });
    if ("error" in result) {
      return NextResponse.json({ success: false, error: result.error, message: result.error }, { status: result.status ?? 400 });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error("[realtime/fresh-chat/import] erro inesperado", error);
    return NextResponse.json({ success: false, error: "Não foi possível importar o snapshot Fresh Chat.", message: "Não foi possível importar o snapshot Fresh Chat." }, { status: 500 });
  }
}
