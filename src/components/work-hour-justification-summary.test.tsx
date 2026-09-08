import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { buildAdherenceSummary, type AdherenceSummary } from "../lib/work-hour-adherence-summary";

const localRequire = createRequire(import.meta.url);
const source = readFileSync(new URL("./work-hour-justification-summary.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const loaded = { exports: {} as { AdherenceSummaryTable: ComponentType<{ data: AdherenceSummary }> } };
new Function("require", "exports", "module", compiled)((id: string) => id.startsWith("@/") ? {} : localRequire(id), loaded.exports, loaded);
const render = (data: AdherenceSummary) => renderToStaticMarkup(createElement(loaded.exports.AdherenceSummaryTable, { data }));

test("quadro mantém todos os dias inclusivos, responsáveis distintos, totais e apenas contagens positivas", () => {
  const data = buildAdherenceSummary({ startDate: "2026-08-31", endDate: "2026-09-02" }, [
    { date: "2026-08-31", supervisorId: "a", supervisor: "Nome igual", count: 9 },
    { date: "2026-08-31", supervisorId: "a", supervisor: "Nome igual", count: 2 },
    { date: "2026-08-31", supervisorId: "b", supervisor: "Nome igual", count: 3 },
    { date: "2026-09-02", supervisorId: "a", supervisor: "Nome igual", count: 1 },
    { date: "2026-09-02", supervisorId: "zero", supervisor: "Não mostrar", count: 0 },
    { date: "2026-09-03", supervisorId: "out", supervisor: "Fora do período", count: 99 }
  ]);
  assert.equal(data.total, 15);
  assert.deepEqual(data.days.map((day) => day.total), [14, 0, 1]);
  const html = render(data);
  assert.equal((html.match(/Total do dia/g) ?? []).length, 3);
  assert.match(html, /31\/08\/2026/);
  assert.match(html, /02\/09\/2026/);
  assert.match(html, /Total geral do período/);
  assert.match(html, />15<\/td>/);
  assert.doesNotMatch(html, /Não mostrar|Fora do período|textarea|<button/);
});

test("período vazio exibe mensagem exata sem confundir ausência de pendências com erro", () => {
  const html = render(buildAdherenceSummary({ startDate: "2026-09-01", endDate: "2026-09-07" }, []));
  assert.match(html, /Nenhuma justificativa pendente encontrada no período selecionado\./);
  assert.doesNotMatch(html, /<table/);
});

test("quadro escapa nomes e não permite HTML em nomes de supervisor", () => {
  const html = render(buildAdherenceSummary({ startDate: "2026-09-01", endDate: "2026-09-01" }, [
    { date: "2026-09-01", supervisorId: "a", supervisor: "<script>alert(1)</script>", count: 1 }
  ]));
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});
