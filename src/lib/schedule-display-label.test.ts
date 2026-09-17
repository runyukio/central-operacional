import assert from "node:assert/strict";
import test from "node:test";
import { scheduleDisplayLabel, scheduleImportStatusValue } from "./schedule-display-label";
import { normalizeAbsenceReasonForInput, getAbsenceReasonClassification } from "./absence-reasons";
import { parseScheduleSlotFilter, toggleScheduleSlotFilter } from "./schedule-slot-filter";

test("legacy schedule labels use cronograma without modifying filter values", () => {
  const selection = toggleScheduleSlotFilter("Falta", "Escalado");
  const values = parseScheduleSlotFilter(selection);
  assert.deepEqual(values, ["Falta", "Escalado"]);
  assert.deepEqual(values.map(scheduleDisplayLabel), ["Falta", "No cronograma"]);
  assert.equal(toggleScheduleSlotFilter(selection, "Escalado"), "Falta");
});

test("absence reason presentation preserves persisted values and classification", () => {
  const reason = "Erro de programação de escala";
  assert.equal(scheduleDisplayLabel(reason), "Erro de programação de cronograma");
  assert.equal(normalizeAbsenceReasonForInput(reason), reason);
  assert.equal(getAbsenceReasonClassification(reason), "JUSTIFIED");
  assert.equal(scheduleDisplayLabel("Erro de visualização de escala"), "Erro de visualização de cronograma");
  assert.equal(getAbsenceReasonClassification("Erro de visualização de escala"), "UNJUSTIFIED");
});

test("all legacy display labels and unrelated labels are handled explicitly", () => {
  assert.equal(scheduleDisplayLabel("Sem escala"), "Sem cronograma");
  assert.equal(scheduleDisplayLabel("Não escalado"), "Sem cronograma");
  assert.equal(scheduleDisplayLabel("Erro de escala"), "Erro de cronograma");
  for (const value of ["Presente", "Falta", "Nesting", "No cronograma", "Escala 1 a 5", "ESCALADO", "/escalas", "constructor", "__proto__", ""]) {
    assert.equal(scheduleDisplayLabel(value), value);
  }
});

test("new and legacy template labels resolve to the same canonical status", () => {
  for (const value of ["No cronograma", " NO CRONOGRAMA ", "Escalado"]) {
    assert.equal(scheduleImportStatusValue(value), "Escalado");
  }
  for (const value of ["ESCALADO", "Nesting", "Falta", "Presente", "Sem cronograma", "Desconhecido"]) {
    assert.equal(scheduleImportStatusValue(value), value);
  }
});
