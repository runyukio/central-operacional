import { NextResponse } from "next/server";

import { validateRealtimeHoursAgentToken } from "@/lib/realtime-hours-agent-auth";
import { importWorkstationActivity } from "@/lib/workstation-activity-service";

export const dynamic = "force-dynamic";

const configuredMaxBodyBytes = Number.parseInt(process.env.REALTIME_HOURS_MAX_ACTIVITY_BODY_BYTES ?? "524288", 10);
const maxBodyBytes = Number.isFinite(configuredMaxBodyBytes)
  ? Math.min(1_048_576, Math.max(65_536, configuredMaxBodyBytes))
  : 524_288;

export async function GET(request: Request) {
  const tokenValidation = validateRealtimeHoursAgentToken(request.headers.get("authorization"));
  if ("error" in tokenValidation) {
    return NextResponse.json(
      { success: false, error: tokenValidation.error, message: tokenValidation.error },
      { status: tokenValidation.status }
    );
  }

  return NextResponse.json({
    success: true,
    service: "realtime-hours-agent-activity",
    maxBodyBytes,
    capture: "domain-and-application-only",
    tokenSource: tokenValidation.tokenSource,
    migrationTokenExpiresAt: tokenValidation.migrationTokenExpiresAt
  });
}

export async function POST(request: Request) {
  const tokenValidation = validateRealtimeHoursAgentToken(request.headers.get("authorization"));
  if ("error" in tokenValidation) {
    return NextResponse.json(
      { success: false, error: tokenValidation.error, message: tokenValidation.error },
      { status: tokenValidation.status }
    );
  }

  try {
    const contentLength = Number.parseInt(request.headers.get("content-length") ?? "", 10);
    if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
      return NextResponse.json(
        { success: false, error: "Payload excede o limite permitido.", message: "Payload excede o limite permitido." },
        { status: 413 }
      );
    }

    const bodyResult = await readBodyWithLimit(request, maxBodyBytes);
    if ("tooLarge" in bodyResult) {
      return NextResponse.json(
        { success: false, error: "Payload excede o limite permitido.", message: "Payload excede o limite permitido." },
        { status: 413 }
      );
    }

    let body: unknown;
    try {
      body = JSON.parse(bodyResult.text);
    } catch {
      return NextResponse.json({ success: false, error: "JSON inválido.", message: "JSON inválido." }, { status: 400 });
    }

    const result = await importWorkstationActivity(body);
    return NextResponse.json(result, {
      status: "status" in result && typeof result.status === "number" ? result.status : 200
    });
  } catch (error) {
    console.error("[realtime-hours/agent-activity] erro inesperado", error);
    return NextResponse.json({
      success: false,
      error: "Não foi possível importar atividade da estação.",
      message: "Não foi possível importar atividade da estação."
    }, { status: 500 });
  }
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
