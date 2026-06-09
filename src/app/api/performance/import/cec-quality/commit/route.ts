import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { commitCecQualityImport, commitCecQualityRawImport, PerformanceError } from "@/lib/performance-service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const actor = await getApiActor();
    const fileName = typeof body.fileName === "string" ? body.fileName : undefined;
    const yearReference = Number.isFinite(Number(body.yearReference)) ? Number(body.yearReference) : undefined;
    if (Array.isArray(body.rawRows)) {
      const batchId = typeof body.batchId === "string" && body.batchId ? body.batchId : undefined;
      const rowOffset = Number.isFinite(Number(body.rowOffset)) ? Number(body.rowOffset) : 0;
      return NextResponse.json(await commitCecQualityRawImport(actor, body.rawRows, fileName, batchId, rowOffset, yearReference));
    }
    const rows = Array.isArray(body.rows) ? body.rows : [];
    return NextResponse.json(await commitCecQualityImport(actor, rows, fileName));
  } catch (error) {
    if (error instanceof PerformanceError) {
      return NextResponse.json({ success: false, error: error.message, message: error.message }, { status: error.status });
    }
    console.error("[performance/cec-quality/commit] erro inesperado", error);
    return NextResponse.json({ success: false, error: "Não foi possível importar a base de Qualidade CEC.", message: "Não foi possível importar a base de Qualidade CEC." }, { status: 500 });
  }
}
