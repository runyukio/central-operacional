import crypto from "node:crypto";

import { sendLatestAdsExecutiveReport } from "@/lib/ads-executive-webhook-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  return handleRequest(request);
}

export async function POST(request: Request) {
  return handleRequest(request);
}

async function handleRequest(request: Request) {
  const secret = String(process.env.CRON_SECRET ?? "").trim();
  if (!secret) {
    return Response.json({ success: false, error: "CRON_SECRET não configurado." }, { status: 500 });
  }
  const authorization = request.headers.get("authorization") ?? "";
  if (!safeEqual(authorization, `Bearer ${secret}`)) {
    return Response.json({ success: false, error: "Não autorizado." }, { status: 401 });
  }

  try {
    const result = await sendLatestAdsExecutiveReport();
    return Response.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao enviar o report Executivo ADS.";
    return Response.json({ success: false, error: message }, { status: 502 });
  }
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
