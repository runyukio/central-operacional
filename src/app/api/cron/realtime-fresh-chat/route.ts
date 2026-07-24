import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

import { refreshRealtimeFreshChatFromFreshreports } from "@/lib/realtime-fresh-chat-cloud";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isAuthorized(authorization: string | null) {
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  const provided = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  if (!secret || !provided) return false;
  const expectedBuffer = Buffer.from(secret);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET?.trim()) {
    return NextResponse.json({ success: false, error: "CRON_SECRET não configurado." }, { status: 500 });
  }
  if (!isAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ success: false, error: "Token da rotina Freshchat inválido." }, { status: 401 });
  }

  try {
    return NextResponse.json(await refreshRealtimeFreshChatFromFreshreports());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível atualizar o backlog Freshchat pelo Freshreports.";
    console.error("[cron/realtime-fresh-chat] erro inesperado", error);
    return NextResponse.json({ success: false, error: message, message }, { status: 502 });
  }
}
