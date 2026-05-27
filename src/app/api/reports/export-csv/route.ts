import { getApiActor } from "@/lib/api-actor";
import { listAudit } from "@/lib/mock-db";
import { buildXlsxResponse } from "@/lib/xlsx-export";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const report = url.searchParams.get("report") ?? "relatorio";
  const actor = await getApiActor();
  const rows = [
    ...listAudit(actor).map((row) => [row.dateTime, row.user, row.action, row.entity, row.entityId, row.reason])
  ];
  return buildXlsxResponse({
    headers: ["data_hora", "usuario", "acao", "entidade", "id", "motivo"],
    rows,
    sheetName: "Relatorio",
    fileName: `${report.toLowerCase().replaceAll(" ", "_")}_${new Date().toISOString().slice(0, 10)}.xlsx`
  });
}
