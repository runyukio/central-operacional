import assert from "node:assert/strict";
import test from "node:test";

import { calculatePersonalModeration, personalCapture, personalCecCpd, personalCycleTime, personalHourlyIntervals, resolvePersonalShift,
  type PersonalReading, type PersonalShift } from "./my-realtime";

const at = (time: string) => `2026-11-05T${time}:00-03:00`;
const iso = (time: string) => new Date(at(time)).toISOString();
const shift: PersonalShift = { date: "2026-11-05", start: iso("08:00"), end: iso("17:00"), observedUntil: iso("09:00"), startsAt: "08:00", endsAt: "17:00" };
const point = (time: string, submit: number | null, moderationMs = 1_000, refresh = 2, timeout = 1): PersonalReading => ({
  cycleDownload: `2026-11-05 ${time}`, importedAt: iso("09:01"), submit, moderationMs, refresh, timeout
});
const slot = (date = "2026-11-05", startsAt = "08:00", endsAt = "17:00", status = "ESCALADO") => ({
  id: date, employeeId: "own", date: new Date(`${date}T00:00:00Z`), startsAt, endsAt, status, shift: null
});

test("escala diurna, meia-noite, limites e ausência de escala não estimam jornada", () => {
  assert.equal(resolvePersonalShift([slot()], new Date(at("08:00"))).shiftState, "active");
  assert.equal(resolvePersonalShift([slot()], new Date(at("17:00"))).shiftState, "outside_shift");
  assert.equal(resolvePersonalShift([], new Date(at("09:00"))).shiftState, "no_schedule");
  assert.equal(resolvePersonalShift([slot(undefined, undefined, undefined, "FOLGA")], new Date(at("09:00"))).shift, null);
  assert.equal(resolvePersonalShift([slot(undefined, "", "")], new Date(at("09:00"))).shift, null);
  const overnight = resolvePersonalShift([slot("2026-11-04", "22:00", "06:00")], new Date(at("02:00")));
  assert.equal(overnight.shift?.date, "2026-11-04");
  assert.equal(overnight.shift?.end, iso("06:00"));
  assert.equal(resolvePersonalShift([slot(), slot("2026-11-04", "22:00", "10:00")], new Date(at("09:00"))).shift, null);
});

test("converte os ciclos locais e rejeita datas inválidas", () => {
  assert.equal(personalCycleTime("2026-11-05 08:00"), Date.parse(iso("08:00")));
  assert.ok(Number.isNaN(personalCycleTime("2026-11-05 25:00")));
  assert.ok(Number.isNaN(personalCycleTime("2026-02-30 08:00")));
});

test("soma diferenças de todos os contadores e escolhe a última importação por ciclo", () => {
  const result = calculatePersonalModeration(shift, [point("08:00", 10), point("08:30", 999),
    { ...point("08:30", 20, 2_000, 4, 1), importedAt: iso("09:02") }, point("09:00", 25, 3_000, 5, 3)]);
  assert.deepEqual(result.productivity.metrics, { submit: 15, moderationMs: 2_000, refresh: 3, timeout: 2, ahtMs: 2_000 / 15 });
  assert.equal(result.productivity.status, "complete");
  assert.equal(result.intervals.length, 2);
});

test("meia-noite local não zera os contadores nem o Shift Date noturno", () => {
  const night = { ...shift, start: "2026-11-05T02:30:00Z", observedUntil: "2026-11-05T03:30:00Z" };
  const readings = [point("23:30", 100, 10_000, 7, 8), point("00:00", 110, 10_300, 8, 9), point("00:30", 120, 10_500, 9, 10)]
    .map((reading, index) => ({ ...reading, cycleDownload: `${index ? "2026-11-05" : "2026-11-04"} ${["23:30", "00:00", "00:30"][index]}` }));
  assert.deepEqual(calculatePersonalModeration(night, readings).productivity.metrics, { submit: 20, moderationMs: 500, refresh: 2, timeout: 2, ahtMs: 25 });
});

