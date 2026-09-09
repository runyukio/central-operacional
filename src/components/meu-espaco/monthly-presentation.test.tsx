import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import type { SpaceHours, SpaceMetric, SpaceResults } from "../../lib/meu-espaco-contract";
import { spaceHoursDefaultPeriod } from "../../lib/meu-espaco-hours";
import { formatLatencyDisplay } from "../../lib/latency-display";
import { formatWorkHours, formatSignedMinutesToHHMM } from "../../lib/work-hours-rules";

const localRequire = createRequire(import.meta.url);
function loadComponent<Props>(file: string, name: string, dependencies: Record<string, unknown>): ComponentType<Props> {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
  }).outputText;
  const result = { exports: {} as Record<string, ComponentType<Props>> };
  new Function("require", "exports", "module", compiled)((id: string) => dependencies[id] ?? localRequire(id), result.exports, result);
  return result.exports[name];
}

const number = (value: number | null | undefined, suffix = "") => value == null ? "Sem dados" : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}${suffix}`;
const dateLabel = (value: string | null | undefined) => value ? value.slice(0, 10).split("-").reverse().join("/") : "Sem dados";
const metric: SpaceMetric = {
  production: 1200, dailyTeam: 600, dailyIndividual: 300, ahtSeconds: 55, cpd: null,
  quality: 96, abs: 5, latencyMinutes: 90, commentsLatencyMinutes: null,
  latencySubmits: 1200, commentsLatencySubmits: 0, productionDays: 2, agentDays: 4,
  qualitySamples: 100, planned: 20, absences: 1
};
const period = { startDate: "2026-09-01", endDate: "2026-09-30" };
const group = (lob: string): SpaceResults["groups"][number] => ({
  lob, teamSize: 2, metric,
  daily: [
    { date: "2026-09-01", metric },
    { date: "2026-09-02", metric: { ...metric, production: 0 } },
    { date: "2026-09-03", metric: { ...metric, production: null } }
  ],
  coverage: { productionPartners: 2, qualityPartners: 2, schedulePartners: 2,
    productionLatest: null, qualityLatest: null, scheduleLatest: null, updatedAt: null }
});
const ResultsTab = loadComponent<{ data: SpaceResults }>("./resultados.tsx", "SpaceResultsTab", {
  "./target-card": { SpaceTargetCard: () => null },
  "@/lib/latency-display": { formatLatencyDisplay },
  "./shared": { number, dateLabel, tableClass: "table", SpaceButtons: () => null,
    SpaceCard: ({ title, value }: { title: string; value: string }) => createElement("div", { "data-card": title }, value) }
});
function resultsHtml(groups: SpaceResults["groups"]) {
  return renderToStaticMarkup(createElement(ResultsTab, { data: { period, groups, partners: [], supervisors: [] } }));
}
function dailySection(html: string, lob: string) {
  const section = html.match(new RegExp(`<section[^>]*aria-label="Evolução diária ${lob}"[\\s\\S]*?</section>`))?.[0];
  assert.ok(section, `Missing daily evolution for ${lob}`);
  return section;
}

test("ADS daily evolution displays total submits, not a team or individual average", () => {
  const html = resultsHtml([group("ADS")]);
  const section = dailySection(html, "ADS");
  assert.match(section, /<th>Data<\/th><th>Submit total<\/th>/);
  assert.match(section, /<td>01\/09\/2026<\/td><td>1\.200<\/td><td>300<\/td>/);
  assert.match(section, /Submit total soma a produção do time nessa data/);
  assert.equal((html.match(/<th>Submit total<\/th>/g) ?? []).length, 1);
});

test("daily total keeps real zero distinct from missing production", () => {
  const section = dailySection(resultsHtml([group("ADS")]), "ADS");
  assert.match(section, /<td>02\/09\/2026<\/td><td>0<\/td>/);
  assert.match(section, /<td>03\/09\/2026<\/td><td>Sem dados<\/td>/);
});

test("CEC and TNS daily columns remain unchanged and empty ADS keeps its empty state", () => {
  const html = resultsHtml([group("ADS"), group("CEC"), group("TNS")]);
  for (const lob of ["CEC", "TNS"]) assert.doesNotMatch(dailySection(html, lob), /Submit total/);
  assert.match(dailySection(html, "CEC"), /<th>CPD<\/th>/);
  assert.match(dailySection(html, "TNS"), /<th>AHT<\/th>/);
  const empty = dailySection(resultsHtml([{ ...group("ADS"), daily: [] }]), "ADS");
  assert.match(empty, /Sem dados no período/);
  assert.doesNotMatch(empty, /<td>/);
});

function hoursHtml(data: SpaceHours) {
  const HoursTab = loadComponent<{ supervisorId: string; initialPeriod: typeof period }>("./horas.tsx", "SpaceHoursTab", {
    "@/components/modules/shared": { FormInput: ({ label }: { label: string }) => createElement("label", null, label) },
    "@/lib/work-hours-rules": { formatWorkHours, formatSignedMinutesToHHMM },
    "@/lib/meu-espaco-hours": { spaceHoursDefaultPeriod },
    "./shared": { tableClass: "table", SpaceLoad: () => null, useSpaceRead: () => ({ data, loading: false, error: "" }),
      SpaceCard: () => { throw new Error("Hours must not render the removed KPI cards"); } }
  });
  return renderToStaticMarkup(createElement(HoursTab, { supervisorId: "supervisor", initialPeriod: period }));
}
const hours: SpaceHours = {
  period,
  summary: { actualThrough: "2026-09-08", projectionFrom: "2026-09-09", projectionUntil: "2026-09-30",
    realizedHours: 15.5, futureHours: 16, inProgressHours: 0, projectedHours: 31.5, realizedRecords: 2, futureSlots: 2, missingPastSlots: 1 },
  data: [{ id: "partner", employeeId: "partner", employeeName: "Parceiro de teste", wbLogin: "wb_teste", month: "2026-09", lob: "ADS",
    plannedHours: 32, actualHours: 15, capturedHours: 15.5, effectiveHours: 15.5, adjustedHours: 0.5, differenceMinutes: -30,
    status: "1 dias sem horas", realizedRecords: 2, futureHours: 16, inProgressHours: 0, projectedHours: 31.5, missingPastSlots: 1 }],
  pagination: { page: 1, totalPages: 1, total: 1 }
};

test("hours hides only the three top cards and preserves monthly rows, filters, paging and warnings", () => {
  const html = hoursHtml(hours);
  for (const title of ["Horas realizadas no mês", "Escala futura do mês", "Total projetado do mês"]) assert.doesNotMatch(html, new RegExp(title));
  for (const text of ["Mês das horas", "Consolidado mensal por parceiro · 09/2026", "Parceiro de teste", "wb_teste", "Capturadas",
    "Realizadas (efetivas)", "Escala futura", "Total projetado", "15:30", "16:00", "31:30", "Página 1 de 1", "total pode estar incompleto"]) assert.ok(html.includes(text), text);
});

test("hours keeps the no-record and future-only notices without the KPI cards", () => {
  const html = hoursHtml({ ...hours, data: [], summary: { ...hours.summary, realizedRecords: 0, realizedHours: null } });
  assert.match(html, /Sem registros de horas no período/);
  assert.match(html, /Sem realizado disponível: o total projetado considera somente a escala futura/);
});

test("hours identifies the in-progress complement without presenting it as realized hours", () => {
  const html = hoursHtml({ ...hours, data: [{ ...hours.data[0], effectiveHours: 2, inProgressHours: 6, futureHours: 8, projectedHours: 16 }] });
  assert.match(html, /Inclui \+6:00 para completar o turno em andamento/);
  assert.match(html, /<td>2:00<\/td><td>8:00<\/td><td>16:00/);
  assert.match(html, /A projeção não altera ou aprova horas/);
  assert.doesNotMatch(html, /hoje não é projetado novamente/);
  const noRecord = hoursHtml({ ...hours, data: [], summary: { ...hours.summary, realizedRecords: 0, realizedHours: null, inProgressHours: 8, futureSlots: 0 } });
  assert.match(noRecord, /Sem realizado disponível: o total projetado inclui o turno em andamento/);
});
