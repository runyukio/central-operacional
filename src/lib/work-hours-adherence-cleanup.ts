import type { Prisma } from "@prisma/client";

// A WorkHourRecord is unique per employee/Shift Date. Keep cancellation in the
// same transaction as its deletion, including every slot linked to that day.
export async function cancelAdherenceForDeletedWorkHours(
  tx: Prisma.TransactionClient,
  input: { employeeId: string; date: Date; actorId: string; reason: string }
) {
  return cancelWorkHourAdherenceForDay(tx, { ...input, reason: `Aderência cancelada pela exclusão das horas: ${input.reason}` });
}

export async function cancelWorkHourAdherenceForDay(
  tx: Prisma.TransactionClient,
  input: { employeeId: string; date: Date; actorId: string; reason: string }
) {
  const records = await tx.workHourAdherenceJustification.findMany({
    where: { employeeId: input.employeeId, date: input.date, status: { not: "CANCELLED" } }
  });
  if (!records.length) return;

  const ids = records.map((record) => record.id);
  await tx.workHourAdherenceJustification.updateMany({
    where: { id: { in: ids } },
    data: { status: "CANCELLED", justification: null, answeredById: null, answeredAt: null }
  });
  await tx.notification.updateMany({
    where: { entity: "WorkHourAdherenceJustification", entityId: { in: ids }, readAt: null },
    data: { isRead: true, readAt: new Date() }
  });
  for (const record of records) {
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: "EXCLUSAO",
        entity: "WorkHourAdherenceJustification",
        entityId: record.id,
        reason: input.reason,
        previousValue: {
          reconciliationKey: record.reconciliationKey,
          employeeId: record.employeeId,
          date: record.date.toISOString(),
          status: record.status,
          capturedMs: record.sourceDurationMs,
          justification: record.justification,
          answeredById: record.answeredById,
          answeredAt: record.answeredAt?.toISOString() ?? null
        },
        newValue: { status: "CANCELLED", justification: null, answeredById: null, answeredAt: null }
      }
    });
  }
}
