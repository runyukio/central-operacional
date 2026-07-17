import assert from "node:assert/strict";
import test from "node:test";

import * as XLSX from "xlsx";

import { buildXlsxBuffer, xlsxDurationFormat } from "./xlsx-export";

test("exporta datas e duracoes como celulas tipadas do Excel", () => {
  const buffer = buildXlsxBuffer({
    sheetName: "Captura de Horas",
    headers: ["Data", "Duração", "Tempo de atraso"],
    rows: [
      [new Date("2026-07-17T12:00:00.000Z"), 7.5 / 24, 15 / (24 * 60)],
      [new Date("2026-07-17T12:00:00.000Z"), 0, 0]
    ],
    autoFilter: true,
    columnFormats: {
      0: "dd/mm/yyyy",
      1: xlsxDurationFormat,
      2: xlsxDurationFormat
    }
  });

  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false, cellNF: true });
  const worksheet = workbook.Sheets["Captura de Horas"];

  assert.ok(worksheet);
  assert.equal(worksheet.A2.t, "n");
  assert.equal(worksheet.A2.z, "dd/mm/yyyy");
  assert.equal(worksheet.B2.t, "n");
  assert.equal(worksheet.B2.v, 7.5 / 24);
  assert.equal(worksheet.B2.z, xlsxDurationFormat);
  assert.equal(worksheet.C2.t, "n");
  assert.equal(worksheet.C2.z, xlsxDurationFormat);
  assert.equal(worksheet.C3.t, "n");
  assert.equal(worksheet.C3.v, 0);
  assert.equal(XLSX.SSF.format(worksheet.C3.z!, worksheet.C3.v), "00:00:00");
  assert.deepEqual(worksheet["!autofilter"], { ref: "A1:C3" });
});
