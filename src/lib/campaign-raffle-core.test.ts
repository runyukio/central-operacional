import assert from "node:assert/strict";
import test from "node:test";

import { drawUniqueRaffleNumbers, isRaffleEligibleLob } from "./campaign-raffle-core";

test("raffle eligibility accepts only ADS and PROJECT, including normalized names", () => {
  for (const lob of ["ADS", "PROJECT", " ads ", "project"]) assert.equal(isRaffleEligibleLob(lob), true, lob);
  for (const lob of ["CEC", "VIDEO", "COMMENTS", "ALL", "PROJECT MINOR", "ADS/PROJECT", "", null, undefined]) {
    assert.equal(isRaffleEligibleLob(lob), false, String(lob));
  }
});

test("draws only unused numbers without duplicates", () => {
  const drawn = drawUniqueRaffleNumbers({
    min: 1,
    max: 10,
    usedNumbers: [1, 3, 5],
    count: 5,
    nextIndex: () => 0
  });
  assert.equal(new Set(drawn).size, 5);
  assert.ok(drawn.every((number) => number >= 1 && number <= 10));
  assert.ok(drawn.every((number) => ![1, 3, 5].includes(number)));
});

test("rejects a request larger than the available pool", () => {
  assert.throws(() => drawUniqueRaffleNumbers({
    min: 1,
    max: 3,
    usedNumbers: [1, 2],
    count: 2,
    nextIndex: () => 0
  }), /apenas 1 tickets disponíveis/);
});
