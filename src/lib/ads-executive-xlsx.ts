import type { AdsExecutiveReportSnapshot } from "@/lib/ads-executive-report-core";
import {
  excelDateSerial,
  xlsxDurationFormat,
  type XlsxExportPayload
} from "@/lib/xlsx-export";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export function buildAdsExecutiveHealthMapXlsx(report: AdsExecutiveReportSnapshot): XlsxExportPayload {
  const date = excelDateSerial(report.dateKey);

  return {
    fileName: `ads_hourly_health_map_${report.dateKey}_${safeCycleToken(report.selectedCycle)}.xlsx`,
    sheetName: "Hourly health map",
    headers: [
      "Date",
      "Hour",
      "Snapshot",
      "Input",
      "Forecast",
      "Output",
      "Input x Output",
      "AHT",
      "Required HC",
      "Online HC",
      "HC Gap",
      "Backlog",
      "Max Latency"
    ],
    rows: report.buckets.map((bucket) => [
      date,
      bucket.hour / 24,
      bucket.cycleDownload,
      bucket.input,
      bucket.forecast,
      bucket.output,
      subtract(bucket.output, bucket.input),
      durationInDays(bucket.ahtMs),
      bucket.required,
      bucket.online,
      subtract(bucket.online, bucket.required),
      bucket.backlog,
      durationInDays(bucket.maxLatencyMs)
    ]),
    columnFormats: {
      0: "yyyy-mm-dd",
      1: "hh:mm",
      7: xlsxDurationFormat,
      12: xlsxDurationFormat
    },
    autoFilter: true
  };
}

function subtract(left: number | null, right: number | null) {
  return left === null || right === null ? null : left - right;
}

function durationInDays(milliseconds: number | null) {
  return milliseconds === null ? null : milliseconds / MILLISECONDS_PER_DAY;
}

function safeCycleToken(value: string) {
  return value.replace(/[^0-9A-Za-z]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "cycle";
}
