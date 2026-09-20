import { NextResponse } from "next/server";
import { getApiActor } from "@/lib/api-actor";
import { authorizePerformanceRead, PerformanceError } from "@/lib/performance-service";
import { forecastDateAdd, forecastDates, isForecastDate, operationalForecastToday } from "@/lib/volume-forecast-core";
import { loadVolumeForecastRange, VOLUME_FORECAST_LOBS } from "@/lib/volume-forecast-service";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const access = await authorizePerformanceRead(await getApiActor());
    if (access.ownEmployee) throw new PerformanceError("Acesso restrito à visão operacional de Performance.", 403);
    const params = new URL(request.url).searchParams, today = operationalForecastToday();
    const lob = (params.get("lob") || "ALL").toUpperCase();
    if (![...VOLUME_FORECAST_LOBS, "ALL", "CEC"].includes(lob)) throw new PerformanceError("LOB inválida.", 400);
    const horizon = Number(params.get("horizon") ?? 14);
    if (![7, 14, 31].includes(horizon)) throw new PerformanceError("Horizonte inválido.", 400);
    const startDate = params.get("startDate") ?? forecastDateAdd(today, -7), endDate = params.get("endDate") ?? forecastDateAdd(today, horizon - 1);
    if (!isForecastDate(startDate) || !isForecastDate(endDate) || startDate > endDate || (Date.parse(endDate) - Date.parse(startDate)) / 86400000 > 39 || endDate > forecastDateAdd(today, 33)) throw new PerformanceError("Selecione um período de até 40 dias e no máximo 33 dias futuros.", 400);
    const selected = lob === "ALL" ? [...VOLUME_FORECAST_LOBS] : VOLUME_FORECAST_LOBS.filter((l) => l === lob);
    const series = await Promise.all(selected.map(async (l) => ({ lob: l, ...await loadVolumeForecastRange(l, forecastDates(startDate, endDate), new Date(), params.get("evaluation") === "true") })));
    return NextResponse.json({ lob, today, startDate, endDate, horizon, series, lobs: VOLUME_FORECAST_LOBS, canImport: access.canImport, warnings: lob === "CEC" ? ["CEC não possui uma base de entrada horária de filas para forecast. CPD e FRT não substituem volume de entrada."] : [] }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof PerformanceError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[volume-forecast] read failed", error);
    return NextResponse.json({ error: "Não foi possível carregar o forecast." }, { status: 500 });
  }
}
