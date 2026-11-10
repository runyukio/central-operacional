import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { Prisma } from "@prisma/client";
import { qualityIndicatorCountsSql, serializeQualityIndicators, type QualityIndicatorCounts } from "./performance-quality-metrics";
import { readQualityDecisionFields } from "./performance-quality";

test("quality formulas execute against PostgreSQL with distinct cases and independent outcomes", async (t) => {
  const db = new PGlite();
  await db.exec(`CREATE TABLE "QualityRecord" ("caseOrderId" text, "auditCaseOrderId" text, "concatKey" text,
    "finalResult" text, "negativeSign" text, "allowAmount" double precision, "labeledAmount" double precision);`);
  t.after(() => db.close());
  async function insert(qa: string, audit: string, result: string, sign: string | null, allow: number | null, labeled: number | null) {
    await db.query('INSERT INTO "QualityRecord" VALUES ($1,$2,$3,$4,$5,$6,$7)', [qa, audit, qa + audit, result, sign, allow, labeled]);
  }
  async function metrics() {
    const sql = Prisma.sql`SELECT COUNT(DISTINCT q."concatKey")::integer AS total,
      COUNT(DISTINCT CASE WHEN LOWER(TRIM(q."finalResult"))='correct' THEN q."concatKey" END)::integer AS correct,
      ${qualityIndicatorCountsSql} FROM "QualityRecord" q`;
    const result = await db.query<QualityIndicatorCounts>(sql.text, sql.values);
    return serializeQualityIndicators(result.rows[0]);
  }
  await t.test("uses Allow/Labeled flags and deduplicates rows without averaging percentages", async () => {
    await insert("qa1", "a1", "Correct", null, 1, 0);
    await insert("qa2", "a2", "Leakage", null, 1, 0);
    await insert("qa2", "a2", "Leakage", null, 1, 0);
    await insert("qa3", "a3", "False_Positive", null, 0, 1);
    await insert("qa4", "a4", "Mislabeled", null, 0, 1);
    await insert("qa4", "a4", "Correct", null, 0, 1);
    assert.deepEqual(await metrics(), { accuracy: 50, allow: 2, labeled: 2, leakage: 1, falsePositive: 1,
      mislabeled: 1, casesWithDecision: 4, leakageRate: 50, falsePositiveRate: 50, mislabeledRate: 25 });
  });
  await t.test("preserves the reversed key in the supplied False Positive numerator", async () => {
    await db.exec('TRUNCATE "QualityRecord"');
    await insert("1", "23", "False_Positive", "1", null, null);
    await insert("12", "3", "False_Positive", "1", null, null);
    const result = await metrics();
    assert.equal(result.falsePositive, 2);
    assert.equal(result.labeled, 1);
    assert.equal(result.falsePositiveRate, 200);
  });
  await t.test("uses negative_sign when present and does not infer missing decisions from the result", async () => {
    await db.exec('TRUNCATE "QualityRecord"');
    await insert("a", "1", "Leakage", "0", 0, 1);
    assert.equal((await metrics()).allow, 1);
    await insert("b", "2", "Mislabeled", null, null, null);
    const result = await metrics();
    assert.equal(result.allow, null); assert.equal(result.labeled, null);
    assert.equal(result.leakageRate, null); assert.equal(result.falsePositiveRate, null);
    assert.equal(result.mislabeledRate, 50); assert.equal(result.casesWithDecision, 1);
  });
  await t.test("zero denominators and empty periods stay unavailable", async () => {
    await db.exec('TRUNCATE "QualityRecord"');
    assert.equal((await metrics()).accuracy, null);
    await insert("a", "1", "Correct", "1", null, null);
    assert.equal((await metrics()).leakageRate, null);
    assert.equal((await metrics()).falsePositiveRate, 0);
  });
});

test("reads Chinese KAP decision fields, preserving zero and missing values", () => {
  assert.deepEqual(readQualityDecisionFields({ "通过量_Allow_Amount": 0, "打标量_Labeled_Amount": "1" }), { negativeSign: null, allowAmount: 0, labeledAmount: 1 });
  assert.deepEqual(readQualityDecisionFields({ "负向标签_negative_sign": 1 }), { negativeSign: "1", allowAmount: null, labeledAmount: null });
  assert.deepEqual(readQualityDecisionFields({ "Allow Amount": "", "Labeled Amount": -1 }), { negativeSign: null, allowAmount: null, labeledAmount: null });
});
