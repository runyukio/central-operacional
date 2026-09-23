import assert from "node:assert/strict";
import test from "node:test";

import {
  employeeMonthlyAdvanceCycleMonths,
  isAdvanceMonthOpenForEmployee
} from "./monthly-advance-service";

test("abre o mês atual e o próximo mantendo os demais meses fechados", () => {
  const beforeDeadline = new Date("2026-08-04T15:00:00.000Z");

  assert.deepEqual(employeeMonthlyAdvanceCycleMonths(beforeDeadline), ["2026-08", "2026-09"]);
  assert.equal(isAdvanceMonthOpenForEmployee("2026-08", beforeDeadline), true);
  assert.equal(isAdvanceMonthOpenForEmployee("2026-09", beforeDeadline), true);
  assert.equal(isAdvanceMonthOpenForEmployee("2026-07", beforeDeadline), false);
});

test("mantém o prazo do mês atual encerrado a partir do dia 18", () => {
  const deadlineReached = new Date("2026-08-18T15:00:00.000Z");

  assert.equal(isAdvanceMonthOpenForEmployee("2026-08", deadlineReached), false);
  assert.equal(isAdvanceMonthOpenForEmployee("2026-09", deadlineReached), true);
});

test("oferece outubro sem abrir novembro e encerra os ciclos em novembro", () => {
  const september = new Date("2026-09-20T15:00:00.000Z");
  const octoberFirst = new Date("2026-10-01T15:00:00.000Z");
  const october = new Date("2026-10-20T15:00:00.000Z");
  const november = new Date("2026-11-01T03:00:00.000Z");

  assert.deepEqual(employeeMonthlyAdvanceCycleMonths(september), ["2026-09", "2026-10"]);
  assert.deepEqual(employeeMonthlyAdvanceCycleMonths(octoberFirst), ["2026-10"]);
  assert.equal(isAdvanceMonthOpenForEmployee("2026-10", octoberFirst), true);
  assert.equal(isAdvanceMonthOpenForEmployee("2026-11", octoberFirst), false);
  assert.deepEqual(employeeMonthlyAdvanceCycleMonths(october), ["2026-10"]);
  assert.deepEqual(employeeMonthlyAdvanceCycleMonths(november), []);
  assert.equal(isAdvanceMonthOpenForEmployee("2026-10", october), false);
  assert.equal(isAdvanceMonthOpenForEmployee("2026-11", october), false);
});
