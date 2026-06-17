import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { createFinanceiroAdjustment, getFinanceiroDashboard, saveFinanceiroRecord } from "@/lib/financeiro-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await getApiActor();
  const url = new URL(request.url);
  const result = await getFinanceiroDashboard(actor, {
    invoiceCycleMonth: url.searchParams.get("invoiceCycleMonth"),
    costCenter: url.searchParams.get("costCenter"),
    source: url.searchParams.get("source"),
    search: url.searchParams.get("search")
  });
  if ("error" in result) return NextResponse.json({ error: result.error, message: result.error }, { status: result.status ?? 400 });
  return NextResponse.json(result);
}

export async function POST(request: Request) {
  const actor = await getApiActor();
  const body = await request.json().catch(() => ({}));
  const action = String(body.action ?? "");
  const result =
    action === "create-adjustment"
      ? await createFinanceiroAdjustment(actor, body)
      : action === "save-record"
        ? await saveFinanceiroRecord(actor, body)
      : { error: "Ação de Financeiro inválida.", status: 400 };
  if ("error" in result) return NextResponse.json({ error: result.error, message: result.error }, { status: result.status ?? 400 });
  return NextResponse.json(result);
}
