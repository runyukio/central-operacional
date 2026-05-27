import type { Actor } from "@/lib/mock-db";
import { prisma } from "@/lib/prisma";

export async function auditPermissionDenied(actor: Actor, input: { action: string; entity: string; reason: string; entityId?: string | null }) {
  try {
    const user = actor.email ? await prisma.user.findUnique({ where: { email: actor.email }, select: { id: true } }) : null;
    await prisma.auditLog.create({
      data: {
        actorId: user?.id ?? null,
        action: "EDICAO",
        entity: input.entity,
        entityId: input.entityId ?? null,
        reason: input.reason,
        newValue: {
          denied: true,
          attemptedAction: input.action,
          role: actor.role,
          email: actor.email
        }
      }
    });
  } catch {
    // Bloqueio de permissão não deve falhar por causa do log de auditoria.
  }
}
