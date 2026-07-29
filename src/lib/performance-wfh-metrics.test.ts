import assert from "node:assert/strict";
import test from "node:test";

import { calculateCecCpdMetrics, calculateTnsQualityWithKapFallback } from "./performance-service";

function kapRecord(day: string, key: string, finalResult: string) {
  return {
    auditDate: new Date(`${day}T00:00:00.000Z`),
    concatKey: key,
    finalResult,
    caseOrderId: key,
    auditCaseOrderId: "audit",
    employeeId: "employee-1"
  };
}

test("usa qualidade KAP de Video/Comments e mantém o legado apenas nos dias sem KAP", () => {
  const metrics = calculateTnsQualityWithKapFallback(
    [
      kapRecord("2026-07-01", "task-1", "correct"),
      kapRecord("2026-07-01", "task-2", "incorrect")
    ],
    [
      {
        auditDate: new Date("2026-07-01T00:00:00.000Z"),
        sampling: 100,
        mislabeled: 10,
        leakage: 0,
        falsePositive: 0,
        employeeId: "employee-1"
      },
      {
        auditDate: new Date("2026-06-30T00:00:00.000Z"),
        sampling: 50,
        mislabeled: 0,
        leakage: 0,
        falsePositive: 0,
        employeeId: "employee-1"
      }
    ]
  );

  assert.equal(metrics.qualityRule, "TNS_QUALITY");
  assert.equal(metrics.qualityNumerator, 51);
  assert.equal(metrics.qualityDenominator, 52);
  assert.equal(metrics.quality, 98.1);
});

test("continua usando a qualidade TNS legada quando não há dados KAP", () => {
  const metrics = calculateTnsQualityWithKapFallback([], [
    {
      auditDate: new Date("2026-07-01T00:00:00.000Z"),
      sampling: 100,
      mislabeled: 1,
      leakage: 1,
      falsePositive: 0,
      employeeId: "employee-1"
    }
  ]);

  assert.equal(metrics.qualityNumerator, 98);
  assert.equal(metrics.qualityDenominator, 100);
  assert.equal(metrics.quality, 98);
});

test("calcula o CPD de CEC com os tickets do upload na mesma produtividade", () => {
  const metrics = calculateCecCpdMetrics([
    { performanceDay: new Date("2026-07-01T00:00:00.000Z"), ticketCount: 20 },
    { performanceDay: new Date("2026-07-01T12:00:00.000Z"), ticketCount: 40 },
    { performanceDay: new Date("2026-07-02T00:00:00.000Z"), ticketCount: 60 },
    { performanceDay: new Date("2026-07-03T00:00:00.000Z"), ticketCount: 0 }
  ]);

  assert.deepEqual(metrics, {
    submitTotal: 120,
    submitDays: 2,
    submit: 60
  });
});
