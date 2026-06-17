import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { getFinanceiroUploads } from "@/lib/financeiro-service";

export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await getApiActor();
  const result = await getFinanceiroUploads(actor);
  if ("error" in result) return NextResponse.json({ error: result.error, message: result.error }, { status: result.status ?? 400 });
  return NextResponse.json(result);
}
