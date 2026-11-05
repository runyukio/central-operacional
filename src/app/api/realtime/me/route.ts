import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { getMyRealtime } from "@/lib/my-realtime-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await getApiActor();
  const headers = { "Cache-Control": "private, no-store" };
  if (new URL(request.url).searchParams.size) {
    return NextResponse.json({ success: false, message: "Esta consulta usa apenas o agente autenticado e seu turno atual. Não aceita filtros." }, { status: 400, headers });
  }
  try {
    const payload = await getMyRealtime(actor);
    if ("error" in payload) return NextResponse.json({ success: false, message: payload.error }, { status: payload.status, headers });
    return NextResponse.json(payload, { headers });
  } catch (error) {
    console.error("[my-realtime] Falha na consulta pessoal", error);
    return NextResponse.json({ success: false, message: "Não foi possível consultar seu Real Time. Tente novamente." }, { status: 503, headers });
  }
}
