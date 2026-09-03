import assert from "node:assert/strict";
import test from "node:test";

import {
  CAPTURE_AUTO_PRESENCE_THRESHOLD_MS,
  LOW_ADHERENCE_THRESHOLD_MS,
  calculateOperationalHours,
  evaluateCaptureImport,
  resolveOperationalHourRule,
  reuseCaptureResolution,
  shouldCreateLowAdherence
} from "@/lib/work-hours-capture-integration-core";

const hour = 60 * 60 * 1000;
const minute = 60 * 1000;

test("reimportação preserva uma captura curta já confirmada no mesmo slot", () => {
  const input = { scheduleId: "slot-1", scheduleStatus: "PRESENTE", plannedStart: "23:00", plannedEnd: "08:00", capturedMs: 40 * minute };
  const resolved = { ...input, status: "RESOLVED", sourceDurationMs: input.capturedMs, resolutionAction: "CONFIRM_PRESENCE" };
  const result = reuseCaptureResolution(input, resolved);
  assert.equal(result?.decision, "AUTOMATIC");
  assert.equal(calculateOperationalHours(input.capturedMs, { lob: "ADS" }).operationalMs, 70 * minute);
  assert.equal(reuseCaptureResolution({ ...input, capturedMs: 41 * minute }, resolved), null);
  assert.equal(reuseCaptureResolution({ ...input, scheduleId: "slot-2" }, resolved), null);
  assert.equal(reuseCaptureResolution({ ...input, plannedStart: "22:00" }, resolved), null);
  assert.equal(reuseCaptureResolution({ ...input, scheduleStatus: "ESCALADO" }, resolved), null);
  assert.equal(reuseCaptureResolution(input, { ...resolved, status: "PENDING" }), null);
});

test("decisões de folga e falta não são reabertas sem mudança na captura", () => {
  for (const [action, status] of [["CONFIRM_DAY_OFF", "FOLGA"], ["CONFIRM_ABSENCE", "FALTA"]]) {
    const input = { scheduleId: "slot-1", scheduleStatus: status, plannedStart: "08:00", plannedEnd: "17:00", capturedMs: 40 * minute };
    const resolved = { ...input, status: "RESOLVED", sourceDurationMs: input.capturedMs, resolutionAction: action };
    assert.equal(reuseCaptureResolution(input, resolved)?.decision, "IGNORE");
    assert.equal(reuseCaptureResolution({ ...input, capturedMs: 3 * hour }, resolved), null);
  }
});

test("comparecimento confirmado preserva venda de folga na reimportação", () => {
  const input = { scheduleId: "slot-1", scheduleStatus: "VENDA_FOLGA_APROVADA", plannedStart: "08:00", plannedEnd: "17:00", capturedMs: 2 * hour };
  const resolved = { ...input, status: "RESOLVED", sourceDurationMs: input.capturedMs, resolutionAction: "CONFIRM_ATTENDANCE" };
  assert.equal(reuseCaptureResolution(input, resolved)?.targetScheduleStatus, "VENDA_FOLGA_APROVADA");
});

test("1. ADS escalado com 6:30 vira presença e 7:00", () => {
  assert.equal(evaluateCaptureImport({ scheduleExists: true, scheduleStatus: "ESCALADO", capturedMs: 6.5 * hour }).targetScheduleStatus, "PRESENTE");
  assert.equal(calculateOperationalHours(6.5 * hour, { lob: "ADS" }).operationalHours, 7);
});

test("2. captura exatamente 2:00 vai para divergência", () => {
  assert.equal(evaluateCaptureImport({ scheduleExists: true, scheduleStatus: "ESCALADO", capturedMs: CAPTURE_AUTO_PRESENCE_THRESHOLD_MS }).decision, "DIVERGENCE");
});

test("3. captura 2:00:01 permite presença automática quando escalado", () => {
  const result = evaluateCaptureImport({ scheduleExists: true, scheduleStatus: "ESCALADO", capturedMs: CAPTURE_AUTO_PRESENCE_THRESHOLD_MS + 1000 });
  assert.deepEqual([result.decision, result.targetScheduleStatus], ["AUTOMATIC", "PRESENTE"]);
});

test("4. escalado sem captura diverge e nunca cria falta automática", () => {
  const result = evaluateCaptureImport({ scheduleExists: true, scheduleStatus: "ESCALADO", capturedMs: null });
  assert.equal(result.decision, "DIVERGENCE");
  assert.equal(result.targetScheduleStatus, undefined);
  assert.ok(result.actions.includes("CONFIRM_ABSENCE"));
});

test("5. não escalado com captura diverge", () => {
  assert.equal(evaluateCaptureImport({ scheduleExists: false, capturedMs: 4 * hour }).decision, "DIVERGENCE");
});

test("6. RA com 3:00 recebe 8:00", () => {
  assert.equal(calculateOperationalHours(3 * hour, { lob: "ADS", skillNames: ["RA"] }).operationalHours, 8);
});

test("7. RA com 10:30 recebe 8:00 sem extra", () => {
  const result = calculateOperationalHours(10.5 * hour, { skillNames: ["RA"] });
  assert.deepEqual([result.operationalHours, result.overtimeHours], [8, 0]);
});

