import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const source = ts.createSourceFile("billing-page.tsx", readFileSync(new URL("./billing-page.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const node = source.statements.find((item): item is ts.FunctionDeclaration => ts.isFunctionDeclaration(item) && item.name?.text === "AdjustmentsTable");
assert.ok(node);
const compiled = ts.transpileModule(`const subject = ${node.getText(source)}; subject;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React }
}).outputText;

test("a tabela mantém os ajustes visíveis sem controles de ocultar ou reexibir", () => {
  const icon = () => null;
  const table = vm.runInNewContext(compiled, {
    React,
    Table: ({ rows }: { rows: React.ReactNode[][] }) => React.createElement("div", null, rows.flat()),
    formatCurrency: (value: number) => String(value), Pencil: icon, Trash2: icon
  });
  const html = renderToStaticMarkup(table({
    rows: [{ id: "other", description: "Outro ajuste", employeeName: "Outro parceiro", amount: 2500 }],
    saving: false, onEdit: () => {}, onDelete: () => {}
  }));
  assert.match(html, /Outro ajuste/);
  assert.match(html, /2500/);
  assert.match(html, /Editar/);
  assert.match(html, /Excluir/);
  assert.doesNotMatch(html, /Ocultar|Reexibir|Mostrar ocultos|type="checkbox"/);
});
