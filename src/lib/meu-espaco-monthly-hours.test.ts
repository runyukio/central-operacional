import assert from "node:assert/strict";
import test from "node:test";
import { summarizePartnerMonth } from "./meu-espaco-monthly-hours";
import { spaceHoursClock, spaceHoursDefaultPeriod, spaceHoursMonthPeriod, spaceShiftInProgress, summarizeSpaceHours } from "./meu-espaco-hours";

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

const daytime = (day: string, status = "ESCALADO") => ({ ...schedule(day, status), startsAt: "08:00", endsAt: "17:00" });
test("an ongoing shift projects eight hours without duplicating partial or reducing excess realized hours", () => {
  for (const realized of [0, 2, 5.5, 8, 9.5]) {
    const today = "2026-09-08", slot = daytime(today);
    const input = Object.freeze({ ...record(today, realized), schedule: slot });
    const result = summarizePartnerMonth(partner, period, today, [input], [slot, daytime("2026-09-09")], new Map([[today, realized]]), 12 * 60);
    assert.equal(result.inProgressHours, Math.max(0, 8 - realized));
    assert.equal(result.projectedHours, Math.max(8, realized) + 8);
    assert.equal(result.futureHours, 8);
    assert.equal(result.effectiveHours, realized); assert.equal(result.actualHours, realized); assert.equal(result.capturedHours, realized);
    assert.equal(input.effectiveHours, realized);
  }
});

test("no record during an ongoing shift is projection only; missing past hours remain missing", () => {
  const row = summarizePartnerMonth(partner, period, "2026-09-08", [], [daytime("2026-09-07"), daytime("2026-09-08")], new Map(), 12 * 60);
  assert.equal(row.realizedRecords, 0); assert.equal(row.effectiveHours, 0);
  assert.equal(row.inProgressHours, 8); assert.equal(row.projectedHours, 8); assert.equal(row.missingPastSlots, 1);
  const onlyCurrent = summarizePartnerMonth(partner, period, "2026-09-08", [], [daytime("2026-09-08")], new Map(), 12 * 60);
  assert.equal(onlyCurrent.status, "Turno em andamento");
});

test("the complement applies only within scheduled hours and disappears at the end", () => {
  const today = "2026-09-08", slot = daytime(today);
  for (const [minute, complement] of [[7 * 60 + 59, 0], [8 * 60, 6], [16 * 60 + 59, 6], [17 * 60, 0], [23 * 60, 0]]) {
    const row = summarizePartnerMonth(partner, period, today, [{ ...record(today, 2), schedule: slot }], [slot], new Map(), minute);
    assert.equal(row.inProgressHours, complement, `minute ${minute}`);
    assert.equal(row.projectedHours, 2 + complement);
  }
});

test("overnight shifts are attributed to their start day, including across a month boundary", () => {
  const slot = schedule("2026-08-31");
  const august = { startDate: "2026-08-01", endDate: "2026-08-31" };
  const active = summarizePartnerMonth(partner, august, "2026-09-01", [], [slot], new Map(), 5 * 60);
  assert.equal(active.inProgressHours, 8); assert.equal(active.projectedHours, 8); assert.equal(active.missingPastSlots, 0);
  const ended = summarizePartnerMonth(partner, august, "2026-09-01", [], [slot], new Map(), 8 * 60);
  assert.equal(ended.inProgressHours, 0); assert.equal(ended.projectedHours, null); assert.equal(ended.missingPastSlots, 1);
  const september = summarizePartnerMonth(partner, period, "2026-09-01", [], [slot], new Map(), 5 * 60);
  assert.equal(september.inProgressHours, 0); assert.equal(september.projectedHours, null);
  assert.equal(spaceShiftInProgress(schedule("2026-09-08"), "2026-09-08", 23 * 60), true);
  assert.equal(spaceShiftInProgress(schedule("2026-09-08"), "2026-09-09", 0), true);
});

test("in-progress projection preserves excluded statuses and requires valid start/end times", () => {
  for (const status of ["FOLGA", "FALTA", "FALTA_JUSTIFICADA", "FERIAS", "NESTING", "TREINAMENTO", "ONBOARDING", "AFASTADO"]) {
    const row = summarizePartnerMonth(partner, period, "2026-09-08", [], [daytime("2026-09-08", status)], new Map(), 12 * 60);
    assert.equal(row.inProgressHours, 0, status); assert.equal(row.projectedHours, null, status);
  }
  for (const times of [{ startsAt: null, endsAt: "17:00" }, { startsAt: "08:00", endsAt: null }, { startsAt: "bad", endsAt: "17:00" }, { startsAt: "08:00", endsAt: "08:00" }, { startsAt: "25:00", endsAt: "27:00" }]) {
    assert.equal(spaceShiftInProgress({ ...daytime("2026-09-08"), ...times }, "2026-09-08", 12 * 60), false);
  }
  for (const status of ["ESCALADO", "PRESENTE", "ATRASO", "TROCA_APROVADA", "VENDA_FOLGA_APROVADA"]) {
    const row = summarizePartnerMonth(partner, period, "2026-09-08", [], [daytime("2026-09-08", status)], new Map(), 12 * 60);
    assert.equal(row.inProgressHours, 8, status);
  }
  const removed = summarizePartnerMonth(partner, period, "2026-09-08", [record("2026-09-08", 2)], [], new Map(), 12 * 60);
  assert.equal(removed.projectedHours, 2); assert.equal(removed.inProgressHours, 0);
});

test("the summary sums per-partner complements, not eight minus the team average", () => {
  const base = { ...daytime("2026-09-08"), shiftName: "Manhã", future: false };
  const result = summarizeSpaceHours(period, "2026-09-08", { hours: 15, records: 4 }, [
    { ...base, effectiveHours: 2, slots: 3 }, { ...base, effectiveHours: 9, slots: 1 },
    { ...base, status: "NESTING", effectiveHours: null, slots: 4 },
    { ...base, date: new Date("2026-09-09"), future: true, effectiveHours: null, slots: 4 }
  ], 12 * 60);
  assert.equal(result.inProgressHours, 18); assert.equal(result.futureHours, 32); assert.equal(result.projectedHours, 65);
  assert.equal(result.realizedHours, 15); assert.equal(result.missingPastSlots, 0);
  const overnight = { ...schedule("2026-08-31"), shiftName: "Noite", future: false, effectiveHours: null, slots: 2 };
  const august = { startDate: "2026-08-01", endDate: "2026-08-31" };
  const active = summarizeSpaceHours(august, "2026-09-01", { hours: null, records: 0 }, [overnight], 5 * 60);
  assert.equal(active.projectedHours, 16); assert.equal(active.missingPastSlots, 0);
  const ended = summarizeSpaceHours(august, "2026-09-01", { hours: null, records: 0 }, [overnight], 8 * 60);
  assert.equal(ended.projectedHours, null); assert.equal(ended.missingPastSlots, 2);
});

test("the calculation clock uses São Paulo dates and 00h even when UTC is already on the next day", () => {
  assert.deepEqual(spaceHoursClock(new Date("2026-09-09T02:30:00Z")), { today: "2026-09-08", minuteOfDay: 23 * 60 + 30 });
  assert.deepEqual(spaceHoursClock(new Date("2026-09-09T03:00:00Z")), { today: "2026-09-09", minuteOfDay: 0 });
  assert.deepEqual(spaceHoursClock(new Date("2026-09-08T15:00:00Z")), { today: "2026-09-08", minuteOfDay: 12 * 60 });
});