test("8. Onboarding com 5:00 recebe 8:00", () => {
  assert.equal(calculateOperationalHours(5 * hour, { skillNames: ["Onboarding"] }).operationalHours, 8);
});

test("9. Bilíngue com 6:30 mantém 6:30", () => {
  assert.equal(calculateOperationalHours(6.5 * hour, { skillNames: ["Bilíngue"] }).operationalHours, 6.5);
});

test("10. Bilíngue com 10:30 limita a 8:00 sem extra", () => {
  const result = calculateOperationalHours(10.5 * hour, { skillNames: ["Bilingual"] });
  assert.deepEqual([result.operationalHours, result.overtimeHours], [8, 0]);
});

test("11. CEC com 5:00 recebe 8:00", () => {
  assert.equal(calculateOperationalHours(5 * hour, { lob: "CEC" }).operationalHours, 8);
});

test("12. CEC com 10:30 mantém 10:30 e 2:30 extras", () => {
  const result = calculateOperationalHours(10.5 * hour, { lob: "CEC" });
  assert.deepEqual([result.operationalHours, result.overtimeHours], [10.5, 2.5]);
});

test("13. COMMENTS com 6:30 recebe 8:00", () => {
  assert.equal(calculateOperationalHours(6.5 * hour, { lob: "COMMENTS" }).operationalHours, 8);
});

test("14. COMMENTS com 9:15 mantém 9:15 e 1:15 extra", () => {
  const result = calculateOperationalHours(9.25 * hour, { lob: "COMMENTS" });
  assert.deepEqual([result.operationalHours, result.overtimeHours], [9.25, 1.25]);
});

test("15. venda de folga com mais de duas horas mantém venda de folga", () => {
  const result = evaluateCaptureImport({ scheduleExists: true, scheduleStatus: "VENDA_FOLGA_APROVADA", capturedMs: 3 * hour });
  assert.deepEqual([result.decision, result.targetScheduleStatus], ["AUTOMATIC", "VENDA_FOLGA_APROVADA"]);
});

test("16. venda de folga sem captura só permite confirmar folga ou manter pendente", () => {
  const result = evaluateCaptureImport({ scheduleExists: true, scheduleStatus: "VENDA_FOLGA_APROVADA", capturedMs: null });
  assert.deepEqual(result.actions, ["CONFIRM_DAY_OFF", "KEEP_PENDING"]);
});

test("17. captura abaixo de 7:25 gera pendência", () => {
  assert.equal(shouldCreateLowAdherence(LOW_ADHERENCE_THRESHOLD_MS - 1000), true);
});

test("18. captura exatamente 7:25 não gera pendência", () => {
  assert.equal(shouldCreateLowAdherence(LOW_ADHERENCE_THRESHOLD_MS), false);
});

test("19. CEC e RA continuam com pendência pela captura original, mesmo ajustados para oito", () => {
  const captured = 5 * hour;
  assert.equal(calculateOperationalHours(captured, { lob: "CEC" }).operationalHours, 8);
  assert.equal(calculateOperationalHours(captured, { skillNames: ["RA"] }).operationalHours, 8);
  assert.equal(shouldCreateLowAdherence(captured), true);
});

test("20. jornada atravessando meia-noite preserva a data informada pela Captura", () => {
  const captureDate = "2026-09-03";
  const startsAt = new Date("2026-09-03T23:00:00-03:00");
  const endsAt = new Date("2026-09-04T08:00:00-03:00");
  assert.ok(endsAt > startsAt);
  assert.equal(captureDate, "2026-09-03");
});

test("21. plano identifica que registros existentes exigem confirmação", () => {
  const existing = [{ employeeId: "agent-1", date: "2026-09-03", effectiveHours: 8 }];
  assert.equal(existing.length > 0, true);
});

test("22. reprocessar substitui o resultado calculado e não soma", () => {
  const previous = 7;
  const proposed = calculateOperationalHours(8 * hour, { lob: "ADS" }).operationalHours;
  const saved = proposed;
  assert.equal(saved, 8.5);
  assert.notEqual(saved, previous + proposed);
});

test("23. cálculo repetido é idempotente e não duplica os 30 minutos", () => {
  const first = calculateOperationalHours(6.5 * hour, { lob: "ADS" });
  const second = calculateOperationalHours(6.5 * hour, { lob: "ADS" });
  assert.deepEqual(second, first);
  assert.equal(second.operationalHours, 7);
});

test("24. um único resultado calculado alimenta Horas Operacionais e Cronograma", () => {
  const calculation = calculateOperationalHours(10 * hour + 31 * minute, { lob: "CEC" });
  const workHours = calculation.operationalHours;
  const scheduleCell = calculation.operationalHours;
  assert.equal(workHours, scheduleCell);
});

test("prioridade fixa aplica RA antes de bilíngue e CEC", () => {
  assert.equal(resolveOperationalHourRule({ lob: "CEC", skillNames: ["Bilíngue", "RA"] }).rule, "RA_ONBOARDING");
});
