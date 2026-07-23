import assert from "node:assert/strict";
import test from "node:test";

import * as XLSX from "xlsx";

import {
  buildXlsxBuffer,
  excelDateSerial,
  excelDateTimeSerial,
  xlsxDurationFormat
} from "./xlsx-export";

test("exporta Data pura, horarios de Sao Paulo e duracoes como celulas numericas do Excel", () => {
  const buffer = buildXlsxBuffer({
    sheetName: "Captura de Horas",
    headers: ["Data", "Início previsto", "Duração", "Tempo de atraso"],
    rows: [
      [excelDateSerial("2026-07-21"), excelDateTimeSerial("2026-07-21T11:00:00.000Z"), 7.5 / 24, 15 / (24 * 60)],
      [excelDateSerial("2026-07-22"), excelDateTimeSerial("2026-07-23T11:00:00.000Z"), 0, 0]
    ],
    autoFilter: true,
    columnFormats: {
      0: "dd/mm/yyyy",
      1: "dd/mm/yyyy hh:mm:ss",
      2: xlsxDurationFormat,
      3: xlsxDurationFormat
    }
  });

  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false, cellNF: true });
  const worksheet = workbook.Sheets["Captura de Horas"];

  assert.ok(worksheet);
  assert.equal(worksheet.A2.t, "n");
  assert.equal(worksheet.A2.z, "dd/mm/yyyy");
  assert.equal(worksheet.A2.v % 1, 0);
  assert.equal(XLSX.SSF.format(worksheet.A2.z!, worksheet.A2.v), "21/07/2026");
  assert.equal(worksheet.B2.t, "n");
  assert.equal(worksheet.B2.z, "dd/mm/yyyy hh:mm:ss");
  assert.equal(XLSX.SSF.format(worksheet.B2.z!, worksheet.B2.v), "21/07/2026 08:00:00");
  assert.equal(worksheet.C2.t, "n");
  assert.equal(worksheet.C2.z, xlsxDurationFormat);
  assert.equal(worksheet.D3.t, "n");
  assert.equal(worksheet.D3.v, 0);
  assert.equal(XLSX.SSF.format(worksheet.D3.z!, worksheet.D3.v), "00:00:00");
  assert.deepEqual(worksheet["!autofilter"], { ref: "A1:D3" });
});
