import bcrypt from "bcryptjs";

import { createAuthError, createServerError, createValidationError, mapPrismaError } from "@/lib/api-errors";
import { recordErrorLog } from "@/lib/mock-db";
import { getDefaultPathForRole } from "@/lib/navigation";
import { findPasswordUserByEmail, updatePasswordForUser } from "@/lib/password-user-repository";
import { prisma } from "@/lib/prisma";

export type ChangePasswordInput = {
  email?: string;
  currentPassword?: string;
  newPassword?: string;
  confirmPassword?: string;
  actorEmail?: string | null;
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
  if (!confirmPassword) fieldErrors.confirmPassword = "A confirmação de senha é obrigatória.";
  if (newPassword && confirmPassword && newPassword !== confirmPassword) fieldErrors.confirmPassword = "A confirmação de senha não confere.";
  if (currentPassword && newPassword && currentPassword === newPassword) fieldErrors.newPassword = "A nova senha não pode ser igual à senha atual.";
  if (Object.keys(fieldErrors).length) return createValidationError(fieldErrors);

  try {
    const user = await findPasswordUserByEmail(email);
    if (!user) return createAuthError("E-mail ou senha atual inválidos.");
    if (user.status !== "ACTIVE") return createAuthError("Usuário inativo. Contate o administrador.");

    const passwordMatches = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!passwordMatches) return createAuthError("E-mail ou senha atual inválidos.");

    const sameAsCurrentHash = await bcrypt.compare(newPassword, user.passwordHash);
    if (sameAsCurrentHash) return createValidationError({ newPassword: "A nova senha não pode ser igual à senha atual." });

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await updatePasswordForUser(user.id, passwordHash);

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
      message: "Senha alterada com sucesso.",
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
