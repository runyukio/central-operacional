import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { formatMinutesToHHMM } from "../../lib/work-hours-rules";
import * as absenceNotice from "../../lib/absence-notice";
import { AbsenceNoticeField } from "../absence-notice-field";

const localRequire = createRequire(import.meta.url);
const source = readFileSync(new URL("./pendencias.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(`${source}\nexport { PendingDetail };`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
}).outputText;
const compiledModule = { exports: {} as { PendingDetail: React.ComponentType<any> } };
const dependencies: Record<string, unknown> = {
  "./space.module.css": { default: {} },
  "./requerido": { SpaceCoveragePanel: () => null },
  "@/components/modules/shared": { apiJson: () => { throw new Error("Rendering must not write data"); }, FormInput: () => null },
  "@/lib/absence-reasons": { officialAbsenceReasons: [] },
  "@/lib/meu-espaco-feed": {},
  "@/lib/work-hours-rules": { formatMinutesToHHMM },
  "@/lib/absence-notice": absenceNotice,
  "@/components/absence-notice-field": { AbsenceNoticeField },
  "./shared": { useSpaceRead: () => ({ data: { history: [] }, loading: false, error: "" }), SpaceLoad: () => null }
};
new Function("require", "exports", "module", compiled)((name: string) => dependencies[name] ?? localRequire(name), compiledModule.exports, compiledModule);

test("absence requires an explicit Sim or Não, neither is preselected on a new justification", () => {
  const row = { id: "absence", kind: "absence", status: "FALTA", pending: true, evidenceUrl: "", notifiedWithin48h: null };
  const html = renderToStaticMarkup(createElement(compiledModule.exports.PendingDetail, { row, supervisorId: "sup", canRespond: true, onAnswered: () => {} }));
  assert.match(html, /Foi avisado dentro de 48h\?/);
  assert.equal((html.match(/type="radio"/g) || []).length, 2);
  assert.equal((html.match(/required=""/g) || []).length >= 2, true);
  assert.doesNotMatch(html, /checked=""/);
});

for (const [value, expected] of [[true, "Sim"], [false, "Não"], [null, "Não informado"]] as const) {
  test(`answered absence displays ${expected} in consultation`, () => {
    const row = { id: "absence", kind: "absence", status: "FALTA_JUSTIFICADA", pending: false, evidenceUrl: "", notifiedWithin48h: value };
    const html = renderToStaticMarkup(createElement(compiledModule.exports.PendingDetail, { row, supervisorId: "sup", canRespond: false, onAnswered: () => {} }));
    assert.match(html, new RegExp(`Aviso dentro de 48h: ${expected}`));
    assert.doesNotMatch(html, /type="radio"/);
  });
}

test("hours, overtime and schedule errors keep their existing forms without notice assessment", () => {
  for (const [kind, status] of [["hours", "PENDING"], ["overtime", "PENDING"], ["absence", "ERRO_ESCALA"]]) {
    const row = { id: "other", kind, status, pending: true, evidenceUrl: "" };
    const html = renderToStaticMarkup(createElement(compiledModule.exports.PendingDetail, { row, supervisorId: "sup", canRespond: true, onAnswered: () => {} }));
    assert.doesNotMatch(html, /Foi avisado dentro de 48h|Aviso dentro de 48h/);
  }
});

test("occurrence capture renders HH:mm with the existing rounding, without changing stored minutes", () => {
  for (const [minutes, expected] of [[411.92, "06:52"], [0, "00:00"], [5, "00:05"], [59.99, "01:00"], [480, "08:00"], [1500, "25:00"], [null, "Sem dados"]] as const) {
    const row = Object.freeze({ id: "test", kind: "hours", reason: "VIDEO", plannedStart: "08:00", plannedEnd: "17:00", capturedMinutes: minutes, pending: true, evidenceUrl: "" });
    const html = renderToStaticMarkup(createElement(compiledModule.exports.PendingDetail, { row, supervisorId: "supervisor", canRespond: false, onAnswered: () => {} }));
    assert.ok(html.includes(`Captura na ocorrência: ${expected}`), html);
    assert.ok(html.includes("Previsto: 08:00–17:00"));
    assert.ok(!html.includes(" min"));
    assert.equal(row.capturedMinutes, minutes);
  }
});

test("absence occurrences do not gain a captured-hours field", () => {
  const html = renderToStaticMarkup(createElement(compiledModule.exports.PendingDetail, { row: { id: "absence", kind: "absence", pending: true, evidenceUrl: "" }, supervisorId: "supervisor", canRespond: false, onAnswered: () => {} }));
  assert.ok(!html.includes("Captura na ocorrência"));
});

test("excedente mostra cálculo, 8h contabilizadas e botões de decisão só para quem pode responder", () => {
  const row = { id: "review", kind: "overtime", pending: true, status: "PENDING", version: 1,
    ruleLabel: "Demais agentes: captura + 0:30", capturedMinutes: 510, calculatedHours: 9,
    effectiveHours: 8, excessHours: 1, plannedStart: "23:00", plannedEnd: "08:00", evidenceUrl: "" };
  for (const canRespond of [true, false]) {
    const html = renderToStaticMarkup(createElement(compiledModule.exports.PendingDetail, { row, supervisorId: "sup", canRespond, onAnswered: () => {} }));
    assert.ok(html.includes("Total calculado: 9:00")); assert.ok(html.includes("Horas contabilizadas: 8:00"));
    assert.ok(html.includes("Horas em validação: 1:00"));
    assert.equal(html.includes("Aprovar excedente"), canRespond); assert.equal(html.includes("Recusar excedente"), canRespond);
    assert.ok(!html.includes("Enviar justificativa"));
  }
  const html = renderToStaticMarkup(createElement(compiledModule.exports.PendingDetail, { row: { ...row, pending: false, status: "REJECTED", justification: "Sessão indevida" }, supervisorId: "sup", canRespond: true, onAnswered: () => {} }));
  assert.ok(html.includes("Excedente recusado")); assert.ok(html.includes("Sessão indevida")); assert.ok(!html.includes("Aprovar excedente"));
});
