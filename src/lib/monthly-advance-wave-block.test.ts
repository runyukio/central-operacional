import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { prisma } from "./prisma";
import type { Actor } from "./mock-db";
import {
  applyApprovedMonthlyAdvanceChange,
  commitMonthlyAdvanceImport,
  createMonthlyAdvanceChangeRequest,
  getMyMonthlyAdvanceCycles,
  isMonthlyAdvanceWaveBlocked,
  listMonthlyAdvances,
  MONTHLY_ADVANCE_WAVE_BLOCK_MESSAGE,
  previewMonthlyAdvanceImport,
  respondMonthlyAdvance,
  upsertMonthlyAdvance
} from "./monthly-advance-service";

const actor: Actor = { email: "wave-test@example.com", role: "ADMIN", name: "Test" };

function mockEmployee(t: TestContext, lob: string, wave: string) {
  const employee = {
    id: "wave-test", wbLogin: "wave-test", fullName: "Test",
    contractType: "PJ", operationalStatus: "Ativo", deletedAt: null,
    wave, lob: { id: lob, name: lob }
  };
  const failWrite = async () => { throw new Error("Blocked wave must not write an advance"); };
  const delegates = {
    user: { findFirst: async () => ({ id: "user-test", email: actor.email, employeeProfile: employee }) },
    employeeProfile: { findFirst: async () => employee, findMany: async () => [employee], findUnique: async () => employee },
    monthlyAdvanceRecord: { findMany: async () => [], count: async () => 0, groupBy: async () => [], create: failWrite, update: failWrite, upsert: failWrite }
  };
  const client = prisma as unknown as Record<string, unknown>;
  for (const [model, delegate] of Object.entries(delegates)) {
    const original = client[model];
    client[model] = delegate;
    t.after(() => { client[model] = original; });
  }
  return employee;
}

test("limita a regra às duas combinações de LOB/wave e a outubro/2026", () => {
  for (const [lob, wave] of [["ADS", "Wave 40"], ["VIDEO", "Wave 13"], ["ads", "40"], ["video", "13"]]) {
    const employee = { lob: { name: lob }, wave };
    assert.equal(isMonthlyAdvanceWaveBlocked(employee, "2026-10"), true);
    assert.equal(isMonthlyAdvanceWaveBlocked(employee, "2026-09"), false);
    assert.equal(isMonthlyAdvanceWaveBlocked(employee, "2026-11"), false);
  }
  for (const [lob, wave] of [["ADS", "Wave 13"], ["VIDEO", "Wave 40"], ["ADS", "Wave 39"], ["VIDEO", "Wave 12"], ["CEC", "Wave 40"]]) {
    assert.equal(isMonthlyAdvanceWaveBlocked({ lob: { name: lob }, wave }, "2026-10"), false);
  }
  assert.equal(isMonthlyAdvanceWaveBlocked({}, "2026-10"), false);
});

for (const [lob, wave] of [["ADS", "Wave 40"], ["VIDEO", "Wave 13"]]) {
  test(`${lob} ${wave}: outubro permanece fechado após sair do treinamento`, async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-06T15:00:00Z") });
    const employee = mockEmployee(t, lob, wave);
    t.mock.method(prisma.monthlyAdvanceRecord, "findMany", async () => [{
      id: "advance-test", employeeId: employee.id, employee,
      referenceMonth: "2026-10", optIn: true, status: "RESPONDIDO",
      observation: null, updatedBy: null, createdAt: new Date(), updatedAt: new Date()
    }]);
    const result = await getMyMonthlyAdvanceCycles(actor);
    assert.ok("data" in result && result.data);
    assert.equal(result.data.length, 1);
    assert.equal(result.data[0].referenceMonth, "2026-10");
    assert.equal(result.data[0].locked, true);
    assert.equal(result.data[0].answered, true);
    assert.equal(result.data[0].canRespond, false);
    assert.equal(result.data[0].canRequestChange, false);
    assert.equal(result.data[0].closedMessage, MONTHLY_ADVANCE_WAVE_BLOCK_MESSAGE);
  });

  test(`${lob} ${wave}: rejeita resposta, gestão, importação e solicitação de outubro`, async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-06T15:00:00Z") });
    mockEmployee(t, lob, wave);
    for (const optIn of [true, false]) {
      const response = await respondMonthlyAdvance(actor, { referenceMonth: "2026-10", optIn });
      assert.equal("error" in response && response.error, MONTHLY_ADVANCE_WAVE_BLOCK_MESSAGE);
      const managed = await upsertMonthlyAdvance(actor, { employeeId: "wave-test", referenceMonth: "10/2026", optIn });
      assert.equal("error" in managed && managed.error, MONTHLY_ADVANCE_WAVE_BLOCK_MESSAGE);
    }
    const change = await createMonthlyAdvanceChangeRequest(actor, { referenceMonth: "2026-10", requestedOptIn: true, reason: "Test" });
    assert.equal("error" in change && change.error, MONTHLY_ADVANCE_WAVE_BLOCK_MESSAGE);
    const rows = [{ wb_login: "wave-test", mes_referencia: "10/2026", aderente: "Sim" }];
    const preview = await previewMonthlyAdvanceImport(actor, rows);
    assert.ok("rows" in preview);
    assert.deepEqual(preview.rows[0].errors, [MONTHLY_ADVANCE_WAVE_BLOCK_MESSAGE]);
    const imported = await commitMonthlyAdvanceImport(actor, rows);
    assert.equal("error" in imported && imported.error, "Nenhuma linha válida para importar.");
  });

  test(`${lob} ${wave}: aprovação pendente não habilita outubro`, async (t) => {
    const employee = mockEmployee(t, lob, wave);
    t.mock.method(prisma.employeeProfile, "findUnique", async () => employee);
    const result = await applyApprovedMonthlyAdvanceChange(prisma, {
      id: "request-test", employeeId: employee.id,
      payload: { monthlyAdvanceChange: true, referenceMonth: "2026-10", requestedOptIn: true }
    }, "user-test");
    assert.deepEqual(result, { updated: false, message: MONTHLY_ADVANCE_WAVE_BLOCK_MESSAGE });
  });
}

test("outras waves continuam com outubro aberto e novembro encerrado", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-06T15:00:00Z") });
  mockEmployee(t, "ADS", "Wave 39");
  const cycles = await getMyMonthlyAdvanceCycles(actor);
  assert.ok("data" in cycles && cycles.data);
  assert.equal(cycles.data.length, 1);
  assert.equal(cycles.data[0].canRespond, true);
  const november = await respondMonthlyAdvance(actor, { referenceMonth: "2026-11", optIn: true });
  assert.equal("status" in november && november.status, 403);
});

test("listagem e exportação excluem as waves somente na referência de outubro", async (t) => {
  mockEmployee(t, "ADS", "Wave 39");
  const count = t.mock.method(prisma.monthlyAdvanceRecord, "count", async () => 0);
  t.mock.method(prisma.monthlyAdvanceRecord, "groupBy", async () => []);
  await listMonthlyAdvances(actor, { referenceMonth: "2026-10" });
  const octoberWhere = JSON.stringify(count.mock.calls[0].arguments[0]);
  assert.ok(octoberWhere.includes("Wave 40"));
  assert.ok(octoberWhere.includes("Wave 13"));
  await listMonthlyAdvances(actor, { referenceMonth: "2026-09" });
  const septemberWhere = JSON.stringify(count.mock.calls[1].arguments[0]);
  assert.equal(septemberWhere.includes("Wave 40"), false);
  assert.equal(septemberWhere.includes("Wave 13"), false);
});
