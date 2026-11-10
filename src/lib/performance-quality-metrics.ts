import { Prisma } from "@prisma/client";
import type { QualityIndicators } from "@/lib/performance-quality";

export type QualityIndicatorCounts = {
  total: number;
  correct: number;
  allow?: number;
  labeled?: number;
  leakage?: number;
  falsePositive?: number;
  mislabeled?: number;
  casesWithDecision?: number;
};

// Reused in summary, trend and agent queries. Outcomes are counted independently,
// and False Positive deliberately uses the reversed key in the supplied formula.
export const qualityIndicatorCountsSql = Prisma.sql`
  COUNT(DISTINCT CASE WHEN LOWER(TRIM(q."finalResult")) = 'mislabeled' THEN q."concatKey" END)::integer AS "mislabeled",
  COUNT(DISTINCT CASE WHEN LOWER(TRIM(q."finalResult")) = 'leakage' THEN q."concatKey" END)::integer AS "leakage",
  COUNT(DISTINCT CASE WHEN LOWER(TRIM(q."finalResult")) = 'false_positive' THEN CONCAT(q."auditCaseOrderId", q."caseOrderId") END)::integer AS "falsePositive",
  COUNT(DISTINCT CASE WHEN q."negativeSign" <> '1' OR (q."negativeSign" IS NULL AND q."allowAmount" > 0) THEN q."concatKey" END)::integer AS "allow",
  COUNT(DISTINCT CASE WHEN q."negativeSign" = '1' OR (q."negativeSign" IS NULL AND q."labeledAmount" > 0) THEN q."concatKey" END)::integer AS "labeled",
  COUNT(DISTINCT CASE WHEN q."negativeSign" IS NOT NULL OR (q."allowAmount" IS NOT NULL AND q."labeledAmount" IS NOT NULL) THEN q."concatKey" END)::integer AS "casesWithDecision"
`;

export function serializeQualityIndicators(counts: QualityIndicatorCounts): QualityIndicators {
  const total = Number(counts.total ?? 0);
  const casesWithDecision = Number(counts.casesWithDecision ?? 0);
  const complete = total > 0 && casesWithDecision === total;
  const allow = complete ? Number(counts.allow ?? 0) : null;
  const labeled = complete ? Number(counts.labeled ?? 0) : null;
  const leakage = Number(counts.leakage ?? 0);
  const falsePositive = Number(counts.falsePositive ?? 0);
  const mislabeled = Number(counts.mislabeled ?? 0);
  const percent = (numerator: number, denominator: number | null) => denominator ? numerator / denominator * 100 : null;
  return { accuracy: percent(Number(counts.correct ?? 0), total), allow, labeled,
    leakage, falsePositive, mislabeled, casesWithDecision,
    leakageRate: percent(leakage, allow), falsePositiveRate: percent(falsePositive, labeled), mislabeledRate: percent(mislabeled, total) };
}
