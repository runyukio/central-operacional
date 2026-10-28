import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const localRequire = createRequire(import.meta.url);
const compiled = ts.transpileModule(readFileSync(new URL("./performance-supervisor-agents.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
}).outputText;
const result = { exports: {} as Record<string, React.ComponentType<any>> };
const number = (value: number | null | undefined, suffix = "") => value == null ? "Sem dados" : `${value}${suffix}`;
const dependencies: Record<string, unknown> = { "./meu-espaco/shared": { number, tableClass: "table" },
  "./meu-espaco/sort-header": { SpaceSortHeader: ({ label }: { label: string }) => createElement("th", null, label) } };
new Function("require", "exports", "module", compiled)((id: string) => dependencies[id] ?? localRequire(id), result.exports, result);

test("agent detail renders all requested metrics, units, coverage and genuine missing values", () => {
  const metric = { abs: 5, ahtSeconds: 50, cpd: 120, quality: 95 };
  const work = { adherenceRate: 87.5, lateRate: 10, earlyRate: 5, officialOvertimeHours: 1.5,
    recordedDays: 8, expectedDays: 10, lateEntries: 1, observedEntries: 10, earlyExits: 1, observedExits: 20 };
  const data = { supervisor: "Supervisor de teste", period: { startDate: "2026-10-01", endDate: "2026-10-28" }, workWarnings: [], agents: [
    { id: "a", name: "Agente ADS", wbLogin: "wb_a", skill: "Material", lob: "ADS", metric, work, moodAverage: 4, moodResponses: 2 },
    { id: "b", name: "Agente CEC", wbLogin: "wb_b", skill: "CEC", lob: "CEC", metric, work: { ...work, lateRate: null }, moodAverage: null, moodResponses: 0 }
  ] };
  const html = renderToStaticMarkup(createElement(result.exports.SupervisorAgentsTable, { data }));
  for (const label of ["ABS", "Humor", "AHT / CPD", "Qualidade", "Aderência de horas · 8h", "Taxa de atraso", "Taxa de saída antecipada", "Hora extra"]) assert.ok(html.includes(label), label);
  for (const value of ["50 s", "120 CPD", "87.5%", "1:30", "8/10 dias com horas", "1/10 entradas observadas", "Sem dados"]) assert.ok(html.includes(value), value);
});
