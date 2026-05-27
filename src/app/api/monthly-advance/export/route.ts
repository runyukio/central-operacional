import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { exportMonthlyAdvances } from "@/lib/monthly-advance-service";
import { buildXlsxResponse } from "@/lib/xlsx-export";

export async function GET(request: Request) {
  const actor = await getApiActor();
  const url = new URL(request.url);
  const result = await exportMonthlyAdvances(actor, {
    referenceMonth: url.searchParams.get("referenceMonth") ?? undefined,
    lob: url.searchParams.get("lob") ?? undefined,
    supervisorId: url.searchParams.get("supervisorId") ?? undefined,
    optIn: url.searchParams.get("optIn") ?? undefined,
    search: url.searchParams.get("search") ?? undefined
  });
  if ("error" in result) return NextResponse.json({ error: result.error, message: result.error }, { status: result.status ?? 400 });
  if (!("headers" in result)) return NextResponse.json({ error: "Não foi possível exportar adiantamento.", message: "Não foi possível exportar adiantamento." }, { status: 400 });
  return buildXlsxResponse(result);
}
