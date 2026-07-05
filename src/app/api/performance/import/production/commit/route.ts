import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import {
  commitProductionAutomatedRawImport,
  commitProductionImport,
  commitProductionRawImport,
  PerformanceError,
  validatePerformanceImportToken
} from "@/lib/performance-service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const fileName = typeof body.fileName === "string" ? body.fileName : undefined;
    const authorization = request.headers.get("authorization");
    if (authorization) {
      const tokenValidation = validatePerformanceImportToken(authorization);
      if ("error" in tokenValidation) {
        return NextResponse.json({ success: false, error: tokenValidation.error, message: tokenValidation.error }, { status: tokenValidation.status });
      }
      if (Array.isArray(body.rawRows)) {
        const batchId = typeof body.batchId === "string" && body.batchId ? body.batchId : undefined;
        const rowOffset = Number.isFinite(Number(body.rowOffset)) ? Number(body.rowOffset) : 0;
        return NextResponse.json(await commitProductionAutomatedRawImport(body.rawRows, fileName, batchId, rowOffset));
      }
      return NextResponse.json({
        success: false,
        error: "Envie rawRows para importação automatizada de Performance.",
        message: "Envie rawRows para importação automatizada de Performance."
      }, { status: 400 });
    }

    const actor = await getApiActor();
    if (Array.isArray(body.rawRows)) {
      const batchId = typeof body.batchId === "string" && body.batchId ? body.batchId : undefined;
      const rowOffset = Number.isFinite(Number(body.rowOffset)) ? Number(body.rowOffset) : 0;
      return NextResponse.json(await commitProductionRawImport(actor, body.rawRows, fileName, batchId, rowOffset));
    }
    const rows = Array.isArray(body.rows) ? body.rows : [];
    return NextResponse.json(await commitProductionImport(actor, rows, fileName));
  } catch (error) {
    if (error instanceof PerformanceError) {
      return NextResponse.json({ success: false, error: error.message, message: error.message }, { status: error.status });
    }
    console.error("[performance/production/commit] erro inesperado", error);
    return NextResponse.json({ success: false, error: "Não foi possível importar a base de Produção.", message: "Não foi possível importar a base de Produção." }, { status: 500 });
  }
}
