import { createHmac } from "node:crypto";

import bcrypt from "bcryptjs";

import { createAuthError, createPermissionError, createServerError, createValidationError } from "@/lib/api-errors";
import type { Actor } from "@/lib/mock-db";
import { updatePasswordForUser } from "@/lib/password-user-repository";
import { prisma } from "@/lib/prisma";
import {
  isSecurityQuestionCode,
  normalizeSecurityAnswer,
  securityQuestionLabel,
  validateSecurityAnswer
} from "@/lib/security-question";
import { updateSupabasePasswordIfPresent, verifySupabasePassword } from "@/lib/supabase-auth";

const DUMMY_ANSWER_HASH = "$2a$12$0CVTI6Z.eCLH7zSGQVdt4.i6vP/ET0s/NuCTP6x58iIaL/fN2r.NS";
const GENERIC_RECOVERY_ERROR = "Não foi possível validar os dados informados. Revise as informações ou tente novamente mais tarde.";
const ACCOUNT_LIMIT = 5;
const IP_LIMIT = 20;
const WINDOW_MS = 15 * 60_000;
const BLOCK_MS = 30 * 60_000;
const EXPIRES_MS = 24 * 60 * 60_000;

export type SecurityQuestionInput = { question?: string; answer?: string; currentPassword?: string };
export type RecoverPasswordInput = SecurityQuestionInput & {
  email?: string; wbLogin?: string; newPassword?: string; confirmPassword?: string;
};
export type PasswordRecoveryContext = { ipAddress?: string | null; userAgent?: string | null };

export type PasswordRecoveryRateState = {
  attempts: number; windowStartedAt: Date; blockedUntil: Date | null; expiresAt: Date; allowed: boolean; retryAfter: number;
};

type StoredRateState = Pick<PasswordRecoveryRateState, "attempts" | "windowStartedAt" | "blockedUntil" | "expiresAt">;

export function nextPasswordRecoveryRateState(current: StoredRateState | null, now: Date, limit: number) {
  if (current?.blockedUntil && current.blockedUntil > now) {
    return { ...current, allowed: false, retryAfter: Math.max(1, Math.ceil((current.blockedUntil.getTime() - now.getTime()) / 1000)) };
  }
  const expiredWindow = !current || current.windowStartedAt.getTime() <= now.getTime() - WINDOW_MS;
  const attempts = expiredWindow ? 1 : current.attempts + 1;
  const blockedUntil = attempts > limit ? new Date(now.getTime() + BLOCK_MS) : null;
  return {
    attempts,
    windowStartedAt: expiredWindow ? now : current.windowStartedAt,
    blockedUntil,
    expiresAt: new Date(now.getTime() + EXPIRES_MS),
    allowed: !blockedUntil,
    retryAfter: blockedUntil ? Math.ceil(BLOCK_MS / 1000) : 0
  };
}

