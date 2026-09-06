import assert from "node:assert/strict";
import test from "node:test";

import bcrypt from "bcryptjs";

import type { Actor } from "./mock-db";
import {
  getOwnSecurityQuestion,
  nextPasswordRecoveryRateState,
  passwordRecoveryData,
  recoverPasswordWithSecurityQuestion,
  saveOwnSecurityQuestion
} from "./password-recovery-service";

const actor: Actor = { email: "AGENT@example.com", name: "Agent", role: "COLABORADOR" };
const validRecovery = {
  email: "agent@example.com",
  wbLogin: "wb_agent",
  question: "SECRET_PHRASE",
  answer: "Minha resposta",
  newPassword: "senha-nova-segura",
  confirmPassword: "senha-nova-segura"
};

type RecoveryDataMock = {
  findOwnUser: (...args: never[]) => unknown;
  findRecoveryUser: (...args: never[]) => unknown;
  saveSecurityQuestion: (...args: never[]) => unknown;
  consumeRateLimit: (...args: never[]) => unknown;
  cleanupRateLimits: (...args: never[]) => unknown;
  verifyExternalPassword: (...args: never[]) => unknown;
  updateExternalPassword: (...args: never[]) => unknown;
  updateLocalPassword: (...args: never[]) => unknown;
};

const recoveryData = passwordRecoveryData as unknown as RecoveryDataMock;
const originals = { ...recoveryData };

test.afterEach(() => {
  Object.assign(recoveryData, originals);
});

test("bloqueia no limite e libera uma nova janela depois de 15 minutos", () => {
  const start = new Date("2026-09-04T12:00:00.000Z");
  let state = nextPasswordRecoveryRateState(null, start, 3);
  assert.equal(state.allowed, true);
  state = nextPasswordRecoveryRateState(state, new Date(start.getTime() + 1_000), 3);
  assert.equal(state.allowed, true);
  state = nextPasswordRecoveryRateState(state, new Date(start.getTime() + 2_000), 3);
  assert.equal(state.allowed, true);
  state = nextPasswordRecoveryRateState(state, new Date(start.getTime() + 3_000), 3);
  assert.equal(state.allowed, false);
  assert.equal(state.retryAfter, 1_800);

  const reset = nextPasswordRecoveryRateState(state, new Date(start.getTime() + 31 * 60_000), 3);
  assert.equal(reset.allowed, true);
  assert.equal(reset.attempts, 1);
});

test("retorna a configuração própria sem revelar a resposta", async () => {
  recoveryData.findOwnUser = async () => ({
    id: "u1", email: "agent@example.com", passwordHash: "hash", securityQuestion: "SECRET_PHRASE",
    employeeProfile: { wbLogin: "wb_agent" }
  });

  const result = await getOwnSecurityQuestion(actor);
  assert.equal("error" in result, false);
  if ("data" in result) {
    assert.equal(result.data.configured, true);
    assert.equal(result.data.question, "SECRET_PHRASE");
    assert.equal("answer" in result.data, false);
  }
});

test("exige a senha atual e armazena somente o hash normalizado da resposta", async () => {
  const passwordHash = await bcrypt.hash("senha-atual", 4);
  let saved: { question: string; answerHash: string } | null = null;
  recoveryData.findOwnUser = async () => ({
    id: "u1", email: "agent@example.com", passwordHash, securityQuestion: null,
    employeeProfile: { wbLogin: "wb_agent" }
  });
  recoveryData.verifyExternalPassword = async () => null;
  recoveryData.saveSecurityQuestion = async (_id: string, question: string, answerHash: string) => {
    saved = { question, answerHash };
  };

  const result = await saveOwnSecurityQuestion(actor, {
    question: "SECRET_PHRASE", answer: "  Minha   RESPOSTA  ", currentPassword: "senha-atual"
  });
  assert.equal("error" in result, false);
  assert.ok(saved);
  const persisted = saved as { question: string; answerHash: string };
  assert.equal(persisted.question, "SECRET_PHRASE");
  assert.notEqual(persisted.answerHash, "  Minha   RESPOSTA  ");
  assert.equal(await bcrypt.compare("minha resposta", persisted.answerHash), true);
});

test("usa a mesma resposta genérica para identidade, pergunta ou resposta incorretas", async () => {
  recoveryData.consumeRateLimit = async () => ({ allowed: true, retryAfter: 0 });
  recoveryData.cleanupRateLimits = async () => ({ count: 0 });
  recoveryData.findRecoveryUser = async () => null;

  const missing = await recoverPasswordWithSecurityQuestion(validRecovery);
  assert.equal("error" in missing, true);
  if ("error" in missing) assert.match(missing.error, /Não foi possível validar os dados informados/);

  const answerHash = await bcrypt.hash("outra resposta", 4);
  recoveryData.findRecoveryUser = async () => ({
    id: "u1", email: "agent@example.com", passwordHash: answerHash,
    securityQuestion: "INVENTED_CHARACTER", securityAnswerHash: answerHash
  });
  const wrong = await recoverPasswordWithSecurityQuestion(validRecovery);
  assert.equal("error" in wrong, true);
  if ("error" in missing && "error" in wrong) assert.equal(wrong.error, missing.error);
});

test("redefine a senha válida nos dois provedores e limpa os limitadores", async () => {
  const answerHash = await bcrypt.hash("minha resposta", 4);
  const currentPasswordHash = await bcrypt.hash("senha-antiga", 4);
  const calls: string[] = [];
  recoveryData.consumeRateLimit = async () => ({ allowed: true, retryAfter: 0 });
  recoveryData.findRecoveryUser = async () => ({
    id: "u1", email: "agent@example.com", passwordHash: currentPasswordHash,
    securityQuestion: "SECRET_PHRASE", securityAnswerHash: answerHash
  });
  recoveryData.updateExternalPassword = async () => { calls.push("external"); return "UPDATED"; };
  recoveryData.updateLocalPassword = async (_id: string, hash: string) => {
    calls.push("local");
    assert.equal(await bcrypt.compare(validRecovery.newPassword, hash), true);
  };
  recoveryData.cleanupRateLimits = async (keys: string[]) => {
    calls.push("cleanup");
    assert.equal(keys.length, 2);
    assert.equal(keys.some((key) => key.includes(validRecovery.email)), false);
    return { count: 2 };
  };

  const result = await recoverPasswordWithSecurityQuestion(validRecovery, { ipAddress: "203.0.113.8" });
  assert.deepEqual(calls, ["local", "external", "cleanup"]);
  assert.equal("success" in result && result.success, true);
});

test("interrompe antes de consultar o usuário quando o limite é atingido", async () => {
  let lookupCalled = false;
  recoveryData.consumeRateLimit = async () => ({ allowed: false, retryAfter: 900 });
  recoveryData.findRecoveryUser = async () => { lookupCalled = true; return null; };

  const result = await recoverPasswordWithSecurityQuestion(validRecovery);
  assert.equal(lookupCalled, false);
  assert.equal("rateLimited" in result && result.rateLimited, true);
  if ("retryAfter" in result) assert.equal(result.retryAfter, 900);
});