test("não estima antes do primeiro ciclo, entre lacunas ou após a última leitura", () => {
  const result = calculatePersonalModeration({ ...shift, observedUntil: iso("10:10") }, [point("08:30", 10), point("09:30", 30), point("10:00", 40)]);
  assert.equal(result.productivity.metrics?.submit, 10);
  assert.equal(result.productivity.status, "partial");
  assert.equal(result.intervals.filter((interval) => interval.metrics === null).length, 3);
  assert.equal(calculatePersonalModeration(shift, [point("08:00", 0)]).productivity.metrics, null);
  assert.equal(calculatePersonalModeration(shift, []).productivity.metrics, null);
});

test("ausência do agente em um ciclo impede aproveitar uma leitura antiga; zero exige par válido", () => {
  const result = calculatePersonalModeration(shift, [point("08:00", 10), point("08:30", 20),
    { ...point("08:30", null), importedAt: iso("09:02") }, point("09:00", 30)]);
  assert.equal(result.productivity.metrics, null);
  assert.deepEqual(calculatePersonalModeration(shift, [point("08:00", 0, 0, 0, 0), point("08:30", 0, 0, 0, 0), point("09:00", 0, 0, 0, 0)]).productivity.metrics,
    { submit: 0, moderationMs: 0, refresh: 0, timeout: 0, ahtMs: null });
});

test("reinício das 13h preserva os trechos anteriores e reinicia cada contador independentemente", () => {
  const day = { ...shift, start: iso("12:00"), observedUntil: iso("14:00") };
  const readings = [point("12:00", 100, 10_000, 7, 8), point("12:30", 150, 11_000, 8, 9),
    point("13:00", 5, 300, 0, 10), point("13:30", 15, 1_300, 2, 11), point("14:00", 45, 4_300, 3, 12)];
  const result = calculatePersonalModeration(day, readings);
  assert.deepEqual(result.productivity.metrics, { submit: 95, moderationMs: 5_300, refresh: 4, timeout: 4, ahtMs: 5_300 / 95 });
  assert.deepEqual(result.productivity.resetCycles, ["2026-11-05 13:00"]);
  const hourly = personalHourlyIntervals(day, result.intervals, "moderation");
  assert.equal(hourly.intervals[0].metrics?.submit, 55);
  assert.equal(hourly.intervals[1].metrics?.submit, 40);
  assert.equal(hourly.intervals[0].hour, iso("12:00"));
  assert.equal(hourly.intervals[1].hour, iso("13:00"));
  assert.equal(hourly.intervals[1].metrics?.ahtMs, 100);
});

test("queda inesperada à meia-noite é parcial, sem inventar novo acumulador", () => {
  const night = { ...shift, start: "2026-11-05T02:30:00Z", observedUntil: "2026-11-05T03:30:00Z" };
  const readings = [{ ...point("23:30", 100), cycleDownload: "2026-11-04 23:30" }, point("00:00", 5), point("00:30", 15)];
  const result = calculatePersonalModeration(night, readings);
  assert.equal(result.productivity.metrics?.submit, 10);
  assert.equal(result.productivity.status, "partial");
  assert.deepEqual(result.productivity.resetCycles, []);
});

test("hora a hora soma os dois trechos e calcula AHT ponderado, sem média simples", () => {
  const result = calculatePersonalModeration(shift, [point("08:00", 0, 0), point("08:30", 10, 100_000), point("09:00", 40, 700_000)]);
  const hourly = personalHourlyIntervals(shift, result.intervals, "moderation");
  assert.equal(hourly.intervals[0].metrics?.submit, 40);
  assert.equal(hourly.intervals[0].metrics?.ahtMs, 17_500);
  assert.equal(result.productivity.metrics?.ahtMs, 17_500);
  assert.equal(hourly.intervals[0].status, "complete");
  assert.equal(hourly.intervals[1].status, "partial");
});

test("hora atual, limites fracionários e lacunas mantêm os valores conhecidos parciais", () => {
  const current = { ...shift, start: iso("08:30"), observedUntil: iso("10:10") };
  const raw = calculatePersonalModeration(current, [point("08:30", 0), point("09:00", 10), point("09:30", 20), point("10:00", 30)]);
  const hourly = personalHourlyIntervals(current, raw.intervals, "moderation");
  assert.equal(hourly.intervals[0].hour, iso("08:00"));
  assert.equal(hourly.intervals[0].start, iso("08:30"));
  assert.equal(hourly.intervals[0].status, "partial");
  assert.equal(hourly.intervals[1].status, "complete");
  assert.equal(hourly.intervals[2].metrics, null);
  assert.equal(hourly.intervals[2].status, "partial");
});

