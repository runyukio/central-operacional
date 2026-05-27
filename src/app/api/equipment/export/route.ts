import { getApiActor } from "@/lib/api-actor";
import { exportEquipmentXlsxData } from "@/lib/equipment-service";
import { buildXlsxResponse } from "@/lib/xlsx-export";

export async function GET(request: Request) {
  const actor = await getApiActor();
  const url = new URL(request.url);
  const payload = await exportEquipmentXlsxData(actor, {
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
  return buildXlsxResponse(payload);
}
