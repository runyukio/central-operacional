import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { commitProductionImport, PerformanceError } from "@/lib/performance-service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const fileName = typeof body.fileName === "string" ? body.fileName : undefined;
    const actor = await getApiActor();
    return NextResponse.json(await commitProductionImport(actor, rows, fileName));
  } catch (error) {
    if (error instanceof PerformanceError) {
      return NextResponse.json({ success: false, error: error.message, message: error.message }, { status: error.status });
    }
    console.error("[performance/production/commit] erro inesperado", error);
    return NextResponse.json({ success: false, error: "Não foi possível importar a base de Produção.", message: "Não foi possível importar a base de Produção." }, { status: 500 });
  }
}
