import assert from "node:assert/strict";
import test from "node:test";

import {
  compareRealtimeHoursPlannedShift,
  filterRealtimeHoursTimelineRows,
  realtimeHoursShiftDateActivity,
  type RealtimeHoursTimelineFilterRow
} from "./realtime-hours-timeline";

const date = "2026-07-17";

function row(overrides: Partial<RealtimeHoursTimelineFilterRow> = {}): RealtimeHoursTimelineFilterRow {
  return {
    hostname: "NOTE-01",
    hostnames: ["NOTE-01"],
    windowsUser: "agente",
    windowsUsers: ["agente"],
    wbLogin: "wb_agente",
    employeeId: "employee-1",
    employeeName: "Agente Teste",
    roleTitle: "Agente",
    lob: "ADS",
    shift: "Manhã",
    supervisor: "Supervisora Teste",
    ipAddress: "10.0.0.1",
    currentStatus: "ONLINE",
    lastSeenAt: "2026-07-17T11:00:00.000Z",
    activeMs: 60 * 60_000,
    noActivityMs: 0,
    sessionCount: 1,
    plannedShifts: [{
      start: "2026-07-17T11:00:00.000Z",
      end: "2026-07-17T17:00:00.000Z",
      startsAt: "08:00",
      endsAt: "14:00",
      status: "ESCALADO",
      shift: "Manhã",
      sourceDate: date,
      overnight: false
    }],
    segments: [{
      type: "ACTIVE",
      start: "2026-07-17T11:00:00.000Z",
      end: "2026-07-17T12:00:00.000Z",
      durationMs: 60 * 60_000
    }],
    ...overrides
  };
}

test("considera apenas os tres status solicitados como escalados, normalizando texto", () => {
  const rows = [
    row({ employeeId: "1", plannedShifts: [{ ...row().plannedShifts[0], status: " escalado " }] }),
    row({ employeeId: "2", plannedShifts: [{ ...row().plannedShifts[0], status: "Venda de folga aprovada" }] }),
    row({ employeeId: "3", plannedShifts: [{ ...row().plannedShifts[0], status: " troca APROVADA " }] }),
    row({ employeeId: "4", plannedShifts: [{ ...row().plannedShifts[0], status: "PRESENTE" }] })
  ];

  const filtered = filterRealtimeHoursTimelineRows(rows, { date, schedule: "SCHEDULED" });

  assert.deepEqual(filtered.map((item) => item.employeeId), ["1", "2", "3"]);
});

test("combina turno, escala, status online, LOB, supervisor e busca", () => {
  const rows = [
    row(),
    row({ employeeId: "2", employeeName: "Agente Tarde", shift: "Tarde", currentStatus: "OFFLINE" })
  ];

  const filtered = filterRealtimeHoursTimelineRows(rows, {
    date,
    search: "agente teste",
    lob: "ADS",
    presence: "ONLINE",
    supervisor: "Supervisora Teste",
    shift: "MANHA",
    schedule: "SCHEDULED"
  });

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].employeeId, "employee-1");
});

test("mantem o calculo de atraso usado na timeline", () => {
  const delayed = row({
    segments: [{
      type: "ACTIVE",
      start: "2026-07-17T11:15:00.000Z",
      end: "2026-07-17T12:00:00.000Z",
      durationMs: 45 * 60_000
    }]
  });

  const comparison = compareRealtimeHoursPlannedShift(delayed, date, "2026-07-17T16:00:00.000Z");

  assert.equal(comparison.arrivalDelayMs, 15 * 60_000);
  assert.equal(comparison.label, "15m de atraso");
});

test("recorta entrada, saida e duracao pelo shift date em jornada noturna", () => {
  const shiftDate = "2026-07-19";
  const overnight = row({
    plannedShifts: [{
      start: "2026-07-20T02:00:00.000Z",
      end: "2026-07-20T11:00:00.000Z",
      startsAt: "23:00",
      endsAt: "08:00",
      status: "ESCALADO",
      shift: "Noite",
      sourceDate: shiftDate,
      overnight: true
    }],
    segments: [
      {
        type: "ACTIVE",
        start: "2026-07-20T01:00:00.000Z",
        end: "2026-07-20T01:30:00.000Z",
        durationMs: 30 * 60_000
      },
      {
        type: "ACTIVE",
        start: "2026-07-20T02:15:00.000Z",
        end: "2026-07-20T03:00:00.000Z",
        durationMs: 45 * 60_000
      },
      {
        type: "ACTIVE",
        start: "2026-07-20T10:30:00.000Z",
        end: "2026-07-20T11:30:00.000Z",
        durationMs: 60 * 60_000
      }
    ]
  });

  const activity = realtimeHoursShiftDateActivity(overnight, shiftDate, "2026-07-20T12:00:00.000Z");

  assert.equal(activity.firstActiveAt, new Date("2026-07-20T02:15:00.000Z").getTime());
  assert.equal(activity.lastActiveAt, new Date("2026-07-20T11:00:00.000Z").getTime());
  assert.equal(activity.activeMs, 75 * 60_000);
  assert.equal(activity.noActivityMs, 7.75 * 60 * 60_000);
  assert.equal(activity.sessionCount, 2);
});
