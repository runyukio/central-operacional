import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.REALTIME_HOURS_V2_ENVIRONMENT !== "homologation") {
    return NextResponse.json({ success: false }, { status: 503 });
  }
  try {
    const rows = await prisma.$queryRaw<Array<{ count: number }>>`SELECT count(*)::int AS count FROM pg_tables WHERE schemaname='public' AND tablename IN ('WorkstationEnrollmentCodeV2', 'WorkstationDeploymentGrantV2', 'WorkstationDeviceV2', 'WorkstationRequestNonceV2', 'WorkstationCurrentStateV2', 'WorkstationActivitySegmentV2', 'WorkstationDailySummaryV2')`;
    const release = JSON.parse(await readFile(join(process.cwd(), "public/realtime-hours-v2/extension-release.json"), "utf8")) as { extensionId: string };
    if (rows[0]?.count !== 7 || (process.env.REALTIME_HOURS_V2_MASTER_KEY?.length ?? 0) < 32) throw new Error("not ready");
    return NextResponse.json({ success: true, schemaVersion: 2, environment: "homologation", extensionId: release.extensionId, fleetEnrollment: true, persistentFleetEnrollment: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ success: false }, { status: 503 });
  }
}
