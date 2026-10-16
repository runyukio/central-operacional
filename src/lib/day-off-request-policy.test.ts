import assert from "node:assert/strict";
import test from "node:test";
import { validateDayOffRequestPolicy } from "./day-off-request-policy";

for (const month of ["10", "11"]) {
  for (const kind of ["PAIRED_DAY_OFF_SWAP", "DAY_OFF_SWAP", "DAY_OFF_SELL", "DAY_OFF_REQUEST"]) {
    test(`${kind}: ${month}/2026 follows the monthly availability`, () => {
      const result = validateDayOffRequestPolicy({
        dayOffKind: kind,
        currentDayOffDate: `2026-${month}-20`,
        desiredDayOffDate: `2026-${month}-21`,
        dayOffToSellDate: `2026-${month}-20`,
        desiredDayOffRequestDate: `2026-${month}-21`
      });
      const enabled = month === "10" || kind === "PAIRED_DAY_OFF_SWAP" || kind === "DAY_OFF_SELL";
      assert.equal(result === "", enabled);
    });
  }
}

test("simple swaps cannot move an October day off into November", () => {
  assert.match(validateDayOffRequestPolicy({ type: "Troca de Folga", currentDayOffDate: "2026-10-31", desiredDayOffDate: "2026-11-01" }), /apenas para datas de outubro/);
});

test("paired swaps can include dates from both available months", () => {
  assert.equal(validateDayOffRequestPolicy({ type: "Troca Casada", currentDayOffDate: "2026-10-31", desiredDayOffDate: "2026-11-01" }), "");
});

test("day off requests use the same fallback target dates as the service", () => {
  assert.equal(validateDayOffRequestPolicy({ type: "Solicitação de Dia de Folga", requestedDate: "2026-10-31" }), "");
  assert.match(validateDayOffRequestPolicy({ type: "Solicitação de Dia de Folga", desiredDayOffDate: "2026-11-01" }), /apenas para datas de outubro/);
});

test("unrelated requests keep their availability", () => {
  assert.equal(validateDayOffRequestPolicy({ type: "Troca de Turno", requestedDate: "2026-12-01" }), "");
});
