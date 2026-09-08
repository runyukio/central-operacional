import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { buildAdherenceSummary, type AdherenceSummary } from "../lib/work-hour-adherence-summary";
import * as chart from "../lib/work-hour-adherence-chart";

const localRequire = createRequire(import.meta.url);
const source = readFileSync(new URL("./work-hour-justification-chart.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const loaded = { exports: {} as { default: ComponentType<{ data: AdherenceSummary }>; PendingTooltip: ComponentType<any> } };
new Function("require", "exports", "module", compiled)((id: string) => id === "@/lib/work-hour-adherence-chart" ? chart : localRequire(id), loaded.exports, loaded);
const render = (data: AdherenceSummary) => renderToStaticMarkup(createElement(loaded.exports.default, { data }));
const period = { startDate: "2026-09-01", endDate: "2026-09-01" };
const supervisors = [{ id: "a", name: "Supervisor A" }, { id: "b", name: "Supervisor B" }];

test("dia único usa barras e mantém supervisores com zero, sem ações de justificativa", () => {
  const html = render(buildAdherenceSummary(period, [{ date: period.startDate, supervisorId: "a", supervisor: "A", count: 4 }], supervisors));
  assert.match(html, /data-chart-type="bar"/);
  assert.match(html, /Supervisor B/);
  assert.match(html, />0<\/td>/);
  assert.doesNotMatch(html, /textarea|<button|Responder|Importar/);
});

test("vários dias usam linhas com legenda interativa e dados diários acessíveis", () => {
  const html = render(buildAdherenceSummary({ ...period, endDate: "2026-09-03" }, [], supervisors));
  assert.match(html, /data-chart-type="line"/);
  assert.match(html, /aria-label="Ocultar Supervisor A"/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /03\/09\/2026/);
  assert.match(html, /sem soma acumulada/);
  assert.match(html, /Nenhuma justificativa pendente encontrada/);
  assert.equal((html.match(/>0<\/td>/g) ?? []).length, 6);
});

test("sem supervisores mostra ausência de cadastro e não erro ou uma série inventada", () => {
  const html = render(buildAdherenceSummary(period, [], []));
  assert.match(html, /Nenhum supervisor cadastrado/);
  assert.doesNotMatch(html, /data-chart-type/);
});

test("tooltip informa Shift Date, supervisor e quantidade, inclusive zero e nomes escapados", () => {
  const tooltip = (props: any) => renderToStaticMarkup(createElement(loaded.exports.PendingTooltip, props));
  const html = tooltip({ active: true, label: "2026-09-02", payload: [{ name: "<script>Nome</script>", value: 0 }] });
  assert.match(html, /Shift Date: 02\/09\/2026/);
  assert.match(html, />0<\/strong>/);
  assert.match(html, /&lt;script&gt;Nome/);
  assert.doesNotMatch(html, /<script>/);
  const single = tooltip({ active: true, singleDay: true, payload: [{ name: "Pendências", value: 3, payload: { name: "Supervisor A", date: "2026-09-01" } }] });
  assert.match(single, /Supervisor A/);
  assert.match(single, /01\/09\/2026/);
  assert.equal(tooltip({ active: false, payload: [] }), "");
});

test("quadro mantém largura centralizada e telas existentes ficam fora de seu escopo", () => {
  const summarySource = readFileSync(new URL("./work-hour-justification-summary.tsx", import.meta.url), "utf8");
  assert.match(summarySource, /card mx-auto w-full max-w-\[1200px\].*lg:w-\[80%\]/);
  assert.equal((summarySource.match(/<section/g) ?? []).length, 1);
  assert.match(summarySource, /Aplicar período/);
  assert.match(summarySource, /Última importação/);
  assert.match(summarySource, /setApplied\(null\)/);
  assert.match(summarySource, /requests\.isCurrent/);
  assert.match(summarySource, /signal: request.signal/);
  assert.doesNotMatch(summarySource, /method:.*POST|setInterval|api\/work-hours\/capture/);
});
