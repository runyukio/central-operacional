import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { listAudit } from "@/lib/mock-db";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const report = url.searchParams.get("report") ?? "relatorio";
  const actor = await getApiActor();
  const rows = [
    ["data_hora", "usuario", "acao", "entidade", "id", "motivo"],
    ...listAudit(actor).map((row) => [row.dateTime, row.user, row.action, row.entity, row.entityId, row.reason])
  ];
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${report.toLowerCase().replaceAll(" ", "_")}.csv"`
    }
  });
}
