import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const inputPath = "/Users/lucaskawakami/Downloads/data.xlsx";
const outputDir = "/Users/lucaskawakami/Documents/New project/outputs/capacity_may_2026";
const outputPath = `${outputDir}/capacity_projection_may_2026.xlsx`;

const lobs = ["ADS", "CEC", "Comments", "Video"];
const currentHC = { ADS: 63, CEC: 25, Comments: 9, Video: 28 };
const requiredHC = { ADS: 65, CEC: 26, Comments: 9, Video: 31 };
const currentDate = new Date(Date.UTC(2026, 4, 17));
const endDate = new Date(Date.UTC(2026, 4, 31));
const baselineStart = new Date(Date.UTC(2026, 0, 1));
const baselineEnd = new Date(Date.UTC(2026, 3, 30));
const baselineDays = 120;
const projectionDays = 14;
const trainingAttrition = 0.4;
const completionRate = 1 - trainingAttrition;

function excelSerialToDate(serial) {
  if (serial instanceof Date) return serial;
  if (typeof serial !== "number") return null;
  return new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function monthKey(date) {
  return date.toISOString().slice(0, 7);
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 86400000);
}

function a1(col, row) {
  let n = col;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - m) / 26);
  }
  return `${s}${row}`;
}

function rangeA1(c1, r1, c2, r2) {
  return `${a1(c1, r1)}:${a1(c2, r2)}`;
}

