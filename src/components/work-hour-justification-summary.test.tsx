import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { ADHERENCE_SUMMARY_SUPERVISORS as roster, buildAdherenceSummary, type AdherenceSummary } from "../lib/work-hour-adherence-summary";
import * as chart from "../lib/work-hour-adherence-chart";

const localRequire = createRequire(import.meta.url);
const source = readFileSync(new URL("./work-hour-justification-chart.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const loaded = { exports: {} as { default: ComponentType<{ data: AdherenceSummary }>; PendingTooltip: ComponentType<any> } };
new Function("require", "exports", "module", compiled)((id: string) => id === "@/lib/work-hour-adherence-chart" ? chart : localRequire(id), loaded.exports, loaded);
const render = (data: AdherenceSummary) => renderToStaticMarkup(createElement(loaded.exports.default, { data }));
const period = { startDate: "2026-09-03", endDate: "2026-09-03" };

test("dia único e vários dias usam sete barras, mesma altura e ordem, sem ações", () => {
  for (const endDate of ["2026-09-03", "2026-09-07"]) {
    const html = render(buildAdherenceSummary({ ...period, endDate }, []));
    assert.match(html, /data-chart-type="bar"/);
    assert.match(html, /height:507px/);
    assert.equal((html.match(/>0<\/td>/g) ?? []).length, 7);
    assert.equal((html.match(/<tr>/g) ?? []).length, 8);
    const positions = roster.map(({ name }) => html.indexOf(name));
    assert.ok(positions.every((position, index) => position >= 0 && (!index || position > positions[index - 1])));
    assert.doesNotMatch(html, /LineChart|<button|textarea|Responder|Importar|Ocultar|dados diários/);
  }
  assert.doesNotMatch(source, /LineChart|LineData|setHidden|isSingleDay/);
});

test("período soma todas as datas em uma única linha por supervisor", () => {
  const html = render(buildAdherenceSummary({ ...period, endDate: "2026-09-07" }, [
    { date: period.startDate, supervisorId: roster[0].id, supervisor: "Nome antigo", count: 2 },
    { date: "2026-09-07", supervisorId: roster[0].id, supervisor: "Nome antigo", count: 3 }
  ]));
  assert.match(html, /<td>Priscilla<\/td><td>5<\/td>/);
  assert.match(html, /03\/09\/2026 a 07\/09\/2026/);
  assert.equal((html.match(/>0<\/td>/g) ?? []).length, 6);
  assert.doesNotMatch(html, /Nome antigo/);
});

test("tooltip informa período, supervisor e quantidade, com nomes escapados", () => {
  const tooltip = (props: any) => renderToStaticMarkup(createElement(loaded.exports.PendingTooltip, props));
  const html = tooltip({ active: true, payload: [{ value: 0, payload: { name: "<script>Nome</script>", ...period, endDate: "2026-09-07" } }] });
  assert.match(html, /Shift Date: 03\/09\/2026 a 07\/09\/2026/);
  assert.match(html, />0<\/strong>/);
  assert.match(html, /&lt;script&gt;Nome/);
  assert.doesNotMatch(html, /<script>/);
  const single = tooltip({ active: true, payload: [{ value: 3, payload: { name: "Priscilla", ...period } }] });
  assert.match(single, /Priscilla/);
  assert.match(single, /Shift Date: 03\/09\/2026<\/p>/);
  assert.equal(tooltip({ active: false, payload: [] }), "");
});

test("quadro centralizado preserva filtros, importação e cancelamento de consultas antigas", () => {
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
