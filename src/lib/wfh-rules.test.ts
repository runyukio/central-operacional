import assert from "node:assert/strict";
import test from "node:test";

import { calculateWfhStatus, type WfhMetrics } from "./wfh-rules";

const referenceDate = new Date("2026-07-27T00:00:00.000Z");

function metrics(overrides: Partial<WfhMetrics> = {}): WfhMetrics {
  return {
    quality: 100,
    qualityDenominator: 100,
    submit: 350,
    ahtSeconds: 60,
    abs: 5,
    scheduledDays: 20,
    unjustifiedAbsences: 0,
    ...overrides
  };
}

function status(lob: string, values: WfhMetrics) {
  return calculateWfhStatus({ lob }, values, [], referenceDate).wfhStatus;
}

test("mantém qualidade mínima de 95% para ADS e Project", () => {
  assert.equal(status("ADS", metrics({ quality: 95 })), "QUALIFIED");
  assert.equal(status("Project", metrics({ quality: 95 })), "QUALIFIED");
  assert.equal(status("ADS", metrics({ quality: 94.99 })), "NOT_QUALIFIED");
});

test("exige qualidade mínima de 98% para TNS, Video e Comments", () => {
  for (const lob of ["TNS", "Video", "Comments"]) {
    assert.equal(status(lob, metrics({ quality: 98 })), "QUALIFIED", lob);
    assert.equal(status(lob, metrics({ quality: 97.99 })), "NOT_QUALIFIED", lob);
  }
});

test("exige 95% de qualidade e 60 CPD para CEC", () => {
  assert.equal(status("CEC", metrics({ quality: 95, submit: 60 })), "QUALIFIED");
  assert.equal(status("CEC", metrics({ quality: 94.99, submit: 60 })), "NOT_QUALIFIED");
  assert.equal(status("CEC", metrics({ quality: 95, submit: 59.99 })), "NOT_QUALIFIED");
});
