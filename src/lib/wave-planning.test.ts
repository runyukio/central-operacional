import assert from "node:assert/strict";
import { test } from "node:test";
import { addWaveDays, isWaveDate, waveDayOffset, wavePlanPermissions, wavePlanSchema, waveSegment } from "./wave-planning";

const wave = { name: "Wave 12", lobId: "ads", headcount: 15, trainingStartDate: "2026-10-26", nestingStartDate: "2026-11-09", goLiveDate: "2026-11-16", notes: "" };

test("waves require a positive integer headcount and real, strictly ordered dates", () => {
  assert.equal(wavePlanSchema.safeParse(wave).success, true);
  for (const headcount of [0, -1, 1.5, 10001]) assert.equal(wavePlanSchema.safeParse({ ...wave, headcount }).success, false);
  for (const dates of [
    { trainingStartDate: "2026-02-30" },
    { nestingStartDate: wave.trainingStartDate },
    { nestingStartDate: "2026-10-25" },
    { goLiveDate: wave.nestingStartDate },
    { goLiveDate: "2026-11-08" }
  ]) assert.equal(wavePlanSchema.safeParse({ ...wave, ...dates }).success, false);
  assert.equal(wavePlanSchema.safeParse({ ...wave, name: "  ", lobId: "" }).success, false);
});

test("calendar clips ongoing waves at month boundaries without overlapping stages", () => {
  assert.deepEqual(waveSegment("2026-10-26", "2026-11-09", "2026-11-01", 30), { left: "0%", width: `${8 / 30 * 100}%` });
  assert.deepEqual(waveSegment("2026-11-09", "2026-11-16", "2026-11-01", 30), { left: `${8 / 30 * 100}%`, width: `${7 / 30 * 100}%` });
  assert.deepEqual(waveSegment("2026-11-28", "2026-12-05", "2026-11-01", 30), { left: "90%", width: "10%" });
  assert.equal(waveSegment("2026-10-01", "2026-11-01", "2026-11-01", 30), null);
  assert.equal(waveSegment("2026-12-01", "2026-12-05", "2026-11-01", 30), null);
});

test("date-only calculations handle leap years, year changes and DST without shifting dates", () => {
  assert.equal(isWaveDate("2028-02-29"), true);
  assert.equal(isWaveDate("2026-02-29"), false);
  assert.equal(isWaveDate("2026-13-01"), false);
  assert.equal(isWaveDate("2026-1-01"), false);
  assert.equal(isWaveDate("1999-12-31"), false);
  assert.equal(addWaveDays("2028-02-28", 2), "2028-03-01");
  assert.equal(addWaveDays("2026-12-31", 1), "2027-01-01");
  assert.equal(waveDayOffset("2026-03-01", "2026-04-01"), 31);
});

test("management follows staffing permissions; inactive and unrelated roles cannot access waves", () => {
  for (const role of ["ADMIN", "WFM", "GESTOR"]) assert.deepEqual(wavePlanPermissions({ role, status: "ACTIVE" }), { canView: true, canManage: true });
  for (const role of ["SUPERVISOR", "GLOBAL"]) assert.deepEqual(wavePlanPermissions({ role, status: "ACTIVE" }), { canView: true, canManage: false });
  for (const role of ["CLIENT", "COLABORADOR", "RTA"]) assert.deepEqual(wavePlanPermissions({ role, status: "ACTIVE" }), { canView: false, canManage: false });
  assert.deepEqual(wavePlanPermissions({ role: "ADMIN", status: "INACTIVE" }), { canView: false, canManage: false });
});
