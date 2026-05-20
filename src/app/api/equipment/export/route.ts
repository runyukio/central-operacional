import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { exportEquipmentCsv } from "@/lib/equipment-service";

export async function GET(request: Request) {
  const actor = await getApiActor();
  const url = new URL(request.url);
  const csv = await exportEquipmentCsv(actor, {
    status: url.searchParams.get("status") ?? undefined,
    type: url.searchParams.get("type") ?? undefined,
    search: url.searchParams.get("search") ?? undefined,
    serialNumber: url.searchParams.get("serialNumber") ?? undefined,
    responsible: url.searchParams.get("responsible") ?? undefined,
    responsibleId: url.searchParams.get("responsibleId") ?? undefined,
    wbLogin: url.searchParams.get("wbLogin") ?? undefined,
    model: url.searchParams.get("model") ?? undefined,
    deliveredFrom: url.searchParams.get("deliveredFrom") ?? url.searchParams.get("deliveryDateFrom") ?? undefined,
    deliveredTo: url.searchParams.get("deliveredTo") ?? url.searchParams.get("deliveryDateTo") ?? undefined
  });
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="equipamentos.csv"'
    }
  });
}