export const passwordRecoveryData = {
  findOwnUser(email: string) {
    return prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" }, status: "ACTIVE", deletedAt: null,
        employeeProfile: { is: { deletedAt: null } } },
      select: { id: true, email: true, passwordHash: true, securityQuestion: true,
        employeeProfile: { select: { wbLogin: true } } }
    });
  },
  findRecoveryUser(email: string, wbLogin: string) {
    return prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" }, status: "ACTIVE", deletedAt: null,
        employeeProfile: { is: { wbLogin: { equals: wbLogin, mode: "insensitive" }, deletedAt: null } } },
      select: { id: true, email: true, passwordHash: true, securityQuestion: true, securityAnswerHash: true }
    });
  },
  async saveSecurityQuestion(userId: string, question: string, answerHash: string) {
    const now = new Date();
    return prisma.$transaction(async (tx) => {
      const previous = await tx.user.findUnique({ where: { id: userId }, select: { securityQuestion: true } });
      await tx.user.update({ where: { id: userId }, data: {
        securityQuestion: question, securityAnswerHash: answerHash, securityQuestionUpdatedAt: now
      } });
      await tx.auditLog.create({ data: {
        actorId: userId, action: "EDICAO", entity: "User", entityId: userId,
        previousValue: { securityQuestion: previous?.securityQuestion ?? null, securityAnswerHash: previous?.securityQuestion ? "protected" : null },
        newValue: { securityQuestion: question, securityAnswerHash: "protected" },
        reason: "SECURITY_QUESTION_UPDATED_BY_USER"
      } });
    });
  },
  async consumeRateLimit(keyHash: string, limit: number, now: Date) {
    return prisma.$transaction(async (tx) => {
      const current = await tx.passwordRecoveryRateLimit.findUnique({ where: { keyHash } });
      const next = nextPasswordRecoveryRateState(current, now, limit);
      await tx.passwordRecoveryRateLimit.upsert({ where: { keyHash }, create: {
        keyHash, attempts: next.attempts, windowStartedAt: next.windowStartedAt,
        blockedUntil: next.blockedUntil, expiresAt: next.expiresAt
      }, update: {
        attempts: next.attempts, windowStartedAt: next.windowStartedAt,
        blockedUntil: next.blockedUntil, expiresAt: next.expiresAt
      } });
      return next;
    });
  },
  cleanupRateLimits(keys: string[], now: Date) {
    return prisma.passwordRecoveryRateLimit.deleteMany({ where: { OR: [{ keyHash: { in: keys } }, { expiresAt: { lt: now } }] } });
  },
  verifyExternalPassword: verifySupabasePassword,
  updateExternalPassword: updateSupabasePasswordIfPresent,
  async updateLocalPassword(userId: string, passwordHash: string, context: PasswordRecoveryContext, externalStatus: string) {
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await updatePasswordForUser(userId, passwordHash, tx);
      await tx.auditLog.create({ data: {
        actorId: userId, action: "EDICAO", entity: "User", entityId: userId,
        previousValue: { passwordHash: "protected" },
        newValue: { passwordHash: "updated", securityRecovery: true, supabaseAuth: externalStatus },
        reason: "PASSWORD_RESET_BY_SECURITY_QUESTION",
        ipAddress: context.ipAddress?.slice(0, 128) || null,
        userAgent: context.userAgent?.slice(0, 500) || null
      } });
    });
  }
};

export async function getOwnSecurityQuestion(actor: Actor) {
  const email = String(actor.email ?? "").trim().toLowerCase();
  if (!email) return createPermissionError("Faça login para configurar a recuperação de senha.");
  try {
    const user = await passwordRecoveryData.findOwnUser(email);
    if (!user) return createPermissionError("Seu usuário ativo não está vinculado a um cadastro de parceiro.");
    return { data: { configured: Boolean(user.securityQuestion), question: user.securityQuestion ?? "",
      questionLabel: securityQuestionLabel(user.securityQuestion) } };
  } catch (error) {
    return createServerError(error, "Não foi possível carregar a pergunta de segurança. Tente novamente.");
  }
}

export async function saveOwnSecurityQuestion(actor: Actor, input: SecurityQuestionInput) {
  const email = String(actor.email ?? "").trim().toLowerCase();
  const question = String(input.question ?? "").trim();
  const answer = String(input.answer ?? "");
  const currentPassword = String(input.currentPassword ?? "");
  const fields: Record<string, string> = {};
  if (!isSecurityQuestionCode(question)) fields.question = "Selecione uma pergunta de segurança válida.";
  const answerError = validateSecurityAnswer(answer);
  if (answerError) fields.answer = answerError;
  if (!currentPassword) fields.currentPassword = "Informe sua senha atual para confirmar.";
  if (Object.keys(fields).length) return createValidationError(fields);
  if (!email) return createPermissionError("Faça login para configurar a recuperação de senha.");
  try {
    const user = await passwordRecoveryData.findOwnUser(email);
    if (!user) return createPermissionError("Seu usuário ativo não está vinculado a um cadastro de parceiro.");
    const [localMatches, supabaseUser] = await Promise.all([
      bcrypt.compare(currentPassword, user.passwordHash),
      passwordRecoveryData.verifyExternalPassword(user.email, currentPassword).catch(() => null)
    ]);
    if (!localMatches && !supabaseUser) return createAuthError("A senha atual não confere.");
    const answerHash = await bcrypt.hash(normalizeSecurityAnswer(answer), 12);
    await passwordRecoveryData.saveSecurityQuestion(user.id, question, answerHash);
    return { success: true, message: "Pergunta de segurança atualizada com sucesso.",
      data: { configured: true, question, questionLabel: securityQuestionLabel(question) } };
  } catch (error) {
    return createServerError(error, "Não foi possível salvar a pergunta de segurança. Tente novamente.");
  }
}

