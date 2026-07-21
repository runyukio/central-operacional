import * as XLSX from "xlsx";

export type XlsxRowChunk = {
  rows: Record<string, unknown>[];
  rowNumberOffset: number;
};

export type XlsxChunkSummary = {
  sheetName: string;
  totalRows: number;
  processedRows: number;
};

type XlsxChunkOptions = {
  chunkRows: number;
  maxRows: number;
  onChunk: (chunk: XlsxRowChunk) => Promise<void>;
};

export class XlsxChunkError extends Error {}

export async function processFirstWorksheetInChunks(
  data: Buffer | Uint8Array | ArrayBuffer,
  options: XlsxChunkOptions
): Promise<XlsxChunkSummary> {
  if (!Number.isInteger(options.chunkRows) || options.chunkRows < 1) {
    throw new XlsxChunkError("O tamanho do lote deve ser maior que zero.");
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(data, { cellDates: true, dense: true });
  } catch {
    throw new XlsxChunkError("Não foi possível ler o arquivo XLSX de Qualidade.");
  }
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : null;
  const reference = sheet?.["!ref"];
  if (!sheet || !reference) throw new XlsxChunkError("Planilha de Performance não encontrada no arquivo.");

  const range = XLSX.utils.decode_range(reference);
  const firstDataRow = range.s.r + 1;
  const totalRows = Math.max(0, range.e.r - range.s.r);
  if (!totalRows) throw new XlsxChunkError("A planilha enviada está vazia.");
  if (totalRows > options.maxRows) {
    throw new XlsxChunkError(`A planilha excede o limite de ${options.maxRows.toLocaleString("pt-BR")} linhas.`);
  }

  const headerValues = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: true,
    range: {
      s: { r: range.s.r, c: range.s.c },
      e: { r: range.s.r, c: range.e.c }
    }
  })[0] ?? [];
  const headers = uniqueHeaders(headerValues, range.e.c - range.s.c + 1);

  let processedRows = 0;
  for (let startRow = firstDataRow; startRow <= range.e.r; startRow += options.chunkRows) {
    const endRow = Math.min(range.e.r, startRow + options.chunkRows - 1);
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      header: headers,
      defval: "",
      raw: true,
      blankrows: true,
      range: {
        s: { r: startRow, c: range.s.c },
        e: { r: endRow, c: range.e.c }
      }
    });
    await options.onChunk({ rows, rowNumberOffset: startRow - firstDataRow });
    processedRows += rows.length;
  }

  return { sheetName, totalRows, processedRows };
}

function uniqueHeaders(values: unknown[], columnCount: number) {
  const occurrences = new Map<string, number>();
  return Array.from({ length: columnCount }, (_, index) => {
    const base = String(values[index] ?? "").trim() || `__EMPTY_${index + 1}`;
    const seen = occurrences.get(base) ?? 0;
    occurrences.set(base, seen + 1);
    return seen ? `${base}_${seen}` : base;
  });
}
