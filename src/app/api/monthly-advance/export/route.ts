import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { exportMonthlyAdvances } from "@/lib/monthly-advance-service";

export async function GET(request: Request) {
  const actor = await getApiActor();
  const url = new URL(request.url);
  const result = await exportMonthlyAdvances(actor, {
    referenceMonth: url.searchParams.get("referenceMonth") ?? undefined,
    lob: url.searchParams.get("lob") ?? undefined,
    supervisorId: url.searchParams.get("supervisorId") ?? undefined,
    optIn: url.searchParams.get("optIn") ?? undefined,
    hasDiscount: url.searchParams.get("hasDiscount") ?? undefined,
    search: url.searchParams.get("search") ?? undefined
  });
  if ("error" in result) return NextResponse.json({ error: result.error, message: result.error }, { status: result.status ?? 400 });
  const exported = result as { data: string; fileName: string };
  return new NextResponse(exported.data, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exported.fileName}"`
    }
  });
}
