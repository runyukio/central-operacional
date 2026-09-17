import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { scheduleDisplayLabel } from "../lib/schedule-display-label";

// Exercise the real rendering functions without loading unrelated page services.
function loadFunction(path: string, name: string) {
  const source = ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, name);
  const compiled = ts.transpileModule(`${declaration.getText(source)}\nexport { ${name} };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
  }).outputText;
  const mod = { exports: {} as Record<string, any> };
  new Function("require", "exports", "module", "cn", "scheduleDisplayLabel", compiled)(
    createRequire(import.meta.url), mod.exports, mod, (...values: unknown[]) => values.filter(Boolean).join(" "), scheduleDisplayLabel
  );
  return mod.exports[name];
}

test("schedule dropdown displays new wording but submits the existing status/reason", () => {
  const FormSelect = loadFunction("./modules/shared.tsx", "FormSelect");
  for (const value of ["Escalado", "Erro de programação de escala", "Erro de visualização de escala"]) {
    const html = renderToStaticMarkup(createElement(FormSelect, {
      label: "Cronograma", value, options: [value], onChange: () => assert.fail("Rendering must not change data")
    }));
    assert.ok(html.includes(`value="${value}" selected="">${scheduleDisplayLabel(value)}</option>`), html);
  }
});

test("status badges and calendar cells display cronograma, including zero-data statuses", () => {
  const StatusBadge = loadFunction("./ui/primitives.tsx", "StatusBadge");
  const cellLabel = loadFunction("./modules/schedules-page.tsx", "scheduleSlotDisplayLabel");
  for (const status of ["Escalado", "Sem escala", "Erro de escala"]) {
    const html = renderToStaticMarkup(createElement(StatusBadge, { status }));
    assert.ok(html.includes(scheduleDisplayLabel(status)), html);
    assert.ok(!html.includes(status), html);
    assert.equal(cellLabel(status), scheduleDisplayLabel(status));
  }
  assert.equal(cellLabel("Falta Justificada"), "Falta Just.");
  assert.equal(cellLabel("Nesting"), "Nesting");
});
