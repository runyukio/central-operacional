import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

export type XlsxCell = string | number | boolean | Date | null | undefined;

export type XlsxExportPayload = {
  fileName: string;
  sheetName: string;
  headers: string[];
  rows: XlsxCell[][];
};

export const xlsxContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function dateStamp(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function buildXlsxBuffer(payload: Pick<XlsxExportPayload, "sheetName" | "headers" | "rows">) {
  const worksheet = XLSX.utils.aoa_to_sheet([payload.headers, ...payload.rows]);
  worksheet["!cols"] = payload.headers.map((header, index) => ({
    wch: Math.min(48, Math.max(String(header).length + 2, ...payload.rows.map((row) => String(row[index] ?? "").length + 2)))
  }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, safeSheetName(payload.sheetName));
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export function buildXlsxResponse(payload: XlsxExportPayload) {
  const fileName = payload.fileName.toLowerCase().endsWith(".xlsx") ? payload.fileName : `${payload.fileName}.xlsx`;
  return new NextResponse(new Uint8Array(buildXlsxBuffer(payload)), {
    headers: {
      "Content-Type": xlsxContentType,
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store"
    }
  });
}

function safeSheetName(value: string) {
  const clean = value.replace(/[:\\/?*[\]]/g, " ").trim() || "Exportacao";
  return clean.slice(0, 31);
}
