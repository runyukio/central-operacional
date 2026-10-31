import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as slaModule from "../lib/performance-supervisors-sla";

const localRequire = createRequire(import.meta.url);
const compiled = ts.transpileModule(readFileSync(new URL("./performance-supervisor-sla.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
}).outputText;
const result = { exports: {} as Record<string, React.ComponentType<any>> };
new Function("require", "exports", "module", compiled)((id: string) => id === "@/lib/performance-supervisors-sla" ? slaModule : localRequire(id), result.exports, result);
const render = (sla: slaModule.SupervisorSla) => renderToStaticMarkup(createElement(result.exports.SupervisorSlaMetric, { sla }));

test("mixed teams show separate units and goals, with genuine missing values", () => {
  const totals = slaModule.emptySupervisorSlaTotals();
  totals.adsMinutesSum = 1210; totals.adsSubmits = 10;
  totals.tnsMinutesSum = 150; totals.tnsSubmits = 10;
  totals.cec.normalTotal = 100; totals.cec.normalOver = 2;
  const html = render(slaModule.finishSupervisorSla(totals, ["ADS", "TNS", "CEC"]));
  for (const text of ["ADS · 02:01", "TNS Vídeo · 00:15", "Normal · 98,00%", "P0 + HM · Sem dados", "Meta ≤ 02:00", "Meta ≤ 00:15", "Meta ≥ 97%", "text-red-700", "text-emerald-700"]) assert.ok(html.includes(text), text);
});
test("teams show only their own LOB and missing data never becomes zero", () => {
  const html = render(slaModule.finishSupervisorSla(slaModule.emptySupervisorSlaTotals(), ["TNS"]));
  assert.ok(html.includes("TNS Vídeo · Sem dados"));
  assert.ok(!html.includes("ADS")); assert.ok(!html.includes("P0 + HM"));
  assert.ok(!html.includes("00:00"));
});