export async function recoverPasswordWithSecurityQuestion(input: RecoverPasswordInput, context: PasswordRecoveryContext = {}) {
  const email = String(input.email ?? "").trim().toLowerCase();
  const wbLogin = String(input.wbLogin ?? "").trim().toLowerCase();
  const question = String(input.question ?? "").trim();
  const answer = String(input.answer ?? "");
  const newPassword = String(input.newPassword ?? "");
  const confirmPassword = String(input.confirmPassword ?? "");
  const fields: Record<string, string> = {};
  if (!email || !/^\S+@\S+\.\S+$/.test(email) || email.length > 254) fields.email = "Informe um e-mail válido.";
  if (!wbLogin || wbLogin.length > 100) fields.wbLogin = "Informe seu WB/Login.";
  if (!isSecurityQuestionCode(question)) fields.question = "Selecione a pergunta cadastrada.";
  const answerError = validateSecurityAnswer(answer);
  if (answerError) fields.answer = answerError;
  if (newPassword.length < 8 || newPassword.length > 128) fields.newPassword = "A nova senha deve ter entre 8 e 128 caracteres.";
  if (newPassword !== confirmPassword) fields.confirmPassword = "A confirmação de senha não confere.";
  if (Object.keys(fields).length) return createValidationError(fields);

  const now = new Date();
  const ip = String(context.ipAddress || "unknown").slice(0, 128);
  const keys = [rateKey(`account:${email}|${wbLogin}`), rateKey(`ip:${ip}`)];
  try {
    const accountRate = await passwordRecoveryData.consumeRateLimit(keys[0], ACCOUNT_LIMIT, now);
    const ipRate = await passwordRecoveryData.consumeRateLimit(keys[1], IP_LIMIT, now);
    if (!accountRate.allowed || !ipRate.allowed) {
      return { ...createAuthError("Muitas tentativas. Aguarde antes de tentar novamente."),
        rateLimited: true, retryAfter: Math.max(accountRate.retryAfter, ipRate.retryAfter) };
    }

    const user = await passwordRecoveryData.findRecoveryUser(email, wbLogin);
    const answerMatches = await bcrypt.compare(normalizeSecurityAnswer(answer), user?.securityAnswerHash ?? DUMMY_ANSWER_HASH);
    if (!user || !user.securityAnswerHash || user.securityQuestion !== question || !answerMatches) {
      return createAuthError(GENERIC_RECOVERY_ERROR);
    }
    if (await bcrypt.compare(newPassword, user.passwordHash)) {
      return createValidationError({ newPassword: "A nova senha deve ser diferente da senha atual." });
    }

    // Synchronize a matching Supabase Auth identity first; local-only accounts
    // continue to use the database credential exactly as they do today.
    const externalStatus = await passwordRecoveryData.updateExternalPassword(user.email, newPassword);
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await passwordRecoveryData.updateLocalPassword(user.id, passwordHash, context, externalStatus);
    await passwordRecoveryData.cleanupRateLimits(keys, now);
    return { success: true, message: "Senha redefinida com sucesso. Entre usando sua nova senha.", email: user.email };
  } catch (error) {
    return createServerError(error, "Não foi possível redefinir a senha agora. Tente novamente mais tarde.");
  }
}

function rateKey(value: string) {
  const secret = process.env.NEXTAUTH_SECRET || "local-password-recovery";
  return createHmac("sha256", secret).update(value).digest("hex");
}
