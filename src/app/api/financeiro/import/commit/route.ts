import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { commitFinanceiroImport } from "@/lib/financeiro-service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const actor = await getApiActor();
  const body = await request.json().catch(() => ({}));
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const result = await commitFinanceiroImport(actor, rows, String(body.fileName ?? "financeiro.xlsx"));
  if ("error" in result) return NextResponse.json({ error: result.error, message: result.error }, { status: result.status ?? 400 });
  return NextResponse.json(result);
}
