import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { exportFinanceiroTemplate } from "@/lib/financeiro-service";
import { buildXlsxResponse } from "@/lib/xlsx-export";

export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await getApiActor();
  const result = await exportFinanceiroTemplate(actor);
  if ("error" in result) return NextResponse.json({ error: result.error, message: result.error }, { status: result.status ?? 400 });
  return buildXlsxResponse(result);
}
