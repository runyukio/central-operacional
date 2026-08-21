import { NextResponse } from "next/server";

import { importRealtimeHoursSnapshot, validateRealtimeHoursAgentToken } from "@/lib/realtime-hours-service";

export const dynamic = "force-dynamic";

const configuredMaxBodyBytes = Number.parseInt(process.env.REALTIME_HOURS_MAX_AGENT_BODY_BYTES ?? "131072", 10);
const maxBodyBytes = Number.isFinite(configuredMaxBodyBytes)
  ? Math.min(1_048_576, Math.max(16_384, configuredMaxBodyBytes))
  : 131_072;

export async function GET(request: Request) {
  const tokenValidation = validateRealtimeHoursAgentToken(request.headers.get("authorization"));
  if ("error" in tokenValidation) {
    return NextResponse.json({ success: false, error: tokenValidation.error, message: tokenValidation.error }, { status: tokenValidation.status });
  }

  return NextResponse.json({
    success: true,
    service: "realtime-hours-agent",
    maxBodyBytes
  });
}

export async function POST(request: Request) {
  const tokenValidation = validateRealtimeHoursAgentToken(request.headers.get("authorization"));
  if ("error" in tokenValidation) {
    return NextResponse.json({ success: false, error: tokenValidation.error, message: tokenValidation.error }, { status: tokenValidation.status });
  }

  try {
    const contentLength = Number.parseInt(request.headers.get("content-length") ?? "", 10);
    if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
      return discardedAgentSnapshot("Payload do agente excede o limite permitido.");
    }

    const bodyResult = await readBodyWithLimit(request, maxBodyBytes);
    if ("tooLarge" in bodyResult) {
      return discardedAgentSnapshot("Payload do agente excede o limite permitido.");
    }

    let body: unknown = null;
    try {
      body = JSON.parse(bodyResult.text);
    } catch {
      body = null;
    }
    if (!body || typeof body !== "object") {
      return discardedAgentSnapshot("JSON inválido no corpo da requisição.");
    }

    const payload = normalizeAgentSnapshot(body as Record<string, unknown>);
    const capturedAt = new Date(payload.capturedAt);
    if (Number.isNaN(capturedAt.getTime()) || capturedAt.getTime() > Date.now() + 5 * 60_000) {
      return discardedAgentSnapshot("Horário de captura inválido ou adiantado mais de 5 minutos.");
    }
    const result = await importRealtimeHoursSnapshot(payload);
    if ("error" in result) {
      const status = typeof result.status === "number" ? result.status : 400;
      if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
        return discardedAgentSnapshot(result.message || result.error || "Snapshot inválido.");
      }
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

function discardedAgentSnapshot(reason: string) {
  console.warn("[realtime-hours/agent-snapshot] snapshot descartado", { reason });
  // Acknowledge permanent payload failures so older installed agents remove
  // the file instead of replaying the same invalid request every minute.
  return NextResponse.json({
    success: true,
    accepted: false,
    discarded: true,
    message: reason
  });
}

function normalizeAgentSnapshot(body: Record<string, unknown>) {
  const records = Array.isArray(body.records)
    ? body.records
    : body.record
      ? [body.record]
      : [body];

  return {
    source: "direct-windows-agent",
    capturedAt: typeof body.capturedAt === "string" && body.capturedAt.trim() ? body.capturedAt : "",
    records
  };
}

async function readBodyWithLimit(request: Request, limit: number): Promise<{ text: string } | { tooLarge: true }> {
  if (!request.body) return { text: "" };

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return { tooLarge: true };
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return { text };
}
