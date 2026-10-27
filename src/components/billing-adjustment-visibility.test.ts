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

test("a lista oculta por padrão, permite consultar ocultos e reexibir a linha correta", () => {
  let showHidden = false;
  let tableRows: React.ReactNode[][] = [];
  const rows = [
    { id: "ana", description: "Ajuste da Ana", employeeName: "Ana Paula", amount: 2500, hidden: true },
    { id: "other", description: "Outro ajuste", employeeName: "Outro parceiro", amount: 100, hidden: false }
  ];
  const toggled: unknown[] = [];
  const icon = () => null;
  const table = vm.runInNewContext(compiled, {
    React,
    useState: () => [showHidden, (value: boolean) => { showHidden = value; }],
    Table: ({ rows: value }: { rows: React.ReactNode[][] }) => { tableRows = value; return React.createElement("div", null, value.flat()); },
    formatCurrency: (value: number) => String(value), Eye: icon, EyeOff: icon, Pencil: icon, Trash2: icon
  });
  const render = () => table({ rows, saving: false, onEdit: () => {}, onDelete: () => {}, onToggleVisibility: (row: unknown) => toggled.push(row) });
  const tree = render();
  const html = renderToStaticMarkup(tree);
  assert.doesNotMatch(html, /Ajuste da Ana/);
  assert.match(html, /Outro ajuste/);
  assert.match(html, /Mostrar ocultos \(1\)/);
  const input = tree.props.children[0].props.children[1].props.children[0];
  input.props.onChange({ target: { checked: true } });
  const shownHtml = renderToStaticMarkup(render());
  assert.match(shownHtml, /Ajuste da Ana/);
  assert.match(shownHtml, /Oculto/);
  assert.match(shownHtml, /Reexibir/);
  const actions = tableRows[0][8] as React.ReactElement<any>;
  actions.props.children[0].props.onClick();
  assert.equal(toggled[0], rows[0]);
  rows[0].hidden = false;
  showHidden = false;
  assert.match(renderToStaticMarkup(render()), /Ajuste da Ana/);
});
