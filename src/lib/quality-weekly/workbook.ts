import * as XLSX from 'xlsx';
import type { Cell, SourceTable } from './domain';

export const MAX_UPLOAD = 10 * 1024 * 1024;
// Bound decompression before handing third-party exports to the workbook reader.
export function checkWorkbook(bytes: Uint8Array, filename: string) {
  if (!bytes.length || bytes.length > MAX_UPLOAD)
    throw new Error('Choose a non-empty file up to 10 MB.');
  if (filename.toLowerCase().endsWith('.csv')) return;
  if (!filename.toLowerCase().endsWith('.xlsx'))
    throw new Error('Use an .xlsx workbook. Queue mappings also accept .csv.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw new Error('This file is not a readable Excel workbook.');
  let offset = view.getUint32(end + 16, true),
    total = 0;
  const count = view.getUint16(end + 10, true);
  if (count > 10000)
    throw new Error(
      'The workbook contains too many embedded entries. Export only the detail table.',
    );
  for (let i = 0; i < count; i++) {
    if (
      offset + 46 > bytes.length ||
      view.getUint32(offset, true) !== 0x02014b50
    )
      throw new Error(
        'The Excel workbook is damaged or uses an unsupported archive format.',
      );
    total += view.getUint32(offset + 24, true);
    if (total > 32 * 1024 * 1024)
      throw new Error(
        'The expanded workbook is too large. Export fewer complete weeks in each file.',
      );
    offset +=
      46 +
      view.getUint16(offset + 28, true) +
      view.getUint16(offset + 30, true) +
      view.getUint16(offset + 32, true);
  }
}
export function readTables(bytes: Uint8Array, filename: string): SourceTable[] {
  checkWorkbook(bytes, filename);
  const workbook = XLSX.read(bytes, {
    type: 'array',
    nodim: true,
    raw: true,
    cellDates: false,
    cellNF: true,
    cellFormula: false,
    cellHTML: false,
  });
  return workbook.SheetNames.map((sheet) => {
    const grid = XLSX.utils.sheet_to_json<Cell[]>(workbook.Sheets[sheet], {
      header: 1,
      range: 0,
      defval: null,
      blankrows: true,
      raw: true,
    });
    const head = grid.findIndex((row) =>
      row.some((c) => c != null && String(c).trim()),
    );
    if (head < 0) return { sheet, headers: [], rows: [], rowNumbers: [] };
    const headers = grid[head].map((c) => (c == null ? '' : String(c).trim()));
    const rows = grid.slice(head + 1),
      rowNumbers = rows.map((_, i) => head + i + 2);
    if (rows.length > 30000 || rows.length * headers.length > 600000)
      throw new Error(
        'Export at most 30,000 cases per file and include only the required columns.',
      );
    // sheet_to_json may turn formatted numeric dates into local Date objects.
    // Keep the original Excel serial so moderation days never depend on server timezone.
    {
      for (let r = head + 1; r < grid.length; r++)
        for (let col = 0; col < headers.length; col++) {
          const cell =
            workbook.Sheets[sheet][XLSX.utils.encode_cell({ r, c: col })];
          if (cell?.t === 'n' && cell.z && XLSX.SSF.is_date(cell.z))
            rows[r - head - 1][col] = Number(cell.v) + (workbook.Workbook?.WBProps?.date1904 ? 1462 : 0);
        }
    }
    return { sheet, headers, rows, rowNumbers };
  }).filter((t) => t.headers.length);
}
export function selectTable(tables: SourceTable[], name?: string) {
  if (!tables.length) throw new Error('The workbook is empty.');
  if (name) {
    const table = tables.find((t) => t.sheet === name);
    if (!table) throw new Error('The selected worksheet was not found.');
    return table;
  }
  if (tables.length > 1)
    throw new Error(
      'Choose the worksheet containing the complete detail table.',
    );
  return tables[0];
}
