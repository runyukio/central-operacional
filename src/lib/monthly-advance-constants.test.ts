import assert from "node:assert/strict";
import test from "node:test";

import { isMonthlyAdvanceReferenceMonthAvailable } from "./monthly-advance-constants";

test("mantém julho disponível como histórico e reabre os ciclos seguintes", () => {
  assert.equal(isMonthlyAdvanceReferenceMonthAvailable("2026-07"), true);
  assert.equal(isMonthlyAdvanceReferenceMonthAvailable("2026-08"), true);
  assert.equal(isMonthlyAdvanceReferenceMonthAvailable("2026-09"), true);
  assert.equal(isMonthlyAdvanceReferenceMonthAvailable("2027-01"), true);
});

test("rejeita meses de referência ausentes ou inválidos", () => {
  assert.equal(isMonthlyAdvanceReferenceMonthAvailable(""), false);
  assert.equal(isMonthlyAdvanceReferenceMonthAvailable("2026-00"), false);
  assert.equal(isMonthlyAdvanceReferenceMonthAvailable("2026-13"), false);
  assert.equal(isMonthlyAdvanceReferenceMonthAvailable("08/2026"), false);
});
