import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { exportFinanceiro } from "@/lib/financeiro-service";
import { buildXlsxResponse } from "@/lib/xlsx-export";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await getApiActor();
  const url = new URL(request.url);
  const result = await exportFinanceiro(actor, {
    invoiceCycleMonth: url.searchParams.get("invoiceCycleMonth"),
    costCenter: url.searchParams.get("costCenter"),
    source: url.searchParams.get("source"),
    search: url.searchParams.get("search")
  });
  if ("error" in result) return NextResponse.json({ error: result.error, message: result.error }, { status: result.status ?? 400 });
  return buildXlsxResponse(result);
}
