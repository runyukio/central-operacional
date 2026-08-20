import assert from "node:assert/strict";
import test from "node:test";

import { buildRealtimePresenceFallbackRows, type RealtimeOperationalPresenceCandidate } from "./realtime-presence-fallback";

const now = Date.parse("2026-08-15T13:27:00-03:00");

function candidate(overrides: Partial<RealtimeOperationalPresenceCandidate> = {}): RealtimeOperationalPresenceCandidate {
  return {
    employeeId: "employee-nicolle",
    employeeName: "Nicolle Helena Bernardes",
    wbLogin: "wb_nicolle03",
    roleTitle: "Agente",
    skill: "Material Queues",
    lob: "ADS",
    shift: "Manhã",
    supervisor: "Supervisão ADS",
    employeeStatus: "Ativo",
    status: "ONLINE",
    ...overrides
  };
}

test("complementa o ciclo atual com parceiro ativo presente na Captura de Horas", () => {
  const rows = buildRealtimePresenceFallbackRows({
    existingRows: [],
    candidates: [candidate()],
    selectedCycle: "2026-08-15 13:00",
    now
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.wbLogin, "wb_nicolle03");
  assert.equal(rows[0]?.presenceStatus, "Online");
  assert.equal(rows[0]?.current.submit, 0);
  assert.equal(rows[0]?.current.sourceRows, 0);
});

test("não duplica quem já veio no KAP e não inclui sessão offline", () => {
  const duplicate = buildRealtimePresenceFallbackRows({
    existingRows: [{ employeeId: "employee-nicolle", wbLogin: "wb_nicolle03", rawWbLogin: "wb_nicolle03" }],
    candidates: [candidate()],
    selectedCycle: "2026-08-15 13:00",
    now
  });
  const offline = buildRealtimePresenceFallbackRows({
    existingRows: [],
    candidates: [candidate({ status: "OFFLINE" })],
    selectedCycle: "2026-08-15 13:00",
    now
  });

  assert.deepEqual(duplicate, []);
  assert.deepEqual(offline, []);
});

test("não mistura presença atual em ciclo histórico", () => {
  const rows = buildRealtimePresenceFallbackRows({
    existingRows: [],
    candidates: [candidate()],
    selectedCycle: "2026-08-15 11:30",
    now
  });

  assert.deepEqual(rows, []);
});

test("mantém staff presente visível sem classificá-lo como agente", () => {
  const rows = buildRealtimePresenceFallbackRows({
    existingRows: [],
    candidates: [candidate({ employeeId: "employee-supervisor", wbLogin: "wb_supervisor", employeeName: "Supervisora", roleTitle: "Supervisor", status: "LOCKED" })],
    selectedCycle: "2026-08-15 13:00",
    now
  });

  assert.equal(rows[0]?.personType, "Staff");
  assert.equal(rows[0]?.presenceStatus, "Tela bloqueada");
});