function countBy(items, keyFn) {
  const out = new Map();
  for (const item of items) {
    const key = keyFn(item);
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}

function sortedSegmentRows(rows, dailyRates) {
  const grouped = countBy(rows, (r) => `${r.lob}||${r.type}||${r.tenure}`);
  const byLob = countBy(rows, (r) => r.lob);
  const result = [];
  for (const [key, count] of grouped.entries()) {
    const [lob, type, tenure] = key.split("||");
    result.push({
      lob,
      type,
      tenure,
      count,
      mix: count / (byLob.get(lob) || 1),
      expected: (count / baselineDays) * projectionDays,
      lobDaily: dailyRates[lob],
    });
  }
  result.sort((a, b) => {
    const lobCmp = lobs.indexOf(a.lob) - lobs.indexOf(b.lob);
    if (lobCmp !== 0) return lobCmp;
    return b.expected - a.expected;
  });
  return result;
}

function setTitle(sheet, range, text) {
  sheet.getRange(range).merge();
  const r = sheet.getRange(range);
  r.values = [[text]];
  r.format.fill = "#19324D";
  r.format.font = { color: "#FFFFFF", bold: true, size: 15 };
  r.format.horizontalAlignment = "center";
  r.format.verticalAlignment = "center";
  r.format.rowHeightPx = 34;
}

function styleHeader(range) {
  range.format.fill = "#2F5D62";
  range.format.font = { color: "#FFFFFF", bold: true };
  range.format.horizontalAlignment = "center";
  range.format.wrapText = true;
  range.format.borders = { preset: "outside", style: "thin", color: "#9CA3AF" };
}

function styleBody(range) {
  range.format.fill = "#F8FAFC";
  range.format.borders = { preset: "outside", style: "thin", color: "#CBD5E1" };
}

function setWidths(sheet, widths) {
  widths.forEach((px, idx) => {
    sheet.getRange(`${a1(idx + 1, 1)}:${a1(idx + 1, 1)}`).format.columnWidthPx = px;
  });
}

const sourceFile = await FileBlob.load(inputPath);
const sourceWorkbook = await SpreadsheetFile.importXlsx(sourceFile);
const sourceInspect = await sourceWorkbook.inspect({
  kind: "table",
  range: "Export!A1:G90",
  include: "values",
  tableMaxRows: 100,
  tableMaxCols: 7,
  maxChars: 200000,
});
const sourceRecord = JSON.parse(sourceInspect.ndjson.trim().split("\n").find((line) => line.includes('"kind":"table"')));
const [headers, ...rawRows] = sourceRecord.values;

const dataRows = rawRows
  .filter((row) => row.some((v) => v !== null && v !== undefined && v !== ""))
  .map((row) => ({
    wb: row[0],
    wave: row[1],
    type: row[2],
    tenure: row[3],
    hired: excelSerialToDate(row[4]),
    resign: excelSerialToDate(row[5]),
    lob: row[6],
  }))
  .filter((row) => row.resign && row.lob);

const baselineRows = dataRows.filter((row) => row.resign >= baselineStart && row.resign <= baselineEnd);
const allHistoryEnd = dataRows.reduce((max, row) => (row.resign > max ? row.resign : max), dataRows[0].resign);
const baselineByLob = countBy(baselineRows, (r) => r.lob);
const allByLob = countBy(dataRows, (r) => r.lob);
const dailyRates = Object.fromEntries(lobs.map((lob) => [lob, (baselineByLob.get(lob) ?? 0) / baselineDays]));

const projectionDates = Array.from({ length: projectionDays + 1 }, (_, i) => addDays(currentDate, i));
const projectionTable = projectionDates.map((date, dayIndex) => {
  const row = { date };
  let total = 0;
  for (const lob of lobs) {
    const value = currentHC[lob] - dayIndex * dailyRates[lob];
    row[lob] = value;
    total += value;
  }
  row.Total = total;
  return row;
});

const segmentRows = sortedSegmentRows(baselineRows, dailyRates);
const topRiskByLob = {};
for (const lob of lobs) {
  topRiskByLob[lob] = segmentRows.find((row) => row.lob === lob);
}

const months = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"];
const monthlyRows = months.map((month) => {
  const row = [month];
  for (const lob of lobs) {
    row.push(dataRows.filter((r) => monthKey(r.resign) === month && r.lob === lob).length);
  }
  row.push(dataRows.filter((r) => monthKey(r.resign) === month).length);
  return row;
});

const workbook = Workbook.create();
const resumo = workbook.worksheets.getOrAdd("Resumo", { renameFirstIfOnlyNewSpreadsheet: true });
const proj = workbook.worksheets.add("Projecao_Diaria");
const mix = workbook.worksheets.add("Attrition_Mix");
const mensal = workbook.worksheets.add("Historico_Mensal");
const prem = workbook.worksheets.add("Premissas");
const fonte = workbook.worksheets.add("Fonte_Dados");

for (const sheet of [resumo, proj, mix, mensal, prem, fonte]) {
  sheet.showGridLines = false;
}

setTitle(resumo, "A1:L1", "Capacity Maio 2026 - Projecao e Turmas");
resumo.getRange("A3:L3").values = [[
  "Modelo usa Jan-Abr/2026 como baseline de attrition diaria por LOB. Maio esta parcial no arquivo, entao entra no historico mensal, mas nao na taxa base.",
  null, null, null, null, null, null, null, null, null, null, null,
]];
resumo.getRange("A3:L3").merge();
resumo.getRange("A3:L3").format.fill = "#EEF6F4";
resumo.getRange("A3:L3").format.font = { color: "#19324D", italic: true };
resumo.getRange("A3:L3").format.wrapText = true;
resumo.getRange("A3:L3").format.rowHeightPx = 34;

const summaryHeaders = [[
  "LOB",
  "HC atual",
  "Requerido",
  "Hist deslig Jan-Abr",
  "Deslig/dia",
  "HC proj 31/05",
  "Gap vs req",
  "Iniciar treinamento",
  "Graduados esp.",
  "HC final c/ turma",
  "Saldo vs req",
  "Maior risco historico",
]];
resumo.getRange("A5:L5").values = summaryHeaders;
styleHeader(resumo.getRange("A5:L5"));

const summaryStart = 6;
const summaryValues = lobs.map((lob) => {
  const risk = topRiskByLob[lob];
  const riskText = risk ? `${risk.type} / ${risk.tenure}` : "Sem historico";
  return [lob, currentHC[lob], requiredHC[lob], baselineByLob.get(lob) ?? 0, null, null, null, null, null, null, null, riskText];
});
resumo.getRange(`A${summaryStart}:L${summaryStart + lobs.length - 1}`).values = summaryValues;
for (let i = 0; i < lobs.length; i++) {
  const row = summaryStart + i;
  resumo.getRange(`E${row}`).formulas = [[`=D${row}/Premissas!$B$7`]];
  resumo.getRange(`F${row}`).formulas = [[`=B${row}-(Premissas!$B$8*E${row})`]];
  resumo.getRange(`G${row}`).formulas = [[`=MAX(0,C${row}-F${row})`]];
  resumo.getRange(`H${row}`).formulas = [[`=CEILING(G${row}/Premissas!$B$10,1)`]];
  resumo.getRange(`I${row}`).formulas = [[`=H${row}*Premissas!$B$10`]];
  resumo.getRange(`J${row}`).formulas = [[`=F${row}+I${row}`]];
  resumo.getRange(`K${row}`).formulas = [[`=J${row}-C${row}`]];
}
const totalRow = summaryStart + lobs.length;
resumo.getRange(`A${totalRow}:L${totalRow}`).values = [["Total", null, null, null, null, null, null, null, null, null, null, ""]];
for (const col of ["B", "C", "D", "F", "G", "H", "I", "J", "K"]) {
  resumo.getRange(`${col}${totalRow}`).formulas = [[`=SUM(${col}${summaryStart}:${col}${totalRow - 1})`]];
}
resumo.getRange(`E${totalRow}`).formulas = [[`=SUM(E${summaryStart}:E${totalRow - 1})`]];
resumo.getRange(`A${summaryStart}:L${totalRow}`).format.borders = { preset: "outside", style: "thin", color: "#CBD5E1" };
resumo.getRange(`A${totalRow}:L${totalRow}`).format.fill = "#DDEFE8";
resumo.getRange(`A${totalRow}:L${totalRow}`).format.font = { bold: true, color: "#19324D" };
resumo.getRange(`B${summaryStart}:D${totalRow}`).format.numberFormat = "0";
resumo.getRange(`E${summaryStart}:G${totalRow}`).format.numberFormat = "0.0";
resumo.getRange(`H${summaryStart}:I${totalRow}`).format.numberFormat = "0.0";
resumo.getRange(`J${summaryStart}:K${totalRow}`).format.numberFormat = "0.0";
resumo.getRange(`G${summaryStart}:G${totalRow - 1}`).conditionalFormats.addCellIs({
  operator: "greaterThan",
  formula: 0,
  format: { fill: "#FCE4D6", font: { color: "#9C2F1A", bold: true } },
});
resumo.getRange(`K${summaryStart}:K${totalRow - 1}`).conditionalFormats.addCellIs({
  operator: "lessThan",
  formula: 0,
  format: { fill: "#FCE4D6", font: { color: "#9C2F1A", bold: true } },
});
setWidths(resumo, [118, 82, 88, 118, 86, 104, 88, 126, 106, 118, 94, 180]);
resumo.freezePanes.freezeRows(5);

setTitle(proj, "A1:F1", "Projecao diaria de HC esperado");
const projHeaders = [["Data", ...lobs, "Total"]];
proj.getRange("A3:F3").values = projHeaders;
styleHeader(proj.getRange("A3:F3"));
proj.getRange(`A4:A${4 + projectionDates.length - 1}`).values = projectionDates.map((d) => [d]);
proj.getRange(`A4:A${4 + projectionDates.length - 1}`).format.numberFormat = "dd/mm/yyyy";
for (let i = 0; i < projectionDates.length; i++) {
  const row = 4 + i;
  for (let j = 0; j < lobs.length; j++) {
    const summaryRow = summaryStart + j;
    const col = a1(j + 2, row).replace(/[0-9]/g, "");
    proj.getRange(`${col}${row}`).formulas = [[`=Resumo!$B$${summaryRow}-${i}*Resumo!$E$${summaryRow}`]];
  }
  proj.getRange(`F${row}`).formulas = [[`=SUM(B${row}:E${row})`]];
}
proj.getRange(`A3:F${4 + projectionDates.length - 1}`).format.borders = { preset: "outside", style: "thin", color: "#CBD5E1" };
proj.getRange(`B4:F${4 + projectionDates.length - 1}`).format.numberFormat = "0.0";
proj.getRange("H3:M3").values = [["LOB", "Requerido", "HC 31/05", "Gap", "Iniciar", "Grad esp."]];
styleHeader(proj.getRange("H3:M3"));
for (let i = 0; i < lobs.length; i++) {
  const row = 4 + i;
  const srow = summaryStart + i;
  proj.getRange(`H${row}:M${row}`).formulas = [[
    `=Resumo!A${srow}`,
    `=Resumo!C${srow}`,
    `=Resumo!F${srow}`,
    `=Resumo!G${srow}`,
    `=Resumo!H${srow}`,
    `=Resumo!I${srow}`,
  ]];
}
proj.getRange("H4:M7").format.numberFormat = "0.0";
proj.getRange("H4:H7").format.numberFormat = "@";
proj.getRange("H3:M7").format.borders = { preset: "outside", style: "thin", color: "#CBD5E1" };
proj.charts.add("line", {
  title: "HC projetado por LOB ate 31/05",
  categories: projectionDates.map((d) => dateKey(d).slice(5)),
  series: lobs.map((lob) => ({
    name: lob,
    values: projectionTable.map((row) => row[lob]),
  })),
  hasLegend: true,
  legend: { position: "bottom" },
  from: { row: 9, col: 7 },
  extent: { widthPx: 520, heightPx: 300 },
});
setWidths(proj, [96, 82, 82, 92, 82, 86, 20, 95, 92, 92, 82, 82, 82]);
proj.freezePanes.freezeRows(3);

setTitle(mix, "A1:F1", "Mix de attrition usado no risco");
mix.getRange("A3:F3").values = [["LOB", "Tipo", "Tenure", "Deslig Jan-Abr", "Mix no LOB", "Exp. saidas ate 31/05"]];
styleHeader(mix.getRange("A3:F3"));
const mixValues = segmentRows.map((row) => [row.lob, row.type, row.tenure, row.count, row.mix, row.expected]);
mix.getRange(`A4:F${3 + mixValues.length}`).values = mixValues;
mix.getRange(`A3:F${3 + mixValues.length}`).format.borders = { preset: "outside", style: "thin", color: "#CBD5E1" };
mix.getRange(`D4:D${3 + mixValues.length}`).format.numberFormat = "0";
mix.getRange(`E4:E${3 + mixValues.length}`).format.numberFormat = "0%";
mix.getRange(`F4:F${3 + mixValues.length}`).format.numberFormat = "0.00";
mix.getRange(`F4:F${3 + mixValues.length}`).conditionalFormats.add("dataBar", { color: "#6AA6A0", gradient: true });
setWidths(mix, [104, 118, 118, 112, 92, 130]);
mix.freezePanes.freezeRows(3);

setTitle(mensal, "A1:F1", "Historico mensal de desligamentos");
mensal.getRange("A3:F3").values = [["Mes", ...lobs, "Total"]];
styleHeader(mensal.getRange("A3:F3"));
mensal.getRange(`A4:F${3 + monthlyRows.length}`).values = monthlyRows;
mensal.getRange(`A3:F${3 + monthlyRows.length}`).format.borders = { preset: "outside", style: "thin", color: "#CBD5E1" };
mensal.getRange(`B4:F${3 + monthlyRows.length}`).format.numberFormat = "0";
mensal.getRange("A10:F11").merge();
mensal.getRange("A10").values = [[
  "Nota: Maio esta parcial na base; ultimo desligamento em " + dateKey(allHistoryEnd) + ". Por isso, Jan-Abr foi usado como baseline de taxa diaria.",
]];
mensal.getRange("A10:F11").format.fill = "#FFF7E6";
mensal.getRange("A10:F11").format.wrapText = true;
mensal.getRange("A10:F11").format.rowHeightPx = 32;
mensal.charts.add("ColumnClustered", {
  title: "Desligamentos por mes e LOB",
  categories: months,
  series: lobs.map((lob, idx) => ({
    name: lob,
    values: monthlyRows.map((row) => row[idx + 1]),
  })),
  hasLegend: true,
  legend: { position: "bottom" },
  from: { row: 13, col: 0 },
  extent: { widthPx: 500, heightPx: 250 },
});
setWidths(mensal, [96, 82, 82, 92, 82, 82]);

setTitle(prem, "A1:D1", "Premissas do modelo");
const premValues = [
  ["Data atual / ponto de partida", currentDate, "HC atual informado pelo usuario", null],
  ["Fim da projecao", endDate, "Fim do mes de Maio/2026", null],
  ["Baseline historico inicio", baselineStart, "Periodo cheio usado na taxa", null],
  ["Baseline historico fim", baselineEnd, "Maio fica fora da taxa por estar parcial", null],
  ["Dias historico baseline", baselineDays, "Jan-Abr/2026", null],
  ["Dias projetados apos ponto de partida", projectionDays, "18/05/2026 a 31/05/2026", null],
  ["Attrition no treinamento", trainingAttrition, "Premissa do usuario", null],
  ["Completion esperado treinamento", completionRate, "1 - attrition treinamento", null],
];
prem.getRange("A3:D10").values = premValues;
styleHeader(prem.getRange("A2:D2"));
prem.getRange("A2:D2").values = [["Premissa", "Valor", "Comentario", ""]];
prem.getRange("A3:D10").format.borders = { preset: "outside", style: "thin", color: "#CBD5E1" };
prem.getRange("B3:B6").format.numberFormat = "dd/mm/yyyy";
prem.getRange("B7:B8").format.numberFormat = "0";
prem.getRange("B9:B10").format.numberFormat = "0%";
setWidths(prem, [230, 118, 290, 24]);

setTitle(fonte, "A1:G1", "Base historica limpa");
fonte.getRange("A3:G3").values = [headers];
styleHeader(fonte.getRange("A3:G3"));
const sourceValues = dataRows.map((row) => [row.wb, row.wave, row.type, row.tenure, row.hired, row.resign, row.lob]);
fonte.getRange(`A4:G${3 + sourceValues.length}`).values = sourceValues;
fonte.getRange(`E4:F${3 + sourceValues.length}`).format.numberFormat = "dd/mm/yyyy";
fonte.getRange(`A3:G${3 + sourceValues.length}`).format.borders = { preset: "outside", style: "thin", color: "#CBD5E1" };
setWidths(fonte, [150, 86, 112, 112, 96, 96, 92]);
fonte.freezePanes.freezeRows(3);

workbook.recalculate();

const summaryCheck = await workbook.inspect({
  kind: "table",
  range: "Resumo!A5:L10",
  include: "values,formulas",
  tableMaxRows: 10,
  tableMaxCols: 12,
  maxChars: 12000,
});
console.log("SUMMARY_CHECK");
console.log(summaryCheck.ndjson);

const projectionCheck = await workbook.inspect({
  kind: "table",
  range: "Projecao_Diaria!A3:F18",
  include: "values,formulas",
  tableMaxRows: 20,
  tableMaxCols: 7,
  maxChars: 12000,
});
console.log("PROJECTION_CHECK");
console.log(projectionCheck.ndjson);

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  summary: "final formula error scan",
  maxChars: 4000,
});
console.log("ERROR_SCAN");
console.log(errors.ndjson);

await fs.mkdir(outputDir, { recursive: true });
for (const [sheetName, range] of [
  ["Resumo", "A1:L11"],
  ["Projecao_Diaria", "A1:M24"],
  ["Attrition_Mix", "A1:F24"],
  ["Historico_Mensal", "A1:F26"],
  ["Premissas", "A1:D12"],
  ["Fonte_Dados", "A1:G24"],
]) {
  const preview = await workbook.render({ sheetName, range, format: "png" });
  await fs.writeFile(`${outputDir}/preview_${sheetName}.png`, Buffer.from(await preview.arrayBuffer()));
}

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(`SAVED ${outputPath}`);
