import assert from "node:assert/strict";
import test from "node:test";
import { adherenceFilterQuery, filterWorkHourAdherenceRows, groupWorkHourAdherenceByDay, initialAdherenceFilters } from "./work-hour-adherence-filters";

const period = { startDate: "2026-09-01", endDate: "2026-09-05" };
const row = { id: "a", date: "2026-09-03", lob: "ADS", supervisorId: "sup-a", shift: "Noite", employeeId: "a", employeeName: "Ana", status: "Pendente" };

test("todos os filtros de justificativa são combinados, incluindo datas, parceiro e status", () => {
  const rows = [row,
    { ...row, id: "early", date: "2026-09-02" }, { ...row, id: "late", date: "2026-09-04" },
    { ...row, id: "lob", lob: "CEC" }, { ...row, id: "supervisor", supervisorId: "sup-b" },
    { ...row, id: "shift", shift: "Manhã" }, { ...row, id: "partner", employeeId: "b" },
    { ...row, id: "answered", status: "Justificado" }];
  const before = structuredClone(rows);
  const filters = { ...initialAdherenceFilters(period), startDate: row.date, endDate: row.date,
    lob: row.lob, supervisorId: row.supervisorId, shift: row.shift, employeeId: row.employeeId, justificationStatus: "Pendentes" };
  assert.deepEqual(filterWorkHourAdherenceRows(rows, filters).map((r) => r.id), ["a"]);
  assert.deepEqual(filterWorkHourAdherenceRows(rows, { ...filters, justificationStatus: "Justificados" }).map((r) => r.id), ["answered"]);
  assert.equal(filterWorkHourAdherenceRows(rows, initialAdherenceFilters(period)).length, rows.length);
  assert.deepEqual(rows, before);
});

test("período inclui os dois limites; agrupamento por dia não mistura respondidas e pendentes de outros dias", () => {
  const rows = [{ ...row, id: "z", employeeName: "Zeca" }, { ...row, id: "older", date: "2026-09-01", status: "Justificado" }, row,
    { ...row, id: "newer", date: "2026-09-05" }, { ...row, id: "outside", date: "2026-09-06" }];
  const before = structuredClone(rows);
  const groups = groupWorkHourAdherenceByDay(filterWorkHourAdherenceRows(rows, initialAdherenceFilters(period)));
  assert.deepEqual(groups.map((g) => [g.date, g.rows.map((r) => r.id)]), [
    ["2026-09-05", ["newer"]], ["2026-09-03", ["a", "z"]], ["2026-09-01", ["older"]]
  ]);
  assert.deepEqual(rows, before);
});

test("exportação usa apenas os filtros próprios e identificadores exatos, inclusive sem supervisor", () => {
  const filters = { ...initialAdherenceFilters(period), supervisorId: "__none__", employeeId: "a", justificationStatus: "Justificados" };
  const query = new URLSearchParams(adherenceFilterQuery(filters));
  assert.deepEqual(Object.fromEntries(query), { ...period, supervisorId: "__none__", employeeId: "a", justificationStatus: "Justificados" });
  assert.deepEqual(filterWorkHourAdherenceRows([{ ...row, supervisorId: "__none__", status: "Justificado" }, row], filters).map((r) => r.supervisorId), ["__none__"]);
  assert.deepEqual(groupWorkHourAdherenceByDay([]), []);
});
