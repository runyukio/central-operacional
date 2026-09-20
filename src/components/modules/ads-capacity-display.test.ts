import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { selectCapacityDisplay } from "./ads-capacity-display";

const rows = [
  { date: "2026-09-21", state: "sufficient" as const, capacity: 200 },
  { date: "2026-09-21", state: "deficit" as const, capacity: 50 },
  { date: "2026-09-22", state: "sufficient" as const, capacity: 200 },
  { date: "2026-09-23", state: "incomplete" as const, capacity: 0 },
];
const days = [{date:"2026-09-21",capacity:250},{date:"2026-09-22",capacity:200},{date:"2026-09-23",capacity:0}];
test("deficit filter shows only deficit shifts, retaining the server's daily totals", () => {
  const result = selectCapacityDisplay(rows, days, true);
  assert.deepEqual(result.rows,[rows[1]]);assert.deepEqual(result.days,[days[0]]);
  assert.equal(result.days[0],days[0]);assert.equal(result.deficitDates.size,1);
});
test("a mixed day never brings sufficient or incomplete shifts into the deficit table", () => {
  const mixed = [...rows, {date:"2026-09-21",state:"incomplete" as const,capacity:0}];
  const result = selectCapacityDisplay(mixed,days,true);
  assert.equal(result.rows.length,1);
  assert.ok(result.rows.every(row => row.state === "deficit"));
});
test("incomplete is not a confirmed deficit; empty results and reset preserve data", () => {
  assert.equal(selectCapacityDisplay(rows.slice(2),days,true).rows.length,0);
  const all = selectCapacityDisplay(rows,days,false);assert.equal(all.rows,rows);assert.equal(all.days,days);
  assert.deepEqual(selectCapacityDisplay([],[],true).rows,[]);assert.equal(rows.length,4);
});
test("ADS presentation removes summary cards and uses a wider responsive partner table", () => {
  const source=readFileSync(new URL("./ads-capacity-panel.tsx",import.meta.url),"utf8");
  const css=readFileSync(new URL("./ads-capacity.module.css",import.meta.url),"utf8");
  assert.doesNotMatch(source,/SpaceCard|Parceiros únicos:|Cobertura das bases:|min-w-\[1120px\]/);
  assert.match(source,/max-w-\[1600px\]/);assert.match(source,/Dias com déficit/);
  assert.match(css,/table-layout: fixed/);assert.match(css,/@container \(max-width: 899px\)/);
});
test("display filter belongs to the period and shift form, not the chart", () => {
  const source=readFileSync(new URL("./ads-capacity-panel.tsx",import.meta.url),"utf8");
  const form=source.slice(source.indexOf("<form "),source.indexOf("</form>"));
  assert.match(form,/label="Turno"/);
  assert.match(form,/label="Exibir"/);
  assert.equal(source.match(/label="Exibir"/g)?.length,1);
  assert.doesNotMatch(source.slice(source.indexOf("</form>")),/label="Exibir"/);
});
