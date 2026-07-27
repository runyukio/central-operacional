import assert from "node:assert/strict";
import test from "node:test";

import { workHourBalanceStatus } from "./work-hours-rules";

test("classifica o saldo diário em relação às oito horas planejadas", () => {
  assert.equal(workHourBalanceStatus(8, 1), "Hora extra");
  assert.equal(workHourBalanceStatus(8, 0), "OK");
  assert.equal(workHourBalanceStatus(8, -1), "Horas pendentes");
});

test("preserva o status sem cronograma quando não há horas planejadas", () => {
  assert.equal(workHourBalanceStatus(0, 0), "Sem cronograma");
  assert.equal(workHourBalanceStatus(null, null), "Sem cronograma");
});
