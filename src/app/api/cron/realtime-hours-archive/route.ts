import { timingSafeEqual } from "node:crypto";
import { maintainRealtimeHoursArchives } from "@/lib/realtime-hours-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return Response.json({ success: false, error: "CRON_SECRET não configurado." }, { status: 500 });
  const expected = Buffer.from(`Bearer ${secret}`);
  const provided = Buffer.from(request.headers.get("authorization") ?? "");
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return Response.json({ success: false, error: "Não autorizado." }, { status: 401 });
  }
  try {
    return Response.json(await maintainRealtimeHoursArchives());
  } catch (error) {
    console.error("[realtime-hours/archive]", error instanceof Error ? error.name : "ArchiveError");
    return Response.json({ success: false, error: "Não foi possível atualizar os consolidados; o histórico bruto foi preservado." }, { status: 500 });
  }
}
