import assert from "node:assert/strict";
import test from "node:test";

import {
  isSecurityQuestionCode,
  normalizeSecurityAnswer,
  securityQuestionLabel,
  validateSecurityAnswer
} from "./security-question";

test("normaliza a resposta sem diferenciar caixa, espaços repetidos ou Unicode compatível", () => {
  assert.equal(normalizeSecurityAnswer("  Minha   RESPOSTA  "), "minha resposta");
  assert.equal(normalizeSecurityAnswer("Ａgente Secreto"), "agente secreto");
});

test("aceita somente perguntas pré-definidas", () => {
  assert.equal(isSecurityQuestionCode("SECRET_PHRASE"), true);
  assert.equal(isSecurityQuestionCode("QUESTION_FROM_CLIENT"), false);
  assert.match(securityQuestionLabel("CHILDHOOD_OBJECT"), /objeto/i);
});

test("aceita respostas curtas e rejeita somente valores vazios ou acima do limite", () => {
  assert.match(validateSecurityAnswer("   "), /Informe a resposta/);
  assert.equal(validateSecurityAnswer("a"), "");
  assert.equal(validateSecurityAnswer("resposta segura"), "");
  assert.match(validateSecurityAnswer("x".repeat(129)), /128 caracteres/);
});
