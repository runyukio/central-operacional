import assert from "node:assert/strict";
import test from "node:test";

import { isShiftChangeEffective, saoPauloDateKey } from "@/lib/shift-change-effective-service";

test("mantém a troca agendada até o dia anterior ao início da vigência", () => {
  const beforeEffectiveDate = new Date("2026-08-01T02:59:59.000Z");

  assert.equal(saoPauloDateKey(beforeEffectiveDate), "2026-07-31");
  assert.equal(isShiftChangeEffective("2026-08-01", beforeEffectiveDate), false);
});

test("aplica a troca exatamente quando começa o dia da vigência em São Paulo", () => {
  const startOfEffectiveDate = new Date("2026-08-01T03:00:00.000Z");

  assert.equal(saoPauloDateKey(startOfEffectiveDate), "2026-08-01");
  assert.equal(isShiftChangeEffective("2026-08-01", startOfEffectiveDate), true);
});

test("aplica imediatamente quando a vigência é hoje ou já passou", () => {
  const referenceDate = new Date("2026-08-05T15:00:00.000Z");

  assert.equal(isShiftChangeEffective("2026-08-05", referenceDate), true);
  assert.equal(isShiftChangeEffective("2026-07-30", referenceDate), true);
});
