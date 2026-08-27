import assert from "node:assert/strict";
import test from "node:test";

import { drawUniqueRaffleNumbers, raffleConfirmationText } from "./campaign-raffle-core";

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

test("builds the exact confirmation phrase", () => {
  assert.equal(raffleConfirmationText(42), "DISTRIBUIR 42");
});
