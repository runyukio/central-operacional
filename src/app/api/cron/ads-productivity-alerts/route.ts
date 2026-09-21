import { timingSafeEqual } from "node:crypto";
import { sendAdsProductivityAlerts } from "@/lib/ads-productivity-alert-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return Response.json({ success: false, error: "Cron is not configured." }, { status: 503 });
  const authorization = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (authorization.length !== expected.length || !timingSafeEqual(authorization, expected)) {
    return Response.json({ success: false, error: "Unauthorized." }, { status: 401 });
  }
  try {
    const dryRun = new URL(request.url).searchParams.get("dryRun") === "true";
    const result = await sendAdsProductivityAlerts({ dryRun });
    if (!dryRun) console.info("[ads-productivity-alerts]", JSON.stringify(result));
    return Response.json({ success: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    console.error("[ads-productivity-alerts] Evaluation or delivery failed; inspect the private delivery receipts.");
    return Response.json({ success: false, error: "Unable to confirm ADS alert processing. Check private delivery receipts before retrying." }, { status: 502 });
  }
}
