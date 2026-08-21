import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRealtimeHoursPlannedShifts,
  buildRealtimeHoursSlotAssignmentWindows,
  compareRealtimeHoursPlannedShift,
  filterRealtimeHoursTimelineRows,
  matchRealtimeHoursPlannedShift,
  realtimeHoursArchiveThroughDate,
  realtimeHoursOvertimeRanges,
  realtimeHoursRawDeleteBefore,
  realtimeHoursShiftDateActivity,
  saoPauloDateKey,
  type RealtimeHoursTimelineFilterRow
} from "./realtime-hours-timeline";

const date = "2026-07-17";

function row(overrides: Partial<RealtimeHoursTimelineFilterRow> = {}): RealtimeHoursTimelineFilterRow {
  return {
    data: date,
    slotId: "schedule-1",
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
    entryAt: "2026-07-17T11:00:00.000Z",
    exitAt: "2026-07-17T12:00:00.000Z",
    arrivalDelayMs: 0,
    earlyDepartureMs: 0,
    sessionCount: 1,
    plannedShifts: [{
      id: "schedule-1",
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

test("diferencia a LOB ALL do filtro que representa todas as LOBs", () => {
  const rows = [
    row({ employeeId: "ads", lob: "ADS" }),
    row({ employeeId: "all", lob: "ALL" })
  ];

  const allLobRows = filterRealtimeHoursTimelineRows(rows, {
    date,
    lob: "ALL"
  });
  const everyLobRows = filterRealtimeHoursTimelineRows(rows, {
    date,
    lob: "__ALL_LOBS__"
  });

  assert.deepEqual(allLobRows.map((item) => item.employeeId), ["all"]);
  assert.deepEqual(everyLobRows.map((item) => item.employeeId), ["ads", "all"]);
});

test("mantem o calculo de atraso usado na timeline", () => {
  const delayed = row({
    entryAt: "2026-07-17T11:15:00.000Z",
    arrivalDelayMs: 15 * 60_000,
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
      id: "schedule-night",
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

test("constroi slots diurnos e noturnos pela Data do Cronograma no fuso de Sao Paulo", () => {
  const shifts = buildRealtimeHoursPlannedShifts([
    schedule("manha", "2026-07-21", "08:00", "17:00"),
    schedule("tarde", "2026-07-22", "14:00", "23:00"),
    schedule("noite-21", "2026-07-23", "21:00", "06:00"),
    schedule("noite-23", "2026-07-24", "23:00", "08:00")
  ]);

  assert.deepEqual(
    shifts.map((shift) => ({
      id: shift.id,
      data: shift.sourceDate,
      start: shift.start,
      end: shift.end,
      overnight: shift.overnight
    })),
    [
      { id: "manha", data: "2026-07-21", start: "2026-07-21T11:00:00.000Z", end: "2026-07-21T20:00:00.000Z", overnight: false },
      { id: "tarde", data: "2026-07-22", start: "2026-07-22T17:00:00.000Z", end: "2026-07-23T02:00:00.000Z", overnight: false },
      { id: "noite-21", data: "2026-07-23", start: "2026-07-24T00:00:00.000Z", end: "2026-07-24T09:00:00.000Z", overnight: true },
      { id: "noite-23", data: "2026-07-24", start: "2026-07-25T02:00:00.000Z", end: "2026-07-25T11:00:00.000Z", overnight: true }
    ]
  );
});

test("separa slots noturnos consecutivos mesmo quando compartilham o mesmo dia civil", () => {
  const shifts = buildRealtimeHoursPlannedShifts([
    schedule("slot-20", "2026-07-20", "23:00", "08:00"),
    schedule("slot-21", "2026-07-21", "23:00", "08:00")
  ]);
  const windows = buildRealtimeHoursSlotAssignmentWindows(shifts);

  assert.equal(
    matchRealtimeHoursPlannedShift(new Date("2026-07-21T08:00:00.000Z"), windows)?.sourceDate,
    "2026-07-20"
  );
  assert.equal(
    matchRealtimeHoursPlannedShift(new Date("2026-07-22T02:30:00.000Z"), windows)?.sourceDate,
    "2026-07-21"
  );
});

test("mantem entrada atrasada depois da meia-noite vinculada a Data em que o slot comecou", () => {
  const shifts = buildRealtimeHoursPlannedShifts([
    schedule("slot-20", "2026-07-20", "23:00", "08:00")
  ]);
  const windows = buildRealtimeHoursSlotAssignmentWindows(shifts);

  assert.equal(
    matchRealtimeHoursPlannedShift(new Date("2026-07-21T03:30:00.000Z"), windows)?.sourceDate,
    "2026-07-20"
  );
});

test("nao inventa slot a partir do turno quando o Cronograma nao possui horario valido", () => {
  const shifts = buildRealtimeHoursPlannedShifts([{
    id: "sem-slot",
    employeeId: "employee-1",
    date: new Date("2026-07-21T00:00:00.000Z"),
    startsAt: null,
    endsAt: null,
    status: "ESCALADO",
    shift: null
  }]);

  assert.deepEqual(shifts, []);
  assert.equal(saoPauloDateKey(new Date("2026-07-22T02:30:00.000Z")), "2026-07-21");
});

test("filtro de Data nao inclui outro slot apenas por estar dentro da janela visual", () => {
  const filtered = filterRealtimeHoursTimelineRows([
    row({ data: "2026-07-20", slotId: "slot-20" }),
    row({ data: "2026-07-21", slotId: "slot-21" })
  ], { date: "2026-07-20" });

  assert.deepEqual(filtered.map((item) => item.slotId), ["slot-20"]);
});

test("arquiva apenas datas com a janela operacional completa", () => {
  assert.equal(
    realtimeHoursArchiveThroughDate(new Date("2026-08-21T15:00:00.000Z")),
    "2026-08-19"
  );
});

test("preserva no bruto a sobreposicao necessaria para turnos noturnos", () => {
  assert.equal(
    realtimeHoursRawDeleteBefore("2026-08-19").toISOString(),
    "2026-08-19T19:00:00.000Z"
  );
});

test("calcula hora extra com os mesmos blocos exibidos na timeline", () => {
  const overtime = realtimeHoursOvertimeRanges(row({
    segments: [
      {
        type: "ACTIVE",
        start: "2026-07-17T10:30:00.000Z",
        end: "2026-07-17T12:00:00.000Z",
        durationMs: 90 * 60_000
      },
      {
        type: "ACTIVE",
        start: "2026-07-17T17:00:00.000Z",
        end: "2026-07-17T17:10:00.000Z",
        durationMs: 10 * 60_000
      }
    ]
  }));

  assert.deepEqual(overtime, [
    {
      start: new Date("2026-07-17T10:30:00.000Z").getTime(),
      end: new Date("2026-07-17T11:00:00.000Z").getTime()
    },
    {
      start: new Date("2026-07-17T17:00:00.000Z").getTime(),
      end: new Date("2026-07-17T17:10:00.000Z").getTime()
    }
  ]);
});

function schedule(id: string, dateKey: string, startsAt: string, endsAt: string) {
  return {
    id,
    employeeId: "employee-1",
    date: new Date(`${dateKey}T00:00:00.000Z`),
    startsAt,
    endsAt,
    status: "ESCALADO",
    shift: {
      name: "Classificacao que nao interfere",
      startsAt: "09:30",
      endsAt: "18:30"
    }
  };
}
