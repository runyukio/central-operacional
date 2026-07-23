import assert from "node:assert/strict";
import test from "node:test";

import { buildRealtimeHoursExportRows } from "./realtime-hours-export";
import type { RealtimeHoursTimelineFilterRow } from "./realtime-hours-timeline";

test("reaproveita no export os valores finais de atraso e hora extra da timeline", () => {
  const row: RealtimeHoursTimelineFilterRow = {
    data: "2026-07-23",
    slotId: "slot-23",
    hostname: "NOTE-01",
    hostnames: ["NOTE-01"],
    windowsUser: "lucasy",
    windowsUsers: ["lucasy"],
    wbLogin: "wb_lucasy",
    employeeId: "employee-1",
    employeeName: "Lucas Teste",
    roleTitle: "Agente",
    lob: "ADS",
    shift: "Manhã",
    supervisor: "Supervisora Teste",
    ipAddress: "10.0.0.1",
    currentStatus: "ONLINE",
    lastSeenAt: "2026-07-23T17:10:00.000Z",
    activeMs: 55 * 60_000,
    noActivityMs: 5 * 60_000,
    entryAt: "2026-07-23T11:15:00.000Z",
    exitAt: "2026-07-23T17:10:00.000Z",
    arrivalDelayMs: 20 * 60_000,
    earlyDepartureMs: 0,
    sessionCount: 2,
    plannedShifts: [{
      id: "slot-23",
      start: "2026-07-23T11:00:00.000Z",
      end: "2026-07-23T17:00:00.000Z",
      startsAt: "08:00",
      endsAt: "14:00",
      status: "ESCALADO",
      shift: "Manhã",
      sourceDate: "2026-07-23",
      overnight: false
    }],
    segments: [
      {
        type: "ACTIVE",
        start: "2026-07-23T11:15:00.000Z",
        end: "2026-07-23T12:00:00.000Z",
        durationMs: 45 * 60_000
      },
      {
        type: "ACTIVE",
        start: "2026-07-23T17:00:00.000Z",
        end: "2026-07-23T17:10:00.000Z",
        durationMs: 10 * 60_000
      }
    ]
  };

  const [exportRow] = buildRealtimeHoursExportRows([row], "2026-07-23T18:00:00.000Z");

  assert.equal(exportRow.rawDelayMs, 20 * 60_000);
  assert.equal(exportRow.delayMs, 15 * 60_000);
  assert.equal(exportRow.overtimeMs, 10 * 60_000);
  assert.equal(exportRow.durationMs, row.activeMs);
  assert.equal(exportRow.noActivityMs, row.noActivityMs);
});
