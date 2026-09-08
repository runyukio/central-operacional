import assert from "node:assert/strict";
import test from "node:test";
import { summarizePartnerMonth } from "./meu-espaco-monthly-hours";
import { spaceHoursDefaultPeriod, spaceHoursMonthPeriod } from "./meu-espaco-hours";

const period = { startDate: "2026-09-01", endDate: "2026-09-30" };
const partner = { id: "agent", fullName: "Parceiro", wbLogin: "wb_agent", lob: { name: "ADS" } };
const schedule = (day: string, status = "ESCALADO") => ({ date: new Date(day), status, startsAt: "23:00", endsAt: "08:00", shift: { name: "Noite" } });
const record = (day: string, hours = 8) => ({ id: day, date: new Date(day), actualHours: hours, adjustedHours: null, effectiveHours: hours,
  differenceMinutes: 0, status: "RECORDED", schedule: schedule(day) });

test("monthly row sums all realized days plus future schedule; today is never projected twice", () => {
  const records = [record("2026-09-01", 7), { ...record("2026-09-07", 8), adjustedHours: 0.5, effectiveHours: 8.5 }, record("2026-09-08", 8)];
  const schedules = [schedule("2026-09-01"), schedule("2026-09-07"), schedule("2026-09-08"), schedule("2026-09-09"), schedule("2026-10-01")];
  const row = summarizePartnerMonth(partner, period, "2026-09-07", records, schedules, new Map([["2026-09-01", 7.25], ["2026-09-07", 8.25]]));
  assert.equal(row.month, "2026-09"); assert.equal(row.realizedRecords, 2);
  assert.equal(row.actualHours, 15); assert.equal(row.adjustedHours, 0.5);
  assert.equal(row.effectiveHours, 15.5); assert.equal(row.capturedHours, 15.5);
  assert.equal(row.plannedHours, 32); assert.equal(row.futureHours, 16); assert.equal(row.projectedHours, 31.5);
  assert.equal(row.differenceMinutes, -30); assert.equal(row.missingPastSlots, 0);
});
test("monthly projection preserves slot eligibility and flags missing past hours without inventing them", () => {
  const schedules = [schedule("2026-09-01"), schedule("2026-09-07"), schedule("2026-09-08"),
    schedule("2026-09-09", "FOLGA"), schedule("2026-09-10", "NESTING"), schedule("2026-09-11", "TREINAMENTO"), schedule("2026-09-12", "FALTA")];
  const row = summarizePartnerMonth(partner, period, "2026-09-07", [], schedules, new Map());
  assert.equal(row.realizedRecords, 0); assert.equal(row.plannedHours, 24);
  assert.equal(row.futureHours, 8); assert.equal(row.projectedHours, 8);
  assert.equal(row.missingPastSlots, 1); assert.equal(row.status, "1 dias sem horas");
});
test("past month has no future hours and actual zero differs from no record", () => {
  const empty = summarizePartnerMonth(partner, period, "2026-10-07", [], [], new Map());
  assert.equal(empty.projectedHours, null); assert.equal(empty.futureHours, 0);
  const zero = summarizePartnerMonth(partner, period, "2026-10-07", [record("2026-09-01", 0)], [schedule("2026-09-01")], new Map());
  assert.equal(zero.projectedHours, 0); assert.equal(zero.missingPastSlots, 0);
  assert.equal(zero.differenceMinutes, -480);
});
test("hours always normalize to one full calendar month including leap years", () => {
  assert.deepEqual(spaceHoursDefaultPeriod({ startDate: "2026-09-15", endDate: "2026-09-18" }, "2026-09-07"), period);
  assert.deepEqual(spaceHoursMonthPeriod("2024-02"), { startDate: "2024-02-01", endDate: "2024-02-29" });
  assert.equal(spaceHoursMonthPeriod("2026-02").endDate, "2026-02-28");
  assert.equal(spaceHoursMonthPeriod("2026-12").endDate, "2026-12-31");
  for (const month of ["2026-13", "0000-01", "2026-9", "bad"]) assert.throws(() => spaceHoursMonthPeriod(month));
});
