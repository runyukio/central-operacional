import assert from "node:assert/strict";
import test from "node:test";
import { calculateOperationalHours } from "./work-hours-capture-integration-core";
import { captureOvertimeOutcome, canReviewOvertime, type OvertimeSource } from "./work-hours-overtime";

function source(capturedMs: number, lob = "ADS", skill?: string): OvertimeSource {
  const calculated = calculateOperationalHours(capturedMs, { lob, legacySkill: skill });
  return { reconciliationKey: "agent:2026-10-01:night", scheduleId: "night", plannedStart: "23:00", plannedEnd: "08:00",
    sourceDurationMs: capturedMs, operationalMs: calculated.operationalMs, rule: calculated.rule,
    ruleLabel: calculated.ruleLabel, classification: calculated.classificationLabel };
}

test("valida o excedente estritamente depois das regras, sem tolerância ou perda de milissegundos", () => {
  for (const [capturedMs, effectiveHours, validationHours] of [[7 * 3_600_000, 7.5, 0], [7.5 * 3_600_000, 8, 0], [8 * 3_600_000, 8, 0.5]]) {
    const result = captureOvertimeOutcome(source(capturedMs));
    assert.equal(result.effectiveHours, effectiveHours); assert.equal(result.validationHours, validationHours);
  }
  assert.equal(captureOvertimeOutcome(source(7.5 * 3_600_000 + 1)).status, "PENDING");
  for (const skill of ["RA", "Onboarding", "Bilíngue"]) assert.equal(captureOvertimeOutcome(source(10 * 3_600_000, "ADS", skill)).validationHours, 0);
  for (const lob of ["CEC", "COMMENTS"]) assert.equal(captureOvertimeOutcome(source(9 * 3_600_000, lob)).validationHours, 1);
});

test("decisão só é reutilizada na mesma origem e nunca após cancelamento", () => {
  const input = source(8.5 * 3_600_000), pending = captureOvertimeOutcome(input);
  assert.equal(pending.calculatedHours, 9); assert.equal(pending.effectiveHours, 8);
  assert.equal(captureOvertimeOutcome(input, { ...pending, status: "APPROVED" }).effectiveHours, 9);
  assert.equal(captureOvertimeOutcome(input, { ...pending, status: "REJECTED" }).status, "REJECTED");
  assert.equal(captureOvertimeOutcome(input, { ...pending, status: "CANCELLED" }).status, "PENDING");
  for (const patch of [{ sourceDurationMs: input.sourceDurationMs + 1 }, { plannedStart: "22:00" }, { classification: "VIDEO" }, { rule: "NEW_RULE" }]) {
    assert.equal(captureOvertimeOutcome({ ...input, ...patch }, { ...pending, status: "APPROVED" }).status, "PENDING");
  }
});

test("somente supervisor atribuído, WFM e Admin podem decidir", () => {
  assert.equal(canReviewOvertime("SUPERVISOR", "mine", "mine"), true);
  assert.equal(canReviewOvertime("SUPERVISOR", "mine", "other"), false);
  assert.equal(canReviewOvertime("SUPERVISOR", null, null), false);
  for (const role of ["GESTOR", "COORDENADOR", "COLABORADOR", "GLOBAL"]) assert.equal(canReviewOvertime(role, "mine", "mine"), false);
  for (const role of ["ADMIN", "WFM"]) assert.equal(canReviewOvertime(role, null, null), true);
});
