import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { getPerformanceProductionDashboard, PerformanceError, type PerformanceQuery } from "@/lib/performance-service";
import { buildXlsxResponse, dateStamp } from "@/lib/xlsx-export";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await getApiActor();
    const url = new URL(request.url);
    const query: PerformanceQuery = {
      startDate: url.searchParams.get("startDate") ?? undefined,
      endDate: url.searchParams.get("endDate") ?? undefined,
      lob: url.searchParams.get("lob") ?? undefined,
      granularity: readGranularity(url.searchParams.get("granularity"))
    };
    const dashboard = await getPerformanceProductionDashboard(actor, query);
    const period = dashboard.period;
    const filterLob = query.lob || "Todas as LOBs";
    const filterView = granularityLabel(dashboard.granularity);

    return buildXlsxResponse({
      fileName: `performance_filas_${period.startDate}_${period.endDate}_${dateStamp()}.xlsx`,
      sheetName: "Resumo",
      headers: ["Campo", "Valor"],
      rows: [
        ["Inicio", period.startDate],
        ["Fim", period.endDate],
        ["Visao", filterView],
        ["LOB", filterLob],
        ["Input", dashboard.summary.input],
        ["Output", dashboard.summary.submit],
        ["Latency media (min)", dashboard.summary.latencyMinutes],
        ["AHT medio (s)", dashboard.summary.ahtSeconds],
        ["Registros", dashboard.summary.records],
        ["Filas", dashboard.summary.queues ?? 0]
      ],
      sheets: [
        {
          sheetName: "Tendencia",
          headers: ["Periodo", "Input", "Output", "Latency media (min)", "AHT medio (s)", "Registros"],
          rows: dashboard.trend.map((row) => [
            row.label,
            row.input,
            row.submit,
            row.latencyMinutes,
            row.ahtSeconds,
            row.records
          ])
        },
        {
          sheetName: "Filas",
          headers: ["Queue ID", "Fila", "LOB", "Input", "Output", "Latency media (min)", "AHT medio (s)", "Agentes", "Registros"],
          rows: (dashboard.queues ?? []).map((row) => [
            row.queueId,
            row.queueName,
            row.lob || "N/A",
            row.input,
            row.submit,
            row.latencyMinutes,
            row.ahtSeconds,
            row.agents,
            row.records
          ])
        }
      ]
    });
  } catch (error) {
    if (error instanceof PerformanceError) {
      return NextResponse.json({ success: false, error: error.message, message: error.message }, { status: error.status });
    }
    console.error("[performance/queue/export] erro inesperado", error);
    return NextResponse.json({ success: false, error: "Não foi possível exportar dados de fila.", message: "Não foi possível exportar dados de fila." }, { status: 500 });
  }
}

function readGranularity(value: string | null): PerformanceQuery["granularity"] {
  return value === "hourly" || value === "weekly" || value === "monthly" ? value : value === "daily" ? "daily" : undefined;
}

function granularityLabel(value: string) {
  if (value === "monthly") return "Mensal";
  if (value === "weekly") return "Semanal";
  if (value === "hourly") return "Hora";
  return "Diario";
}
