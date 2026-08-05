import assert from "node:assert/strict";
import test from "node:test";

import {
  isRealtimeActiveEmployeeStatus,
  matchesRealtimeEmployeeStatus
} from "./realtime-employee-status";

test("considera Ativo, Active e Nesting como status ativos no Real Time", () => {
  assert.equal(isRealtimeActiveEmployeeStatus("Ativo"), true);
  assert.equal(isRealtimeActiveEmployeeStatus("ACTIVE"), true);
  assert.equal(isRealtimeActiveEmployeeStatus(" Nesting "), true);
});

test("mantém treinamento e status inativos fora do filtro Ativo", () => {
  assert.equal(matchesRealtimeEmployeeStatus("Nesting", "Ativo"), true);
  assert.equal(matchesRealtimeEmployeeStatus("Em treinamento", "Ativo"), false);
  assert.equal(matchesRealtimeEmployeeStatus("Inativo", "Ativo"), false);
  assert.equal(matchesRealtimeEmployeeStatus("Desligado", "Ativo"), false);
});

test("preserva o filtro específico de status", () => {
  assert.equal(matchesRealtimeEmployeeStatus("Nesting", "Nesting"), true);
  assert.equal(matchesRealtimeEmployeeStatus("Ativo", "Nesting"), false);
});
