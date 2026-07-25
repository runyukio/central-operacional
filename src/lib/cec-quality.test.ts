import assert from "node:assert/strict";
import test from "node:test";

import { calculateCecQualityAggregate } from "./cec-quality";
import { buildCecQualitySnapshotPromotionSql, normalizeExcelDate } from "./performance-service";

test("calcula o total CEC como Pass + Fail e a qualidade como 1 - Fail / Total", () => {
  assert.deepEqual(calculateCecQualityAggregate(13, 1), {
    correct: 13,
    total: 14,
    errors: 1,
    quality: 92.86
  });
});

test("mantém a qualidade entre zero e cem quando Fail supera Pass", () => {
  assert.deepEqual(calculateCecQualityAggregate(5, 10), {
    correct: 5,
    total: 15,
    errors: 10,
    quality: 33.33
  });
});

test("usa Fail no total quando não há Pass Quantity", () => {
  assert.deepEqual(calculateCecQualityAggregate(0, 4), {
    correct: 0,
    total: 4,
    errors: 4,
    quality: 0
  });
});

test("não divide por zero quando não há avaliações", () => {
  assert.deepEqual(calculateCecQualityAggregate(0, 0), {
    correct: 0,
    total: 0,
    errors: 0,
    quality: 0
  });
});

test("normaliza os três formatos de data encontrados na base CEC", () => {
  assert.equal(normalizeExcelDate("2026.06.29")?.toISOString().slice(0, 10), "2026-06-29");
  assert.equal(normalizeExcelDate("20.05.2026")?.toISOString().slice(0, 10), "2026-05-20");
  assert.equal(normalizeExcelDate(46205)?.toISOString().slice(0, 10), "2026-07-02");
});

test("corrige o ano 12026 exportado na base CEC", () => {
  assert.equal(normalizeExcelDate("12026/4/17")?.toISOString().slice(0, 10), "2026-04-17");
  assert.equal(normalizeExcelDate("12026/4/20")?.toISOString().slice(0, 10), "2026-04-20");
});

test("rejeita anos fora da janela operacional", () => {
  assert.equal(normalizeExcelDate("22026/4/17"), null);
});

test("promove o snapshot CEC usando deslocamento compatível com PostgreSQL", () => {
  const query = buildCecQualitySnapshotPromotionSql("batch-123");
  assert.match(query.sql, /SUBSTRING\("wbLogin" FROM CAST\(\? AS integer\)\)/);
  assert.deepEqual(query.values, [25, "batch-123", "__cec_stage__batch-123::%"]);
});
