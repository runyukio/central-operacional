export type CecQualityAggregate = {
  correct: number;
  total: number;
  errors: number;
  quality: number;
};

export function calculateCecQualityAggregate(passQuantity: number, failQuantity: number): CecQualityAggregate {
  const pass = finiteNumber(passQuantity);
  const fail = finiteNumber(failQuantity);
  const correct = pass - fail;

  return {
    correct,
    total: pass,
    errors: fail,
    quality: pass > 0 ? round2((1 - fail / pass) * 100) : 0
  };
}

function finiteNumber(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function round2(value: number) {
  return Number(value.toFixed(2));
}
