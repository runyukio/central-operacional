import assert from "node:assert/strict";
import test from "node:test";

import { allocateCapturedHours, canonicalPersonalCapture, capturedHoursTotal, formatCapturedHours, selectOwnCaptureRows } from "./personal-capture-hours";
import { personalCapture, personalHourlyIntervals } from "./my-realtime";

const employee = { id: "own", wbLogin: "wb_agent" };
const shift = { date: "2026-11-05", start: "2026-11-06T02:00:00.000Z", end: "2026-11-06T11:00:00.000Z", observedUntil: "2026-11-06T11:00:00.000Z", startsAt: "23:00", endsAt: "08:00" };
// Synthetic counterexample: early capture plus a fractional-second remainder
// reproduces the reported 7:35:00 versus 7:23:04 discrepancy without person data.
function capturedRow() {
  return { data: shift.date, employeeId: employee.id, wbLogin: employee.wbLogin, activeMs: 27_300_000, lastSeenAt: "2026-11-06T10:54:33.440Z", segments: [
    { type: "ACTIVE", start: "2026-11-06T01:30:04.150Z", end: "2026-11-06T01:42:00.070Z" },
    { type: "NO_ACTIVITY", start: "2026-11-06T01:42:00.070Z", end: shift.start },
    { type: "ACTIVE", start: shift.start, end: "2026-11-06T09:23:04.080Z" },
    { type: "NO_ACTIVITY", start: "2026-11-06T09:23:04.080Z", end: shift.end }
  ] };
}

test("total pessoal usa exatamente o total canônico e preserva a antecipação", () => {
  const row = capturedRow();
  const legacy = personalCapture([row], employee, shift.start, shift.end);
  assert.equal(formatCapturedHours(legacy.capturedMs!), "07:23:04");
  const canonical = canonicalPersonalCapture([row], employee, shift.date, { start: shift.start, end: shift.end });
  assert.equal(canonical.summary.capturedMs, row.activeMs);
  assert.equal(formatCapturedHours(canonical.summary.capturedMs!), "07:35:00");
  assert.equal(canonical.start, "2026-11-06T01:30:04.150Z");
  const hourly = personalHourlyIntervals({ ...shift, start: canonical.start, observedUntil: canonical.end }, [], "cec");
  const allocated = allocateCapturedHours(canonical.rows, hourly.intervals);
  assert.equal(allocated.complete, true);
  assert.equal(allocated.intervals.reduce((sum, row) => sum + (row.capturedMs ?? 0), 0), row.activeMs);
  assert.ok(allocated.intervals.filter((row) => row.end > row.start).every((row) => row.capturedMs !== null && row.capturedMs % 1_000 === 0));
});

test("hora extra atribuída ao turno permanece no total e na hora após o fim previsto", () => {
  const row = { ...capturedRow(), activeMs: 3_720_000, segments: [
    { type: "ACTIVE", start: "2026-11-06T10:30:00Z", end: "2026-11-06T11:32:00Z" }
  ] };
  const canonical = canonicalPersonalCapture([row], employee, shift.date, { start: shift.start, end: shift.end });
  const hours = personalHourlyIntervals({ ...shift, start: canonical.start, observedUntil: canonical.end }, [], "moderation");
  const allocated = allocateCapturedHours(canonical.rows, hours.intervals);
  assert.equal(canonical.summary.capturedMs, 3_720_000);
  assert.equal(allocated.intervals.find((row) => row.hour === "2026-11-06T11:00:00.000Z")?.capturedMs, 1_920_000);
  assert.equal(allocated.intervals.reduce((sum, row) => sum + (row.capturedMs ?? 0), 0), canonical.summary.capturedMs);
});

test("Shift Date e identidade excluem outro turno e vínculo conflitante de WB", () => {
  const own = capturedRow();
  const selected = selectOwnCaptureRows([own, { ...own, data: "2026-11-06" }, { ...own, employeeId: "other" }], employee, shift.date);
  assert.deepEqual(selected, [own]);
  assert.equal(capturedHoursTotal(selected), own.activeMs);
  assert.equal(selectOwnCaptureRows([{ ...own, employeeId: "", wbLogin: " WB_AGENT " }], employee, shift.date).length, 1);
});

test("ausência continua indisponível; zero com captura válida permanece zero", () => {
  assert.equal(canonicalPersonalCapture([], employee, shift.date, { start: shift.start, end: shift.end }).summary.capturedMs, null);
  const row = { ...capturedRow(), activeMs: 0, segments: [{ type: "NO_ACTIVITY", start: shift.start, end: shift.end }] };
  const canonical = canonicalPersonalCapture([row], employee, shift.date, { start: shift.start, end: shift.end });
  const hours = personalHourlyIntervals(shift, [], "cec");
  assert.equal(canonical.summary.capturedMs, 0);
  assert.ok(allocateCapturedHours([row], hours.intervals).intervals.slice(0, -1).every((row) => row.capturedMs === 0));
});

test("sem segmentos conciliáveis mantém o total, sem inventar distribuição horária", () => {
  const row = { ...capturedRow(), segments: [] };
  const canonical = canonicalPersonalCapture([row], employee, shift.date, { start: shift.start, end: shift.end });
  const allocated = allocateCapturedHours([row], personalHourlyIntervals(shift, [], "cec").intervals);
  assert.equal(canonical.summary.capturedMs, row.activeMs);
  assert.equal(allocated.complete, false);
  assert.ok(allocated.intervals.every((row) => row.capturedMs === null));
});

test("formatação exibe segundos e preserva períodos maiores que 24 horas", () => {
  assert.equal(formatCapturedHours(29_339_953), "08:08:59");
  assert.equal(formatCapturedHours(27_300_000), "07:35:00");
  assert.equal(formatCapturedHours(90_001_000), "25:00:01");
});
