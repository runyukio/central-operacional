import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { observedAdsGlideAbsQuery, readObservedAdsGlideAbs, summarizeObservedAdsGlideAbs, type ObservedAdsAbsStatusRow } from "./ads-backlog-glide-abs";

const today = "2026-10-16";
const row = (dateKey: string, status: string, count: number, roleTitle = "Agente"): ObservedAdsAbsStatusRow => ({ dateKey, status, rows: count, roleTitle, updatedAt: new Date("2026-10-16T14:02:01.453Z") });
const complete = () => Array.from({ length: 7 }, (_, index) => row(`2026-10-${String(index + 9).padStart(2, "0")}`, "PRESENTE", 10));

test("uses canonical absence/day counts at full precision, including justified absences and approved days off", () => {
  const rows = complete();
  rows.push(row("2026-10-09", "PRESENTE", 147), row("2026-10-10", "FALTA", 9), row("2026-10-11", "FALTA_INJUSTIFICADA", 16), row("2026-10-12", "FALTA_JUSTIFICADA", 11), row("2026-10-13", "FOLGA_APROVADA", 26), row("2026-10-14", "VENDA_FOLGA_APROVADA", 4), row("2026-10-15", "NESTING", 44), row("2026-10-15", "FOLGA", 102), row("2026-10-15", "FERIAS", 4));
  const result = summarizeObservedAdsGlideAbs(today, rows);
  assert.equal(result.planned, 283);
  assert.equal(result.absent, 36);
  assert.equal(result.rate, 36 / 283);
  assert.notEqual(result.rate, 0.127);
  assert.equal(result.daysWithSchedules, 7);
  assert.equal(result.updatedAt, "2026-10-16T14:02:01.453Z");
  assert.deepEqual(result.warnings, []);
});

test("observed zero absences is valid but absent history, no denominator and unresolved schedules are unavailable", () => {
  assert.equal(summarizeObservedAdsGlideAbs(today, complete()).rate, 0);
  const missing = summarizeObservedAdsGlideAbs(today, []);
  assert.equal(missing.rate, null);
  assert.equal(missing.daysWithSchedules, 0);
  assert.match(missing.warnings.join(" "), /não.*0%|zero/);
  const daysOff = summarizeObservedAdsGlideAbs(today, complete().map((value) => ({ ...value, status: "FOLGA" })));
  assert.equal(daysOff.daysWithSchedules, 7);
  assert.equal(daysOff.rate, null);
  const partial = summarizeObservedAdsGlideAbs(today, complete().slice(1));
  assert.equal(partial.daysWithSchedules, 6);
  assert.equal(partial.rate, null);
  const unresolved = summarizeObservedAdsGlideAbs(today, [...complete(), row("2026-10-15", "ESCALADO", 1)]);
  assert.equal(unresolved.unresolvedScheduled, 1);
  assert.equal(unresolved.rate, null);
});

test("only the seven completed operational dates enter the reference, independent of process timezone", () => {
  const rows = [...complete(), row("2026-10-08", "FALTA", 1000), row(today, "FALTA", 1000), row("2026-10-17", "ESCALADO", 1000)];
  const result = summarizeObservedAdsGlideAbs(today, rows);
  assert.equal(result.startDate, "2026-10-09");
  assert.equal(result.endDate, "2026-10-15");
  assert.equal(result.planned, 70);
  assert.equal(result.absent, 0);
  assert.equal(result.rate, 0);
  const sql = observedAdsGlideAbsQuery(today);
  assert.deepEqual(sql.values, [new Date("2026-10-09T00:00:00Z"), new Date("2026-10-16T00:00:00Z")]);
  assert.doesNotMatch(sql.text, /AT TIME ZONE|INTERVAL '3 hour|NOW\(/i);
  assert.equal(summarizeObservedAdsGlideAbs("2027-01-02", []).startDate, "2026-12-26");
  assert.equal(summarizeObservedAdsGlideAbs("2024-03-02", []).startDate, "2024-02-24");
});

test("job-title aliases use the existing classifier while staff cannot inflate coverage or denominator", () => {
  const rows = complete().map((value, index) => ({ ...value, roleTitle: ["Agente", "agent", "Moderador de conteúdo", "Content Moderator", "  moderador   de CONTEUDO ", " AGENTE ", "Agent"][index] }));
  rows.push(row("2026-10-15", "FALTA", 1000, "Supervisor"), row("2026-10-15", "PRESENTE", 1000, "Qualidade"));
  assert.equal(summarizeObservedAdsGlideAbs(today, rows).planned, 70);
  assert.equal(summarizeObservedAdsGlideAbs(today, rows).rate, 0);
  assert.equal(summarizeObservedAdsGlideAbs(today, [row("2026-10-09", "PRESENTE", 10), ...complete().slice(1).map((value) => ({ ...value, roleTitle: "Supervisor" }))]).daysWithSchedules, 1);
});

test("the real reader queries saved ADS slots or legacy fallback and preserves historical absences regardless of current roster state", async (t) => {
  const query = t.mock.method(prisma, "$queryRaw", async (sql: Prisma.Sql) => {
    assert.match(sql.text, /employee_lob\.name='ADS'/);
    assert.match(sql.text, /slot_lob\.name='ADS' OR s\."lobId" IS NULL/);
    assert.match(sql.text, /s\."deletedAt" IS NULL/);
    assert.doesNotMatch(sql.text, /e\."deletedAt"|operationalStatus|AttendanceRecord|WorkHourRecord/);
    assert.match(sql.text, /s\.date>=\$1/);
    assert.match(sql.text, /s\.date<\$2/);
    assert.match(sql.text, /GROUP BY s\.date::date, e\."roleTitle", s\.status/);
    assert.doesNotMatch(sql.text, /fullName|wbLogin|email/);
    return [...complete(), row("2026-10-09", "FALTA_JUSTIFICADA", 2)];
  });
  const result = await readObservedAdsGlideAbs(today);
  assert.equal(query.mock.callCount(), 1);
  assert.equal(result.planned, 72);
  assert.equal(result.absent, 2);
  assert.equal(result.rate, 2 / 72);
});

test("invalid counts, unknown statuses and invalid dates cannot publish an observed rate", () => {
  for (const invalid of [row("2026-10-10", "FALTA", -1), row("2026-10-10", "FALTA", 1.5), row("2026-10-10", "UNKNOWN", 1)]) {
    assert.equal(summarizeObservedAdsGlideAbs(today, [...complete(), invalid]).rate, null);
  }
  for (const invalidToday of ["2026-02-30", "2026-10-16T00:00:00Z", "", "invalid"]) assert.throws(() => observedAdsGlideAbsQuery(invalidToday), /Data operacional inválida/);
});
