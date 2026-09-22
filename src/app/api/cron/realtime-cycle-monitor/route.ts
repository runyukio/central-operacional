import { timingSafeEqual } from "node:crypto";
import { runCycleMonitor } from "@/lib/realtime-cycle-monitor-service";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
async function handle(request: Request, test = false) {
  const dryRun = !test && new URL(request.url).searchParams.get("dryRun") === "true";
  const secret = ((test || dryRun) ? process.env.REALTIME_CYCLE_MONITOR_TEST_SECRET || process.env.CRON_SECRET : process.env.CRON_SECRET)?.trim();
  if (!secret) return Response.json({ error: "Not configured" }, { status: 503 });
  const a = Buffer.from(request.headers.get("authorization") ?? ""), b = Buffer.from(`Bearer ${secret}`);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const testId = test ? request.headers.get("idempotency-key") ?? "" : undefined;
    if (test && !/^[a-zA-Z0-9_-]{8,80}$/.test(testId!)) return Response.json({ error: "A valid test idempotency key is required" }, { status: 400 });
    const result = await runCycleMonitor({ testId, dryRun });
    return Response.json(result, { status: result.status === "uncertain" ? 502 : 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    console.error("[realtime-cycle-monitor] Check failed. No automatic resend of uncertain deliveries.");
    return Response.json({ error: "Monitor failed; check private receipts before retrying" }, { status: 502 });
  }
}
export async function GET(request: Request) { return handle(request); }
export async function POST(request: Request) { return handle(request, true); }
