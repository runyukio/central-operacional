import assert from "node:assert/strict";
import test from "node:test";

import { isMonthlyAdvanceReferenceMonthAvailable, isMonthlyAdvanceRequestPeriodOpen } from "./monthly-advance-constants";

test("mantém o histórico e outubro/2026 como último mês de referência", () => {
  assert.equal(isMonthlyAdvanceReferenceMonthAvailable("2026-07"), true);
  assert.equal(isMonthlyAdvanceReferenceMonthAvailable("2026-08"), true);
  assert.equal(isMonthlyAdvanceReferenceMonthAvailable("2026-09"), true);
  assert.equal(isMonthlyAdvanceReferenceMonthAvailable("2026-10"), true);
  assert.equal(isMonthlyAdvanceReferenceMonthAvailable("2026-11"), false);
  assert.equal(isMonthlyAdvanceReferenceMonthAvailable("2027-01"), false);
});

test("rejeita meses de referência ausentes ou inválidos", () => {
  assert.equal(isMonthlyAdvanceReferenceMonthAvailable(""), false);
  assert.equal(isMonthlyAdvanceReferenceMonthAvailable("2026-00"), false);
  assert.equal(isMonthlyAdvanceReferenceMonthAvailable("2026-13"), false);
  assert.equal(isMonthlyAdvanceReferenceMonthAvailable("08/2026"), false);
});

test("fecha novos pedidos na virada de outubro para novembro em São Paulo", () => {
  assert.equal(isMonthlyAdvanceRequestPeriodOpen(new Date("2026-11-01T02:59:59.000Z")), true);
  assert.equal(isMonthlyAdvanceRequestPeriodOpen(new Date("2026-11-01T03:00:00.000Z")), false);
});
