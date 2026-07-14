import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { getApiActor } from "@/lib/api-actor";
import {
  commitProductionManualPreviewImport,
  PerformanceError,
  previewProductionImport,
  replacePerformanceSnapshot,
  type PerformancePreviewRow
} from "@/lib/performance-service";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type PreviewedFile = {
  fileName: string;
  rows: PerformancePreviewRow[];
};

export async function POST(request: Request) {
  try {
    const actor = await getApiActor();
    const formData = await request.formData();
    const productionFile = readXlsxFile(formData.get("productionFile"), "Produção / Output");
    const volumeFile = readXlsxFile(formData.get("volumeFile"), "Filas / Input");
    const files = [productionFile, volumeFile];
    const previews: PreviewedFile[] = [];

    for (const file of files) {
      const rawRows = readWorkbookRows(await file.arrayBuffer());
      const preview = await previewProductionImport(actor, rawRows, { skipExistingCheck: true });
      previews.push({ fileName: file.name, rows: preview.rows });
    }

    const coverage = summarizeCoverage(previews);
    if (!coverage.productionRows || !coverage.volumeRows) {
      throw new PerformanceError(
        "As duas bases são obrigatórias: Produção / Output precisa conter submit e Filas / Input precisa conter enqueue.",
        400
      );
    }

    let batchId: string | undefined;
    const imports = [];
    const batchFileName = `${productionFile.name} + ${volumeFile.name}`;
    for (const [index, preview] of previews.entries()) {
      const result = await commitProductionManualPreviewImport(
        actor,
        preview.rows,
        index === 0 ? batchFileName : preview.fileName,
        batchId
      );
      batchId = result.batchId;
      imports.push({
        fileName: preview.fileName,
        importedRows: result.importedRows,
        productionRows: result.productionRows,
        volumeRows: result.volumeRows
      });
    }

    if (!batchId) throw new PerformanceError("Não foi possível criar o lote manual de Performance.", 500);
    const reset = await replacePerformanceSnapshot(actor, batchId);

    return NextResponse.json({
      success: true,
      batchId,
      productionRows: coverage.productionRows,
      volumeRows: coverage.volumeRows,
      rowsError: coverage.rowsError,
      files: imports,
      reset
    });
  } catch (error) {
    if (error instanceof PerformanceError) {
      return NextResponse.json({ success: false, error: error.message, message: error.message }, { status: error.status });
    }
    console.error("[performance/import/manual] erro inesperado", error);
    return NextResponse.json({
      success: false,
      error: "Não foi possível substituir a base manual de Performance.",
      message: "Não foi possível substituir a base manual de Performance."
    }, { status: 500 });
  }
}

function readXlsxFile(value: FormDataEntryValue | null, label: string) {
  if (!(value instanceof File) || !value.size) throw new PerformanceError(`Selecione o arquivo de ${label}.`, 400);
  if (!value.name.toLowerCase().endsWith(".xlsx")) throw new PerformanceError(`${label} deve ser um arquivo XLSX.`, 400);
  return value;
}

function readWorkbookRows(buffer: ArrayBuffer) {
  const workbook = XLSX.read(buffer, { cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : null;
  if (!sheet) throw new PerformanceError("Planilha de Performance não encontrada no arquivo.", 400);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: true });
  if (!rows.length) throw new PerformanceError("A planilha enviada está vazia.", 400);
  return rows;
}

function summarizeCoverage(files: PreviewedFile[]) {
  let productionRows = 0;
  let volumeRows = 0;
  let rowsError = 0;
  for (const file of files) {
    for (const row of file.rows) {
      if (row.errors.length) {
        rowsError += 1;
        continue;
      }
      if (row.type === "PRODUCTION") productionRows += 1;
      if (row.type === "PRODUCTION_VOLUME") volumeRows += 1;
    }
  }
  return { productionRows, volumeRows, rowsError };
}
