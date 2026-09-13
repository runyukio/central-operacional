import assert from "node:assert/strict";
import test from "node:test";
import { calculateAbsenceRate } from "./attendance-calculation";
import { formatAbsencePercentage } from "./attendance-display";

test("ABS labels use two decimal places from the original counts", () => {
  for (const [scheduled, absences, expected] of [
    [526, 60, "11,41%"],
    [233, 12, "5,15%"],
    [39, 1, "2,56%"],
    [267, 3, "1,12%"],
    [74, 0, "0,00%"],
    [10, 1, "10,00%"],
    [10, 10, "100,00%"],
    [0, 0, "0,00%"]
  ] as const) {
    assert.equal(formatAbsencePercentage(scheduled, absences), expected);
  }
});

test("display precision does not change the existing rate calculation", () => {
  assert.equal(calculateAbsenceRate(526, 60), 11.4);
  assert.equal(formatAbsencePercentage(526, 60), "11,41%");
  assert.equal(calculateAbsenceRate(0, 0), 0);
});
