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
