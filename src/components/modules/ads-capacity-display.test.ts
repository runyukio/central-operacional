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
test("deficit days retain every shift and the server's daily totals", () => {
  const result = selectCapacityDisplay(rows, days, true);
  assert.deepEqual(result.rows,rows.slice(0,2));assert.deepEqual(result.days,[days[0]]);
  assert.equal(result.days[0],days[0]);assert.equal(result.deficitDates.size,1);
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
