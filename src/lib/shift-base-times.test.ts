import assert from "node:assert/strict";
import test from "node:test";

import { baseTimesForShift } from "@/lib/shift-base-times";

test("aplica os horários-base definidos para cada turno operacional", () => {
  assert.deepEqual(baseTimesForShift("Manhã"), { startsAt: "08:00", endsAt: "17:00" });
  assert.deepEqual(baseTimesForShift("Tarde"), { startsAt: "14:00", endsAt: "23:00" });
  assert.deepEqual(baseTimesForShift("Noite"), { startsAt: "23:00", endsAt: "08:00" });
});

test("normaliza o rótulo do turno antes de aplicar os horários-base", () => {
  assert.deepEqual(baseTimesForShift("Manhã (08:00 - 17:00)"), { startsAt: "08:00", endsAt: "17:00" });
  assert.equal(baseTimesForShift("Sem turno"), null);
});
