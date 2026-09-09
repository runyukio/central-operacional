import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { assessSpaceTarget, spaceTargets, type SpaceKpi } from "../../lib/meu-espaco-targets";

const localRequire = createRequire(import.meta.url);
const source = readFileSync(new URL("./target-card.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const result = { exports: {} as Record<string, ComponentType<{ kpi: SpaceKpi }>> };
const dependencies: Record<string, unknown> = {
  "./space.module.css": { default: {} },
  "./shared": { number: (n: number | null) => n === null ? "Sem dados" : n.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) }
};
new Function("require", "exports", "module", compiled)((id: string) => dependencies[id] ?? localRequire(id), result.exports, result);
const html = (name: string, kpi: SpaceKpi) => renderToStaticMarkup(createElement(result.exports[name], { kpi }));
const target = spaceTargets("ADS").find((row) => row.id === "quality")!;

test("target badges have distinct statuses plus text and icons, including missing data", () => {
  for (const [weight, status, label] of [[{ numerator: 96, denominator: 100 }, "met", "Meta atingida"], [{ numerator: 94, denominator: 100 }, "missed", "Fora da meta"], [undefined, "missing", "Sem dados"]] as const) {
    const markup = html("SpaceTargetBadge", assessSpaceTarget(target, weight));
    assert.match(markup, new RegExp(`data-status="${status}"`));
    assert.ok(markup.includes(label)); assert.match(markup, /<svg/);
  }
});
test("partner comparisons keep percentage-point deltas and unrounded status", () => {
  const markup = html("SpaceTargetInline", assessSpaceTarget(target, { numerator: 94999, denominator: 100000 }));
  assert.match(markup, /data-status="missed"/);
  assert.match(markup, /Meta ≥95%/);
  assert.match(markup, /Δ −&lt;0,01 p.p./);
  assert.match(html("SpaceTargetInline", assessSpaceTarget(target, { numerator: 97, denominator: 100 })), /Δ \+2 p.p./);
});
test("maximum goals reverse the success direction without reversing delta semantics", () => {
  const aht = spaceTargets("ADS").find((row) => row.id === "aht")!;
  const markup = html("SpaceTargetInline", assessSpaceTarget(aht, { numerator: 5500, denominator: 100 }));
  assert.match(markup, /data-status="met"/); assert.match(markup, /Meta ≤60 s/); assert.match(markup, /Δ −5 s/);
});
