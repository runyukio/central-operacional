import assert from "node:assert/strict";
import test from "node:test";
import type { ScheduleStatus } from "@prisma/client";
import { parseScheduleSlotFilter, resolveScheduleStatusFilter, serializeScheduleSlotFilter, toggleScheduleSlotFilter, validScheduleSlotCountFilter } from "./schedule-slot-filter";

const mapping: Record<string, ScheduleStatus> = { Falta: "FALTA", "Falta Injustificada": "FALTA_INJUSTIFICADA", "Falta Justificada": "FALTA_JUSTIFICADA", Presente: "PRESENTE", "Sem cronograma": "SEM_ESCALA", "Sem escala": "SEM_ESCALA" };

test("empty and Todos preserve the existing unfiltered behavior", () => {
  for (const value of [undefined, "", "Todos", "  Todos ,  "]) {
    assert.deepEqual(parseScheduleSlotFilter(value), []);
    assert.equal(resolveScheduleStatusFilter(value, mapping), undefined);
  }
  assert.equal(serializeScheduleSlotFilter([]), "Todos");
});

test("multiple labels survive URL encoding, whitespace and duplicate selections", () => {
  const input = " Falta, Falta Injustificada, Falta ";
  const params = new URLSearchParams({ status: serializeScheduleSlotFilter(parseScheduleSlotFilter(input)) });
  const decoded = new URLSearchParams(params.toString()).get("status")!;
  assert.equal(decoded, "Falta,Falta Injustificada");
  assert.deepEqual(resolveScheduleStatusFilter(decoded, mapping), { in: ["FALTA", "FALTA_INJUSTIFICADA"] });
  assert.deepEqual(resolveScheduleStatusFilter("Todos,Falta", mapping), "FALTA");
});

test("single status and existing aliases keep their exact meaning", () => {
  assert.equal(resolveScheduleStatusFilter("Falta", mapping), "FALTA");
  assert.equal(resolveScheduleStatusFilter("Falta Justificada", mapping), "FALTA_JUSTIFICADA");
  assert.equal(resolveScheduleStatusFilter("Sem cronograma,Sem escala", mapping), "SEM_ESCALA");
});

test("toggling never duplicates a selection and removing the last restores Todos", () => {
  let value = toggleScheduleSlotFilter("Todos", "Falta");
  value = toggleScheduleSlotFilter(value, "Falta Injustificada");
  assert.equal(value, "Falta,Falta Injustificada");
  value = toggleScheduleSlotFilter(value, "Falta");
  assert.equal(value, "Falta Injustificada");
  assert.equal(toggleScheduleSlotFilter(value, "Falta Injustificada"), "Todos");
});

test("unknown labels cannot broaden the query or use inherited object keys", () => {
  assert.deepEqual(resolveScheduleStatusFilter("invalid,__proto__,constructor", mapping), { in: [] });
  assert.equal(resolveScheduleStatusFilter("invalid,Falta", mapping), "FALTA");
});

test("slot quantity excludes Sem cronograma in single and multiple selections", () => {
  assert.deepEqual(validScheduleSlotCountFilter(undefined), { not: "SEM_ESCALA" });
  assert.deepEqual(validScheduleSlotCountFilter("SEM_ESCALA"), { in: [] });
  assert.deepEqual(validScheduleSlotCountFilter(resolveScheduleStatusFilter("Sem cronograma,Falta,Falta Injustificada", mapping)), { in: ["FALTA", "FALTA_INJUSTIFICADA"] });
});
