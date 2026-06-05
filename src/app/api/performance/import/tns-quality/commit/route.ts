import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { commitTnsQualityImport, commitTnsQualityRawImport, PerformanceError } from "@/lib/performance-service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const actor = await getApiActor();
    const fileName = typeof body.fileName === "string" ? body.fileName : undefined;
    if (Array.isArray(body.rawRows)) {
      const batchId = typeof body.batchId === "string" && body.batchId ? body.batchId : undefined;
      const rowOffset = Number.isFinite(Number(body.rowOffset)) ? Number(body.rowOffset) : 0;
      return NextResponse.json(await commitTnsQualityRawImport(actor, body.rawRows, fileName, batchId, rowOffset));
    }
    const rows = Array.isArray(body.rows) ? body.rows : [];
    return NextResponse.json(await commitTnsQualityImport(actor, rows, fileName));
  } catch (error) {
    if (error instanceof PerformanceError) {
      return NextResponse.json({ success: false, error: error.message, message: error.message }, { status: error.status });
    }
    console.error("[performance/tns-quality/commit] erro inesperado", error);
    return NextResponse.json({ success: false, error: "Não foi possível importar a base de Qualidade TNS.", message: "Não foi possível importar a base de Qualidade TNS." }, { status: 500 });
  }
}
