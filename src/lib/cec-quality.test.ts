import assert from "node:assert/strict";
import test from "node:test";

import { calculateCecQualityAggregate } from "./cec-quality";
import { normalizeExcelDate } from "./performance-service";

test("calcula a qualidade CEC como 1 - Fail Quantity / Pass Quantity", () => {
  assert.deepEqual(calculateCecQualityAggregate(100, 7), {
    correct: 93,
    total: 100,
    errors: 7,
    quality: 93
  });
});

test("preserva resultado negativo quando Fail Quantity supera Pass Quantity", () => {
  assert.deepEqual(calculateCecQualityAggregate(5, 10), {
    correct: -5,
    total: 5,
    errors: 10,
    quality: -100
  });
});

test("não divide por zero quando não há Pass Quantity", () => {
  assert.deepEqual(calculateCecQualityAggregate(0, 4), {
    correct: -4,
    total: 0,
    errors: 4,
    quality: 0
  });
});

test("normaliza os três formatos de data encontrados na base CEC", () => {
  assert.equal(normalizeExcelDate("2026.06.29")?.toISOString().slice(0, 10), "2026-06-29");
  assert.equal(normalizeExcelDate("20.05.2026")?.toISOString().slice(0, 10), "2026-05-20");
  assert.equal(normalizeExcelDate(46205)?.toISOString().slice(0, 10), "2026-07-02");
});
