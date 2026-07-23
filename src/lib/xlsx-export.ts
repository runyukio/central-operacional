import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

export type XlsxCell = string | number | boolean | Date | null | undefined;
export type XlsxColumnFormats = Record<number, string>;

export type XlsxExportPayload = {
  fileName: string;
  sheetName: string;
  headers: string[];
  rows: XlsxCell[][];
  columnFormats?: XlsxColumnFormats;
  autoFilter?: boolean;
  sheets?: Array<{
    sheetName: string;
    headers: string[];
    rows: XlsxCell[][];
    columnFormats?: XlsxColumnFormats;
    autoFilter?: boolean;
  }>;
};

export const xlsxContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const xlsxDurationFormat = "[h]:mm:ss;-[h]:mm:ss;00:00:00";
const millisecondsPerDay = 24 * 60 * 60 * 1_000;
const excelEpochUtc = Date.UTC(1899, 11, 30);

export function dateStamp(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function excelDateSerial(dateKey: string) {
  const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return excelSerialFromParts(Number(match[1]), Number(match[2]), Number(match[3]), 0, 0, 0);
}

export function excelDateTimeSerial(
  value: string | Date | null | undefined,
  timeZone = "America/Sao_Paulo"
) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  ) as Record<string, number>;
  return excelSerialFromParts(parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second);
}

export function buildXlsxBuffer(payload: Pick<XlsxExportPayload, "sheetName" | "headers" | "rows" | "columnFormats" | "autoFilter">) {
  const worksheet = buildWorksheet(payload.headers, payload.rows, payload.columnFormats, payload.autoFilter);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, safeSheetName(payload.sheetName));
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export function buildXlsxResponse(payload: XlsxExportPayload) {
  const fileName = payload.fileName.toLowerCase().endsWith(".xlsx") ? payload.fileName : `${payload.fileName}.xlsx`;
  const buffer = payload.sheets?.length ? buildMultiSheetXlsxBuffer(payload) : buildXlsxBuffer(payload);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": xlsxContentType,
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store"
    }
  });
}

function buildMultiSheetXlsxBuffer(payload: XlsxExportPayload) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, buildWorksheet(payload.headers, payload.rows, payload.columnFormats, payload.autoFilter), safeSheetName(payload.sheetName));
  for (const sheet of payload.sheets ?? []) {
    XLSX.utils.book_append_sheet(workbook, buildWorksheet(sheet.headers, sheet.rows, sheet.columnFormats, sheet.autoFilter), safeSheetName(sheet.sheetName));
  }
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function buildWorksheet(headers: string[], rows: XlsxCell[][], columnFormats: XlsxColumnFormats = {}, autoFilter = false) {
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  for (const [columnIndex, format] of Object.entries(columnFormats)) {
    const column = Number(columnIndex);
    if (!Number.isInteger(column) || column < 0) continue;
    for (let rowIndex = 1; rowIndex <= rows.length; rowIndex += 1) {
      const address = XLSX.utils.encode_cell({ r: rowIndex, c: column });
      const cell = worksheet[address];
      if (cell && (typeof cell.v === "number" || cell.v instanceof Date)) cell.z = format;
    }
  }
  worksheet["!cols"] = headers.map((header, index) => ({
    wch: Math.min(48, Math.max(String(header).length + 2, ...rows.map((row) => String(row[index] ?? "").length + 2)))
  }));
  if (autoFilter && headers.length) {
    worksheet["!autofilter"] = { ref: XLSX.utils.encode_range({ r: 0, c: 0 }, { r: Math.max(0, rows.length), c: headers.length - 1 }) };
  }
  return worksheet;
}

function safeSheetName(value: string) {
  const clean = value.replace(/[:\\/?*[\]]/g, " ").trim() || "Exportacao";
  return clean.slice(0, 31);
}

function excelSerialFromParts(year: number, month: number, day: number, hour: number, minute: number, second: number) {
  if (![year, month, day, hour, minute, second].every(Number.isFinite)) return null;
  return (Date.UTC(year, month - 1, day, hour, minute, second) - excelEpochUtc) / millisecondsPerDay;
}
