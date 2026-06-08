import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { exportBilling } from "@/lib/billing-service";
import { buildXlsxResponse } from "@/lib/xlsx-export";

export async function GET(request: Request) {
  const actor = await getApiActor();
  const url = new URL(request.url);
  const result = await exportBilling(actor, {
    referenceMonth: url.searchParams.get("referenceMonth"),
    startDate: url.searchParams.get("startDate"),
    endDate: url.searchParams.get("endDate"),
    lob: url.searchParams.get("lob"),
    supervisorId: url.searchParams.get("supervisorId"),
    skill: url.searchParams.get("skill"),
    shiftId: url.searchParams.get("shiftId"),
    employeeStatus: url.searchParams.get("employeeStatus"),
    invoiceStatus: url.searchParams.get("invoiceStatus"),
    cycleStatus: url.searchParams.get("cycleStatus"),
    search: url.searchParams.get("search")
  });
  if ("error" in result) return NextResponse.json({ error: result.error, message: result.error }, { status: result.status ?? 400 });
  return buildXlsxResponse(result);
}