test("noite fica ordenada por timestamp real e madrugada pertence ao mesmo Shift Date", () => {
  const night = { ...shift, date: "2026-11-04", start: "2026-11-05T02:00:00Z", observedUntil: "2026-11-05T04:30:00Z" };
  const hourly = personalHourlyIntervals(night, [], "moderation");
  assert.deepEqual(hourly.intervals.map((row) => row.hour), ["2026-11-05T02:00:00.000Z", "2026-11-05T03:00:00.000Z", "2026-11-05T04:00:00.000Z"]);
  assert.equal(night.date, "2026-11-04");
});

test("sem leitura exata na virada da hora não rateia produção entre horas", () => {
  const current = { ...shift, start: iso("08:45"), observedUntil: iso("09:15") };
  const raw = calculatePersonalModeration(current, [point("08:45", 0), point("09:15", 20)]);
  const hourly = personalHourlyIntervals(current, raw.intervals, "moderation");
  assert.equal(raw.productivity.metrics?.submit, 20);
  assert.equal(hourly.unallocated, true);
  assert.ok(hourly.intervals.every((row) => row.metrics === null && row.status === "partial"));
});

test("CEC hora a hora escolhe o último ciclo da hora, sem somar CPD", () => {
  const current = { ...shift, observedUntil: iso("09:10") };
  const snapshots = ["08:00", "08:30", "09:00"].map((hour, index) => ({ start: iso(hour), end: iso(hour), cycle: `2026-11-05 ${hour}`,
    metrics: null, cpd: 10 + index, capturedMs: null, status: "complete" as const }));
  const hourly = personalHourlyIntervals(current, snapshots, "cec");
  assert.deepEqual(hourly.intervals.map((row) => row.cpd), [11, 12]);
  assert.equal(hourly.intervals[0].cycle, "2026-11-05 08:30");
});

test("captura recorta o turno e une sobreposição sem incluir outro funcionário", () => {
  const own = { employeeId: "own", wbLogin: "own", lastSeenAt: iso("09:00"), segments: [
    { type: "ACTIVE", start: iso("07:50"), end: iso("08:40") }, { type: "ACTIVE", start: iso("08:30"), end: iso("09:20") }
  ] };
  const result = personalCapture([own, { ...own, employeeId: "other", segments: [{ type: "ACTIVE", start: iso("08:00"), end: iso("17:00") }] }],
    { id: "own", wbLogin: "own" }, shift.start, shift.observedUntil);
  assert.equal(result.capturedMs, 3_600_000);
  assert.equal(result.lastSeenAt, iso("09:00"));
  assert.equal(personalCapture([], { id: "own", wbLogin: "own" }, shift.start, shift.observedUntil).capturedMs, null);
  assert.equal(personalCapture([{ ...own, segments: [] }], { id: "own", wbLogin: "own" }, shift.start, shift.observedUntil).capturedMs, 0);
  assert.equal(personalCapture([{ ...own, lastSeenAt: iso("08:00") }], { id: "own", wbLogin: "own" }, shift.start, shift.observedUntil).status, "partial");
});

test("CEC exige nome completo inequívoco, conta tickets distintos e não inventa zero", () => {
  const tickets = [{ ticket: "1", agentName: " Ana Silva " }, { ticket: "1", agentName: "ANA SILVA" }, { ticket: "2", agentName: "Ana Silva" }, { ticket: "3", agentName: "Ana" }];
  assert.equal(personalCecCpd({ tickets }, "Ana Silva", 1), 2);
  assert.equal(personalCecCpd({ tickets }, "Ana Silva", 2), null);
  assert.equal(personalCecCpd({ tickets }, "Ana Santos", 1), null);
  assert.equal(personalCecCpd({ agents: [{ agentName: "Ana Silva", cpd: 0 }] }, "Ana Silva", 1), 0);
  assert.equal(personalCecCpd({ agents: [{ agentName: "Ana Silva", cpd: 1 }, { agentName: "ANA SILVA", cpd: 2 }] }, "Ana Silva", 1), null);
});
