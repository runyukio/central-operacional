import bcrypt from "bcryptjs";

import { createAuthError, createServerError, createValidationError, mapPrismaError } from "@/lib/api-errors";
import { recordErrorLog } from "@/lib/mock-db";
import { getDefaultPathForRole } from "@/lib/navigation";
import { findPasswordUserByEmail, updatePasswordForUser } from "@/lib/password-user-repository";
import { prisma } from "@/lib/prisma";
import { consumePasswordAttempts } from "@/lib/auth-rate-limit";
import { synchronizeUserPassword, verifyAccountPassword } from "@/lib/password-credentials";

export type ChangePasswordInput = {
  email?: string;
  currentPassword?: string;
  newPassword?: string;
  confirmPassword?: string;
  actorEmail?: string | null;
  ipAddress?: string | null;
};

export async function changeUserPassword(input: ChangePasswordInput) {
  const fieldErrors: Record<string, string> = {};
  const email = String(input.email || input.actorEmail || "").trim().toLowerCase();
  const currentPassword = String(input.currentPassword ?? "");
  const newPassword = String(input.newPassword ?? "");
  const confirmPassword = String(input.confirmPassword ?? "");

  if (!email) fieldErrors.email = "E-mail é obrigatório.";
  if (!currentPassword) fieldErrors.currentPassword = "Senha atual é obrigatória.";
  if (!newPassword) fieldErrors.newPassword = "Nova senha é obrigatória.";
  if (newPassword && newPassword.length < 8) fieldErrors.newPassword = "A nova senha deve ter pelo menos 8 caracteres.";
  if (email.length > 254 || currentPassword.length > 4096 || newPassword.length > 128) fieldErrors.newPassword = "Dados de autenticação acima do tamanho permitido.";
  if (!confirmPassword) fieldErrors.confirmPassword = "A confirmação de senha é obrigatória.";
  if (newPassword && confirmPassword && newPassword !== confirmPassword) fieldErrors.confirmPassword = "A confirmação de senha não confere.";
  if (currentPassword && newPassword && currentPassword === newPassword) fieldErrors.newPassword = "A nova senha não pode ser igual à senha atual.";
  if (Object.keys(fieldErrors).length) return createValidationError(fieldErrors);

  try {
    const rate = await consumePasswordAttempts("change", email, input.ipAddress);
    if (!rate.allowed) return { ...createAuthError("Muitas tentativas. Aguarde antes de tentar novamente."), rateLimited: true, retryAfter: rate.retryAfter };
    const user = await findPasswordUserByEmail(email);
    if (!user) return createAuthError("E-mail ou senha atual inválidos.");
    if (user.status !== "ACTIVE") return createAuthError("Usuário inativo. Contate o administrador.");

    const passwordMatches = await verifyAccountPassword(user, currentPassword);
    if (!passwordMatches) return createAuthError("E-mail ou senha atual inválidos.");

    const sameAsCurrentHash = await bcrypt.compare(newPassword, user.passwordHash);
    if (sameAsCurrentHash) return createValidationError({ newPassword: "A nova senha não pode ser igual à senha atual." });

    const externalStatus = await synchronizeUserPassword({ email: user.email, password: newPassword,
      persistLocal: (hash) => updatePasswordForUser(user.id, hash, prisma, user.updatedAt) });

    try {
      await prisma.auditLog.create({
        data: {
          actorId: user.id,
          action: "EDICAO",
          entity: "User",
          entityId: user.id,
          reason: user.mustChangePassword ? "Troca obrigatória de senha temporária" : "Alteração de senha pelo usuário",
          previousValue: { passwordHash: "protected", mustChangePassword: user.mustChangePassword, temporaryPassword: user.temporaryPassword },
          newValue: { passwordHash: "updated", mustChangePassword: false, temporaryPassword: false }
        }
      });
    } catch (auditError) {
      recordErrorLog({
        userEmail: email,
        code: "PASSWORD_CHANGE_AUDIT_ERROR",
        message: auditError instanceof Error ? auditError.message : "Falha ao registrar auditoria de senha",
        route: "/api/auth/change-password",
        action: "PASSWORD_CHANGE_AUDIT",
        severity: "WARNING"
      });
    }

    return {
      success: true,
      message: externalStatus === "LOCAL_SAVED_EXTERNAL_PENDING"
        ? "Senha alterada na Central. Entre novamente com a nova senha. A sincronização externa está pendente; contate o administrador."
        : "Senha alterada com sucesso. Entre novamente com a nova senha.",
      email: user.email,
      defaultPath: getDefaultPathForRole(user.roleName)
    };
  } catch (error) {
    recordErrorLog({
      userEmail: email,
      code: "PASSWORD_CHANGE_ERROR",
      message: error instanceof Error ? error.message : "Falha ao alterar senha",
      route: "/api/auth/change-password",
      action: "PASSWORD_CHANGE",
      severity: "ERROR"
    });
    return mapPrismaError(error) ?? createServerError(error, "Não foi possível salvar a nova senha. Tente novamente.");
  }
}
