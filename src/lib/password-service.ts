import bcrypt from "bcryptjs";

import { createPermissionError, createServerError, createValidationError, mapPrismaError } from "@/lib/api-errors";
import { recordErrorLog } from "@/lib/mock-db";
import { getDefaultPathForRole } from "@/lib/navigation";
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
  if (!confirmPassword) fieldErrors.confirmPassword = "Confirmar nova senha é obrigatório.";
  if (newPassword && confirmPassword && newPassword !== confirmPassword) fieldErrors.confirmPassword = "A confirmação de senha não confere.";
  if (currentPassword && newPassword && currentPassword === newPassword) fieldErrors.newPassword = "A nova senha não pode ser igual à senha atual.";
  if (Object.keys(fieldErrors).length) return createValidationError(fieldErrors);

  try {
    const user = await prisma.user.findFirst({
      where: { email, status: "ACTIVE", deletedAt: null },
      include: { role: true }
    });
    if (!user) return createPermissionError("E-mail ou senha atual inválidos.");

    const passwordMatches = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!passwordMatches) return createPermissionError("E-mail ou senha atual inválidos.");

    const sameAsCurrentHash = await bcrypt.compare(newPassword, user.passwordHash);
    if (sameAsCurrentHash) return createValidationError({ newPassword: "A nova senha não pode ser igual à senha atual." });

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          mustChangePassword: false,
          temporaryPassword: false,
          passwordChangedAt: new Date()
        }
      });
      await tx.auditLog.create({
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
    });

    return {
      success: true,
      message: "Senha alterada com sucesso.",
      email: user.email,
      defaultPath: getDefaultPathForRole(user.role.name)
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
    return mapPrismaError(error) ?? createServerError(error, "Não foi possível alterar a senha. Tente novamente.");
  }
}
