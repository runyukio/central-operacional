export type CecQualityAggregate = {
  correct: number;
  total: number;
  errors: number;
  quality: number;
};

export function calculateCecQualityAggregate(passQuantity: number, failQuantity: number): CecQualityAggregate {
  const pass = finiteNumber(passQuantity);
  const fail = finiteNumber(failQuantity);
  const total = pass + fail;

  return {
    correct: pass,
    total,
    errors: fail,
    quality: total > 0 ? round2((1 - fail / total) * 100) : 0
  };
}

function finiteNumber(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function round2(value: number) {
  return Number(value.toFixed(2));
}
