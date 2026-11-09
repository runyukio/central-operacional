import { timingSafeEqual } from "node:crypto";
import { maintainWorkstationActivity } from "@/lib/workstation-activity-maintenance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return Response.json({ success: false, error: "CRON_SECRET não configurado." }, { status: 503 });
  const provided = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return Response.json({ success: false, error: "Não autorizado." }, { status: 401 });
  }
  try {
    const result = await maintainWorkstationActivity();
    console.info("[activity/maintenance]", { deleted: result.deleted, batches: result.batches });
    return Response.json(result);
  } catch (error) {
    console.error("[activity/maintenance]", error instanceof Error ? error.name : "MaintenanceError");
    return Response.json({ success: false, error: "Manutenção de atividade não concluída; os envios continuam independentes." }, { status: 500 });
  }
}
