import assert from "node:assert/strict";
import test from "node:test";
import { isCaptureImportEligible, type CaptureEligibilityProfile } from "./work-hours-capture-eligibility";
import { CAPTURE_DIVERGENCE_ACTIONS, evaluateCaptureImport, reuseCaptureResolution } from "./work-hours-capture-integration-core";
import { captureReviewDecisions, captureReviewOptions, EMPTY_CAPTURE_REVIEW_FILTERS, filterCaptureReviewRows, type CaptureReviewChoices } from "./work-hours-capture-review";

const active: CaptureEligibilityProfile = { roleTitle: "Agente", operationalStatus: "Ativo", goLiveDate: "2026-08-01", lob: { name: "ADS" } };
const shiftDate = "2026-09-03";
test("agente ativo em produção é elegível, inclusive aliases estruturados", () => {
  assert.equal(isCaptureImportEligible(active, shiftDate), true);
  assert.equal(isCaptureImportEligible({ ...active, operationalStatus: "ACTIVE", roleTitle: "Agent" }, shiftDate), true);
});
for (const [label, patch] of Object.entries({
  Staff: { roleTitle: "Staff" }, TI: { lob: { name: "TI" } }, IT: { skill: "IT" },
  "TI composto": { team: { name: "TI / Tecnologia da Informação" } }, "perfil Staff": { user: { role: { name: "STAFF" } } },
  Nesting: { operationalStatus: "Nesting" }, Treinamento: { operationalStatus: "Em treinamento" },
  Trainee: { roleTitle: "Trainee" }, Trainer: { skill: "Trainer" }, Onboarding: { skill: "Onboarding" },
  "Nesting secundário": { skillAssignments: [{ skill: { name: "Nesting" } }] },
  Inativo: { operationalStatus: "Inativo" }, Desligado: { operationalStatus: "Desligado" },
  "sem Go Live": { goLiveDate: null }, "Go Live futuro": { goLiveDate: "2026-09-04" },
  "Go Live inválido": { goLiveDate: "inválido" }, "pré-operacional": { team: { name: "Pré-operacional" } },
  "RA Staff": { skill: "RA", roleTitle: "Staff" }
})) test(`${label} é excluído antes das regras de horas`, () => {
  assert.equal(isCaptureImportEligible({ ...active, ...patch }, shiftDate), false);
});
test("Go Live no próprio Shift Date é elegível; nome não participa da decisão", () => {
  assert.equal(isCaptureImportEligible({ ...active, goLiveDate: shiftDate }, shiftDate), true);
  assert.equal(isCaptureImportEligible({ ...active, skill: "RA" }, shiftDate), true);
});
test("toda divergência oferece exatamente cinco opções", () => {
  for (const scheduleStatus of ["ESCALADO", "FOLGA", "FALTA", "NESTING", "VENDA_FOLGA_APROVADA", "TROCA_APROVADA"]) {
    for (const capturedMs of [null, 1, 120 * 60_000, 8 * 3_600_000]) {
      const result = evaluateCaptureImport({ scheduleExists: true, scheduleStatus, capturedMs });
      if (result.decision === "DIVERGENCE") assert.deepEqual(result.actions, CAPTURE_DIVERGENCE_ACTIONS);
    }
  }
});
const rows = [
  { id: "a", revision: "v1", lob: "ADS", supervisor: "Sup A", shift: "Noite" },
  { id: "b", revision: "v2", lob: "CEC", supervisor: "Sup B", shift: "Manhã" },
  { id: "c", revision: "v3", lob: "ADS", supervisor: "Sup B", shift: "Noite" }
];
test("slicers iniciam Todos e combinam LOB + supervisor + turno", () => {
  assert.deepEqual(filterCaptureReviewRows(rows, EMPTY_CAPTURE_REVIEW_FILTERS), rows);
  assert.deepEqual(filterCaptureReviewRows(rows, { lob: "ADS", supervisor: "Sup B", shift: "Noite" }).map((r) => r.id), ["c"]);
  assert.deepEqual(captureReviewOptions(rows, "lob"), ["ADS", "CEC"]);
});
test("decisões ocultas são preservadas e aplicadas; limpar filtros não apaga escolhas", () => {
  const choices: CaptureReviewChoices = { a: { action: "CONFIRM_PRESENCE", revision: "v1" }, b: { action: "KEEP_SCHEDULE", revision: "v2" } };
  const snapshot = structuredClone(choices);
  const visible = filterCaptureReviewRows(rows, { lob: "CEC", supervisor: "", shift: "" });
  assert.deepEqual(visible.map((r) => r.id), ["b"]);
  assert.deepEqual(captureReviewDecisions(rows, choices).map((r) => r.id), ["a", "b"]);
  filterCaptureReviewRows(rows, EMPTY_CAPTURE_REVIEW_FILTERS);
  assert.deepEqual(choices, snapshot);
});
test("Manter cronograma encerra; Pendente não reutiliza resolução; fonte alterada reabre", () => {
  const input = { scheduleId: null, scheduleStatus: "SEM_ESCALA", plannedStart: null, plannedEnd: null, capturedMs: 60_000, lob: "ADS", classification: "ADS" };
  const resolved = { ...input, status: "RESOLVED", sourceDurationMs: input.capturedMs, resolutionAction: "KEEP_SCHEDULE" };
  assert.equal(reuseCaptureResolution(input, resolved)?.decision, "IGNORE");
  assert.equal(reuseCaptureResolution(input, { ...resolved, status: "PENDING" }), null);
  for (const patch of [{ capturedMs: 120_000 }, { scheduleStatus: "PRESENTE" }, { lob: "CEC" }, { classification: "RA" }, { plannedEnd: "08:00" }]) {
    assert.equal(reuseCaptureResolution({ ...input, ...patch }, resolved), null);
  }
});
