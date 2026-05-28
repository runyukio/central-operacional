import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

export type XlsxCell = string | number | boolean | Date | null | undefined;

export type XlsxExportPayload = {
  fileName: string;
  sheetName: string;
  headers: string[];
  rows: XlsxCell[][];
  sheets?: Array<{
    sheetName: string;
    headers: string[];
    rows: XlsxCell[][];
  }>;
};

export const xlsxContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function dateStamp(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function buildXlsxBuffer(payload: Pick<XlsxExportPayload, "sheetName" | "headers" | "rows">) {
  const worksheet = buildWorksheet(payload.headers, payload.rows);
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
  XLSX.utils.book_append_sheet(workbook, buildWorksheet(payload.headers, payload.rows), safeSheetName(payload.sheetName));
  for (const sheet of payload.sheets ?? []) {
    XLSX.utils.book_append_sheet(workbook, buildWorksheet(sheet.headers, sheet.rows), safeSheetName(sheet.sheetName));
  }
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function buildWorksheet(headers: string[], rows: XlsxCell[][]) {
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  worksheet["!cols"] = headers.map((header, index) => ({
    wch: Math.min(48, Math.max(String(header).length + 2, ...rows.map((row) => String(row[index] ?? "").length + 2)))
  }));
  return worksheet;
}

function safeSheetName(value: string) {
  const clean = value.replace(/[:\\/?*[\]]/g, " ").trim() || "Exportacao";
  return clean.slice(0, 31);
}
