import { normalizeRole, canJustifyAbsence, type PermissionUser } from "@/lib/permissions";

export const meuEspacoRoles = ["ADMIN", "WFM", "GESTOR", "SUPERVISOR"] as const;

export function canAccessMeuEspaco(user?: PermissionUser) {
  return Boolean(user && user.status === "ACTIVE" && meuEspacoRoles.some((role) => role === normalizeRole(user.role)));
}

export function canRespondMeuEspaco(user?: PermissionUser) {
  return Boolean(user && canAccessMeuEspaco(user) && normalizeRole(user.role) !== "GESTOR" && canJustifyAbsence(user));
}

export class MeuEspacoError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

// Called with the active database user, never a role supplied by the browser.
export function resolveMeuEspacoSupervisor(user: PermissionUser, ownEmployeeId: string | null, requested?: string) {
  if (!canAccessMeuEspaco(user)) throw new MeuEspacoError("Você não tem acesso ao Meu Espaço.", 403);
  const selected = requested?.trim() || null;
  if (normalizeRole(user.role) !== "SUPERVISOR") return selected;
  if (!ownEmployeeId) throw new MeuEspacoError("Supervisor sem perfil de parceiro vinculado.", 403);
  if (selected && selected !== ownEmployeeId) throw new MeuEspacoError("Você só pode consultar seu próprio espaço.", 403);
  return ownEmployeeId;
}
