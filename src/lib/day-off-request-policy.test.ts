import assert from "node:assert/strict";
import test from "node:test";
import { validateDayOffRequestPolicy } from "./day-off-request-policy";

for (const month of Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0"))) {
  for (const kind of ["PAIRED_DAY_OFF_SWAP", "DAY_OFF_SWAP", "DAY_OFF_SELL", "DAY_OFF_REQUEST"]) {
    test(`${kind}: ${month}/2026 accepts valid dates`, () => {
      const result = validateDayOffRequestPolicy({
        dayOffKind: kind,
        currentDayOffDate: `2026-${month}-20`,
        desiredDayOffDate: `2026-${month}-21`,
        dayOffToSellDate: `2026-${month}-20`,
        desiredDayOffRequestDate: `2026-${month}-21`
      });
      assert.equal(result, "");
    });
  }
}

test("simple swaps can move an October day off into November", () => {
  assert.equal(validateDayOffRequestPolicy({ type: "Troca de Folga", currentDayOffDate: "2026-10-31", desiredDayOffDate: "2026-11-01" }), "");
});

test("paired swaps can include dates from different months", () => {
  assert.equal(validateDayOffRequestPolicy({ type: "Troca Casada", currentDayOffDate: "2026-10-31", desiredDayOffDate: "2026-11-01" }), "");
});

test("day off requests use the same fallback target dates as the service", () => {
  assert.equal(validateDayOffRequestPolicy({ type: "Solicitação de Dia de Folga", requestedDate: "2026-10-31" }), "");
  assert.equal(validateDayOffRequestPolicy({ type: "Solicitação de Dia de Folga", desiredDayOffDate: "2026-11-01" }), "");
});

test("unrelated requests keep their availability", () => {
  assert.equal(validateDayOffRequestPolicy({ type: "Troca de Turno", requestedDate: "2026-12-01" }), "");
});

for (const kind of ["PAIRED_DAY_OFF_SWAP", "DAY_OFF_SWAP", "DAY_OFF_SELL", "DAY_OFF_REQUEST"]) {
  test(`${kind}: future years and cross-year dates are available`, () => {
    assert.equal(validateDayOffRequestPolicy({ dayOffKind: kind, currentDayOffDate: "2027-12-31", desiredDayOffDate: "2028-01-02", dayOffToSellDate: "2028-02-29", desiredDayOffRequestDate: "2028-02-29" }), "");
  });
}
