import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const localRequire = createRequire(import.meta.url);
const compiled = ts.transpileModule(readFileSync(new URL("./shared.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
}).outputText;
const result = { exports: {} as Record<string, ComponentType<any>> };
const primitives = {
  EmptyState: () => createElement("div"),
  MetricPill: ({ label, value }: { label: string; value: string }) => createElement("div", null, label, value)
};
new Function("require", "exports", "module", compiled)((id: string) => id === "@/components/ui/primitives" ? primitives : localRequire(id), result.exports, result);

function render(status: string, canConclude?: boolean, canWfmFinal = false) {
  return renderToStaticMarkup(createElement(result.exports.RequestDetailContent, {
    selected: { id: "REQ-TEST", type: "Troca Casada", status, requester: "Solicitante", priority: "Média", area: "WFM", time: "", canConclude, canWfmFinal, payload: { internalType: "PAIRED_DAY_OFF_SWAP", stage: "DONE", scheduleApplicationStatus: "APPLIED" } },
    actorRole: "ADMIN", actionReason: "", setActionReason() {}, comment: "", setComment() {}, onMove() {}, onComment() {}
  }));
}

test("approved paired swaps expose Concluir independently of final approval permission", () => {
  assert.match(render("Aprovado", true), />Concluir<\/button>/);
  assert.doesNotMatch(render("Aprovado", false), />Concluir<\/button>/);
  assert.doesNotMatch(render("Concluído", true), />Concluir<\/button>/);
  assert.doesNotMatch(render("Em análise", true), />Concluir<\/button>/);
});

test("explicit completion denial wins over legacy approval permission", () => {
  assert.doesNotMatch(render("Aprovado", false, true), />Concluir<\/button>/);
  assert.match(render("Aprovado", undefined, true), />Concluir<\/button>/);
});
