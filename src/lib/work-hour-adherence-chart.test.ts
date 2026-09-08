import assert from "node:assert/strict";
import test from "node:test";
import { ADHERENCE_SUMMARY_SUPERVISORS as roster, buildAdherenceSummary } from "./work-hour-adherence-summary";
import { adherenceBarData, adherenceImportTime } from "./work-hour-adherence-chart";

test("sete IDs fixos e ordem oficial, independentemente dos nomes e quantidades", () => {
  assert.equal(new Set(roster.map((row) => row.id)).size, 7);
  assert.deepEqual(roster.map((row) => row.name), ["Priscilla", "Diógenes", "João Lucas", "Glauce", "William", "Jessica", "Fernanda Bencice"]);
  const data = buildAdherenceSummary({ startDate: "2026-09-03", endDate: "2026-09-07" }, [
    { date: "2026-09-03", supervisorId: roster[0].id, supervisor: "Nome alterado", count: 2 },
    { date: "2026-09-07", supervisorId: roster[0].id, supervisor: "Outra abreviação", count: 3 },
    { date: "2026-09-04", supervisorId: roster[6].id, supervisor: "Nome antigo", count: 90 },
    { date: "2026-09-02", supervisorId: roster[0].id, supervisor: "Fora", count: 100 },
    { date: "2026-09-08", supervisorId: roster[0].id, supervisor: "Fora", count: 100 },
    { date: "2026-09-04", supervisorId: "homonym", supervisor: "Priscilla", count: 100 },
    { date: "2026-09-04", supervisorId: null, supervisor: null, count: 100 }
  ]);
  assert.deepEqual(data.supervisors, roster);
  assert.deepEqual(adherenceBarData(data).map(({ id, count }) => [id, count]), roster.map(({ id }, i) => [id, i === 0 ? 5 : i === 6 ? 90 : 0]));
  assert.equal(data.total, 95);
});

test("dia único e período vazio mantêm as mesmas sete barras com zeros", () => {
  const single = buildAdherenceSummary({ startDate: "2026-09-03", endDate: "2026-09-03" }, []);
  const multiple = buildAdherenceSummary({ startDate: "2026-09-03", endDate: "2026-09-07" }, []);
  for (const data of [single, multiple]) {
    const rows = adherenceBarData(data);
    assert.deepEqual(rows.map(({ id, name }) => ({ id, name })), roster);
    assert.ok(rows.every((row) => row.count === 0));
  }
});

test("a visualização não amplia o escopo autorizado nem usa dados fora do período", () => {
  const data = buildAdherenceSummary({ startDate: "2026-09-03", endDate: "2026-09-03" }, [
    { date: "2026-09-03", supervisorId: roster[0].id, supervisor: "", count: 5 },
    { date: "2026-09-03", supervisorId: roster[1].id, supervisor: "", count: 100 }
  ], [roster[0]]);
  data.days.push({ date: "2026-09-04", supervisors: [{ ...roster[0], count: 100 }], total: 100 });
  assert.deepEqual(adherenceBarData(data).map((row) => row.count), [5, 0, 0, 0, 0, 0, 0]);
});

test("data de importação é mostrada em São Paulo", () => {
  assert.equal(adherenceImportTime("2026-09-08T12:32:42.417Z"), "08/09/2026, 09:32");
});
