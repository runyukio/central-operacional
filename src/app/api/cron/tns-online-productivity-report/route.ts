import crypto from "node:crypto";

import { sendLatestTnsOnlineProductivityReport } from "@/lib/ads-executive-webhook-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  return handleRequest(request);
}

export async function POST(request: Request) {
  return handleRequest(request);
}

async function handleRequest(request: Request) {
  const secret = String(process.env.CRON_SECRET ?? "").trim();
  if (!secret) {
    return Response.json({ success: false, error: "CRON_SECRET is not configured." }, { status: 500 });
  }
  const authorization = request.headers.get("authorization") ?? "";
  if (!safeEqual(authorization, `Bearer ${secret}`)) {
    return Response.json({ success: false, error: "Unauthorized." }, { status: 401 });
  }

  try {
    const result = await sendLatestTnsOnlineProductivityReport();
    return Response.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to send the TNS online productivity report.";
    console.error("[tns-online-productivity-report]", sanitizeLogMessage(message));
    return Response.json({ success: false, error: message }, { status: 502 });
  }
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function sanitizeLogMessage(value: string) {
  return value
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/([?&](?:key|token|secret)=)[^&\s]+/gi, "$1[redacted]")
    .slice(0, 500);
}
