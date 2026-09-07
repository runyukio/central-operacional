import type { Prisma } from "@prisma/client";

export async function assertActiveAdminRemains(tx: Prisma.TransactionClient, userId: string, next: {
  roleId?: string; status?: string; deletedAt?: Date | null;
}) {
  // Serialize all application-level administrator removals, including edits made
  // by another administrator. The database invariant also covers other writers.
  // Prisma cannot deserialize PostgreSQL's void result. Keep the same lock,
  // but return a supported type before evaluating the administrator invariant.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(732104, 1)::text`;
  const current = await tx.user.findUnique({ where: { id: userId }, include: { role: true } });
  if (!current || current.status !== "ACTIVE" || current.deletedAt || current.role.name !== "ADMIN") return;
  const removesAdmin = (next.status !== undefined && next.status !== "ACTIVE")
    || Boolean(next.deletedAt) || (next.roleId !== undefined && next.roleId !== current.roleId);
  if (!removesAdmin) return;
  const others = await tx.user.count({ where: { status: "ACTIVE", deletedAt: null, role: { name: "ADMIN" }, id: { not: userId } } });
  if (!others) throw new Error("Não é permitido remover, rebaixar ou inativar o último ADMIN ativo.");
}
