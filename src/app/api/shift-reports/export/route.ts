import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { getShiftReportDashboard, listShiftReports } from "@/lib/mock-db";

export async function GET(request: Request) {
  const actor = await getApiActor();
  const url = new URL(request.url);
  const format = url.searchParams.get("format") ?? "csv";
  const reports = listShiftReports(actor);

  if (format === "json") {
    return NextResponse.json({ reports, dashboard: getShiftReportDashboard(actor) });
  }

  const rows = [
    ["id", "data", "turno", "lob", "supervisor", "importancia", "hc_previsto", "hc_real", "abs", "humor", "categoria", "impacto", "follow_up"],
    ...reports.map((report) => [
      report.id,
      report.reportDate,
      report.shift,
      report.lob,
      report.supervisor,
      report.importance,
      report.plannedHeadcount,
      report.actualHeadcount,
      report.absCount,
      report.generalMood,
      report.occurrenceCategory,
      report.impactLevel,
      report.followUpStatus
    ])
  ];
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="reports_turno.csv"'
    }
  });
}
