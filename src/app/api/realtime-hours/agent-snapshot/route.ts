import { NextResponse } from "next/server";

import { importRealtimeHoursSnapshot, validateRealtimeHoursAgentToken } from "@/lib/realtime-hours-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const tokenValidation = validateRealtimeHoursAgentToken(request.headers.get("authorization"));
  if ("error" in tokenValidation) {
    return NextResponse.json({ success: false, error: tokenValidation.error, message: tokenValidation.error }, { status: tokenValidation.status });
  }

  return NextResponse.json({
    success: true,
    service: "realtime-hours-agent"
  });
}

export async function POST(request: Request) {
  const tokenValidation = validateRealtimeHoursAgentToken(request.headers.get("authorization"));
  if ("error" in tokenValidation) {
    return NextResponse.json({ success: false, error: tokenValidation.error, message: tokenValidation.error }, { status: tokenValidation.status });
  }

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({
        success: false,
        error: "JSON inválido no corpo da requisição.",
        message: "JSON inválido no corpo da requisição."
      }, { status: 400 });
    }

    const payload = normalizeAgentSnapshot(body as Record<string, unknown>);
    const result = await importRealtimeHoursSnapshot(payload);
    if ("error" in result) {
      const status = typeof result.status === "number" ? result.status : 400;
      return NextResponse.json(result, { status });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error("[realtime-hours/agent-snapshot] erro inesperado", error);
    return NextResponse.json({
      success: false,
      error: "Não foi possível importar o snapshot direto do agente.",
      message: "Não foi possível importar o snapshot direto do agente."
    }, { status: 500 });
  }
}

function normalizeAgentSnapshot(body: Record<string, unknown>) {
  const records = Array.isArray(body.records)
    ? body.records
    : body.record
      ? [body.record]
      : [body];

  return {
    source: typeof body.source === "string" && body.source.trim() ? body.source : "direct-windows-agent",
    capturedAt: typeof body.capturedAt === "string" && body.capturedAt.trim() ? body.capturedAt : new Date().toISOString(),
    records
  };
}
