import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { cecFrtMetrics, emptyCecFrt, type CecFrtDashboard } from "../lib/cec-frt";

// Use the same automatic JSX runtime as Next, including the real shared StatCard.
const localRequire = createRequire(import.meta.url);
const { buildSync } = createRequire(localRequire.resolve("tsx"))("esbuild");
const compiled = buildSync({ entryPoints: [fileURLToPath(new URL("./performance-cec-frt.tsx", import.meta.url))], bundle: true, write: false,
  platform: "node", format: "cjs", packages: "external", jsx: "automatic" }).outputFiles[0].text;
const compiledModule = { exports: {} as { CecOperationalResults: React.ComponentType<{ data: CecFrtDashboard }> } };
new Function("require", "exports", "module", compiled)(localRequire, compiledModule.exports, compiledModule);
const { CecOperationalResults } = compiledModule.exports;

function dashboard(): CecFrtDashboard {
  const summary = cecFrtMetrics({ normalTotal: 100, normalOver: 5, urgentTotal: 80, urgentOver: 8 });
  return { period: { startDate: "2026-09-01", endDate: "2026-09-02" }, view: "daily", canImport: true, dataRange: null, lastImport: null,
    summary, cpd: 37.5, output: 150, agentDays: 4,
    coverage: { rows: 5, unmatchedRows: 1, latestDay: "2026-09-01", latestCpdDay: "2026-09-01" },
    trend: [{ period: "2026-09-01", ...summary, cpd: 37.5, output: 150 }],
    agents: [{ wbLogin: "wb_private", name: "Not an operational dimension", supervisor: "Supervisor private", skill: "CEC", linked: true, ...summary, cpd: 150, output: 150 }],
    supervisors: [{ id: "private", name: "Supervisor private", ...summary }] };
}
test("CEC queue results render operational SLA and CPD instead of agent/supervisor tables", () => {
  const html = renderToStaticMarkup(createElement(CecOperationalResults, { data: dashboard() }));
  for (const label of ["SLA · P0 + HM", "SLA · Normal", "CPD da operação", "Evolução do SLA CEC", "Evolução do CPD CEC", "Indicadores da operação por período", "90%", "95%", "37,5", "02/09/2026", "Sem dados"]) assert.ok(html.includes(label), label);
  for (const removed of ["wb_private", "Supervisor private", "Buscar parceiro", "Parceiros · vínculo atual"]) assert.ok(!html.includes(removed), removed);
});
test("CEC missing sources show empty charts without implying zero or hiding the other metric", () => {
  const data = dashboard();
  data.summary = cecFrtMetrics(emptyCecFrt()); data.trend = []; data.cpd = null; data.output = null; data.agentDays = 0;
  const html = renderToStaticMarkup(createElement(CecOperationalResults, { data }));
  assert.ok(html.includes("Sem dados de SLA para o período selecionado."));
  assert.ok(html.includes("Sem dados de CPD para o período selecionado."));
  assert.ok(!html.includes("0%"));
  data.trend = [{ period: "2026-09-01", ...data.summary, cpd: 50, output: 100 }]; data.cpd = 50;
  const cpdOnly = renderToStaticMarkup(createElement(CecOperationalResults, { data }));
  assert.ok(cpdOnly.includes("Sem dados de SLA para o período selecionado."));
  assert.ok(!cpdOnly.includes("Sem dados de CPD para o período selecionado."));
});
