import assert from "node:assert/strict";
import test from "node:test";
import { buildAdherenceSummary, isExcludedAdherenceSummarySupervisor } from "./work-hour-adherence-summary";
import { adherenceBarData, adherenceChartSeries, adherenceLineData, adherenceImportTime } from "./work-hour-adherence-chart";

const roster = [{ id: "a", name: "Nome igual" }, { id: "b", name: "Nome igual" }, { id: "zero", name: "Zerado" }];
const data = buildAdherenceSummary({ startDate: "2026-08-31", endDate: "2026-09-02" }, [
  { date: "2026-08-31", supervisorId: "a", supervisor: "Nome antigo", count: 2 },
  { date: "2026-08-31", supervisorId: "b", supervisor: "Nome igual", count: 5 },
  { date: "2026-09-02", supervisorId: "a", supervisor: "Nome antigo", count: 1 },
  { date: "2026-09-03", supervisorId: "a", supervisor: "Fora", count: 100 },
  { date: "2026-09-02", supervisorId: "out", supervisor: "Fora do cadastro", count: 100 }
], roster);

test("barras ordenadas por contagem, preservando homônimos distintos e zero", () => {
  assert.deepEqual(adherenceBarData(data).map((row) => [row.id, row.count]), [["b", 5], ["a", 2], ["zero", 0]]);
  assert.equal(data.total, 8);
  assert.equal(data.supervisors[0].name, "Nome igual");
});

test("linhas preenchem todos os dias e zeros por ID, sem acumular ou unir homônimos", () => {
  assert.deepEqual(adherenceLineData(data), [
    { date: "2026-08-31", supervisor0: 2, supervisor1: 5, supervisor2: 0 },
    { date: "2026-09-01", supervisor0: 0, supervisor1: 0, supervisor2: 0 },
    { date: "2026-09-02", supervisor0: 1, supervisor1: 0, supervisor2: 0 }
  ]);
  const series = adherenceChartSeries(data);
  assert.equal(new Set(series.map((row) => row.color)).size, 3);
  assert.equal(new Set(series.map((row) => row.key)).size, 3);
  assert.equal(series[1].dash, "6 3");
});

test("todos os cadastrados permanecem no período sem pendências, com cores distintas", () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ id: `id.${i}`, name: `Supervisor ${i}` }));
  const empty = buildAdherenceSummary({ startDate: "2026-09-01", endDate: "2026-09-01" }, [], many);
  assert.equal(adherenceBarData(empty).length, 20);
  assert.ok(adherenceBarData(empty).every((row) => row.count === 0));
  assert.equal(new Set(adherenceChartSeries(empty).map((row) => row.color)).size, 20);
  assert.ok(adherenceChartSeries(empty).every((row) => !row.key.includes(".")));
});

test("data de importação é mostrada em São Paulo; exclusões usam WB exato", () => {
  assert.equal(adherenceImportTime("2026-09-08T12:32:42.417Z"), "08/09/2026, 09:32");
  assert.equal(isExcludedAdherenceSummarySupervisor(" WB_HELLIDA "), true);
  assert.equal(isExcludedAdherenceSummarySupervisor("guilhereme.ramos"), true);
  assert.equal(isExcludedAdherenceSummarySupervisor("wb_guilherme30"), false);
});
