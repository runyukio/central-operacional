import * as XLSX from "xlsx";
import { parseUrRows } from "./performance-ur";
import { checkWorkbook } from "./quality-weekly/workbook";

export function readUrWorkbook(buffer: Buffer | ArrayBuffer) {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  checkWorkbook(bytes, "ur.xlsx");
  const workbook = XLSX.read(bytes, { type: "array", cellDates: true, nodim: true, cellFormula: false, cellHTML: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("Planilha UR não encontrada.");
  const range = XLSX.utils.decode_range(sheet["!ref"] || "A1");
  if (range.e.r > 250000 || (range.e.r + 1) * (range.e.c + 1) > 6000000) throw new Error("Base UR excede o limite de linhas/células.");
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "", blankrows: true });
  const headers = (grid[0] || []).map(String);
  if (new Set(headers).size !== headers.length) throw new Error("Colunas repetidas na base UR.");
  return parseUrRows(grid.slice(1).map((row) => Object.fromEntries(headers.map((name, i) => [name, row[i]]))));
}
