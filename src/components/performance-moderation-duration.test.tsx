import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const compiled = ts.transpileModule(readFileSync(new URL("./performance-moderation-duration.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
}).outputText;
const localRequire = createRequire(import.meta.url);
const compiledModule = { exports: {} as Record<string, React.ComponentType<any>> };
new Function("require", "exports", "module", compiled)(localRequire, compiledModule.exports, compiledModule);
const cell = (value?: unknown) => renderToStaticMarkup(createElement(compiledModule.exports.ModerationDurationCell, { value }));

test("shows recorded zero, missing data and accumulated hours as received from the backend", () => {
  assert.ok(cell().includes("Sem dados"));
  assert.ok(cell({ seconds: 0, duration: "00:00:00", byShiftDate: [] }).includes("00:00:00"));
  assert.ok(cell({ seconds: 90000, duration: "25:00:00", byShiftDate: [] }).includes("25:00:00"));
});

test("exposes one duration per Shift Date without recomputing source rows in the browser", () => {
  const html = cell({ seconds: 10800, duration: "03:00:00", byShiftDate: [
    { employeeId: "a", shiftDate: "2026-10-26", seconds: 3600, duration: "01:00:00" },
    { employeeId: "a", shiftDate: "2026-10-27", seconds: 7200, duration: "02:00:00" },
    { employeeId: "a", shiftDate: "2026-10-28", seconds: null, duration: "Sem dados" }
  ] });
  for (const value of ["03:00:00","01:00:00","02:00:00","Sem dados","26/10/2026","27/10/2026","28/10/2026"]) assert.ok(html.includes(value), value);
  assert.match(html, /<details/);
  assert.match(html, /<summary[^>]*aria-label=/);
});

test("a single night shift displays its start date alongside the duration", () => {
  const html = cell({ seconds: 10800, duration: "03:00:00", byShiftDate: [
    { employeeId: "a", shiftDate: "2026-10-26", seconds: 10800, duration: "03:00:00" }
  ] });
  assert.ok(html.includes("Shift Date 26/10/2026"));
  assert.match(html, /datetime="2026-10-26"/i);
  assert.ok(!html.includes("<details"));
});
