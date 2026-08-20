import assert from "node:assert/strict";
import test from "node:test";

import { isSupervisorAhtQueue, mergeSupervisorQualityDailyRows } from "./performance-service";

test("usa no AHT de supervisores TNS somente filas com meta de 15 minutos", () => {
  assert.equal(isSupervisorAhtQueue({ lob: "VIDEO", slaTargetMinutes: 15 }), true);
  assert.equal(isSupervisorAhtQueue({ lob: "COMMENTS", slaTargetMinutes: 15 }), true);
  assert.equal(isSupervisorAhtQueue({ lob: "VIDEO", slaTargetMinutes: 1_440 }), false);
  assert.equal(isSupervisorAhtQueue({ lob: "COMMENTS", slaTargetMinutes: 10_080 }), false);
  assert.equal(isSupervisorAhtQueue({ lob: "ADS", slaTargetMinutes: 1_440 }), true);
});

test("prioriza a qualidade KAP sobre a base TNS legada para o mesmo parceiro e dia", () => {
  const rows = mergeSupervisorQualityDailyRows(
    [
      {
        supervisorId: "supervisor-1",
        employeeId: "employee-1",
        qualityDay: new Date("2026-07-01T00:00:00.000Z"),
        correct: 98,
        total: 100
      }
    ],
    [
      {
        supervisorId: "supervisor-1",
        employeeId: "employee-1",
        qualityDay: "2026-07-01",
        correct: 900,
        total: 1000
      }
    ]
  );

  assert.deepEqual(rows, [
    {
      supervisorId: "supervisor-1",
      correct: 98,
      total: 100
    }
  ]);
});

test("mantém dados legados quando não existe KAP para o parceiro no dia", () => {
  const rows = mergeSupervisorQualityDailyRows(
    [
      {
        supervisorId: "supervisor-1",
        employeeId: "employee-1",
        qualityDay: "2026-07-01",
        correct: 98,
        total: 100
      }
    ],
    [
      {
        supervisorId: "supervisor-1",
        employeeId: "employee-1",
        qualityDay: "2026-06-30",
        correct: 49,
        total: 50
      },
      {
        supervisorId: "supervisor-1",
        employeeId: "employee-2",
        qualityDay: "2026-07-01",
        correct: 45,
        total: 50
      }
    ]
  );

  assert.deepEqual(rows, [
    {
      supervisorId: "supervisor-1",
      correct: 192,
      total: 200
    }
  ]);
});

test("agrega os resultados separadamente por supervisor", () => {
  const rows = mergeSupervisorQualityDailyRows(
    [
      {
        supervisorId: "supervisor-2",
        employeeId: "employee-2",
        qualityDay: "2026-07-01",
        correct: 45,
        total: 50
      },
      {
        supervisorId: "supervisor-1",
        employeeId: "employee-1",
        qualityDay: "2026-07-01",
        correct: 98,
        total: 100
      }
    ],
    []
  );

  assert.deepEqual(rows, [
    {
      supervisorId: "supervisor-1",
      correct: 98,
      total: 100
    },
    {
      supervisorId: "supervisor-2",
      correct: 45,
      total: 50
    }
  ]);
});
