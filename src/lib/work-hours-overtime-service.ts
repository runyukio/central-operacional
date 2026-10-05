import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeRole } from "@/lib/permissions";
import { MeuEspacoError } from "@/lib/meu-espaco-access";
import { canReviewOvertime, captureOvertimeOutcome, type OvertimeSource } from "@/lib/work-hours-overtime";
import { isWorkHoursAllowedForSchedule, calculateProductiveDifferenceMinutes, plannedProductiveHoursForSchedule } from "@/lib/work-hours-rules";
import type { Actor } from "@/lib/mock-db";

type Review = Prisma.WorkHourOvertimeReviewGetPayload<object>;
type Tx = Prisma.TransactionClient;

function snapshot(review: Review | null) {
  return review ? { version: review.version, status: review.status, sourceFingerprint: review.sourceFingerprint,
    sourceSnapshot: review.sourceSnapshot, calculatedHours: review.calculatedHours, excessHours: review.excessHours,
    supervisorId: review.supervisorId, rejectionReason: review.rejectionReason,
    answeredById: review.answeredById, answeredAt: review.answeredAt?.toISOString() ?? null } : Prisma.JsonNull;
}

async function writeHistory(tx: Tx, review: Review, actorId: string, previous: Review | null, reason: string) {
  if (review.workHourRecordId) await tx.workHourHistory.create({ data: {
    workHourRecordId: review.workHourRecordId, changedById: actorId, action: `OVERTIME_${review.status}`,
    previousValue: snapshot(previous), newValue: snapshot(review), reason
  } });
  await tx.auditLog.create({ data: { actorId, action: review.status === "APPROVED" ? "APROVACAO" : "EDICAO",
    entity: "WorkHourOvertimeReview", entityId: review.id, previousValue: snapshot(previous), newValue: snapshot(review), reason } });
}

export async function saveCaptureOvertimeReview(tx: Tx, input: {
  recordId: string; employeeId: string; supervisorId: string | null; date: Date; actorId: string;
  source: OvertimeSource; previous: Review | null; outcome: ReturnType<typeof captureOvertimeOutcome>;
}) {
  const { previous, outcome } = input;
  if (previous && previous.supervisorId === input.supervisorId && (outcome.sameSource
    || (outcome.status === "CANCELLED" && previous.status === "CANCELLED" && previous.sourceFingerprint === outcome.sourceFingerprint))) return previous;
  if (!previous && outcome.status === "CANCELLED") return null;
  // Changing only the assigned supervisor preserves the reviewed source and decision.
  const preserveDecision = outcome.sameSource && previous;
  const data = { employeeId: input.employeeId, supervisorId: input.supervisorId, date: input.date,
    version: (previous?.version ?? 0) + 1, sourceFingerprint: outcome.sourceFingerprint, sourceSnapshot: input.source,
    sourceDurationMs: input.source.sourceDurationMs, calculatedHours: outcome.calculatedHours,
    excessHours: outcome.excessHours, ruleLabel: input.source.ruleLabel, status: outcome.status,
    answeredById: preserveDecision ? previous.answeredById : null,
    answeredAt: preserveDecision ? previous.answeredAt : null,
    rejectionReason: preserveDecision ? previous.rejectionReason : null };
  const review = await tx.workHourOvertimeReview.upsert({ where: { workHourRecordId: input.recordId },
    create: { ...data, workHourRecordId: input.recordId }, update: data });
  await writeHistory(tx, review, input.actorId, previous,
    outcome.status === "PENDING" ? "Excedente de horas enviado para validação" : "Revisão de excedente atualizada pela importação");
  return review;
}

export async function cancelOvertimeReviews(tx: Tx, recordIds: string[], actorId: string, reason: string) {
  if (!recordIds.length) return;
  const reviews = await tx.workHourOvertimeReview.findMany({ where: { workHourRecordId: { in: recordIds }, status: { not: "CANCELLED" } } });
  for (const previous of reviews) {
    const review = await tx.workHourOvertimeReview.update({ where: { id: previous.id },
      data: { status: "CANCELLED", version: previous.version + 1 } });
    await writeHistory(tx, review, actorId, previous, reason);
  }
}

export async function reviewWorkHourOvertime(actor: Actor, input: { id: string; version: number; action: "approve" | "reject"; rejectionReason?: string }) {
  const user = await prisma.user.findUnique({ where: { email: actor.email }, include: { role: true, employeeProfile: true } });
  const role = normalizeRole(user?.role.name ?? "");
  if (!user || user.status !== "ACTIVE" || user.deletedAt || !["ADMIN", "WFM", "SUPERVISOR"].includes(role)) throw new MeuEspacoError("Você não pode decidir sobre excedentes de horas.", 403);
  if (input.action !== "approve" && input.action !== "reject") throw new MeuEspacoError("Decisão inválida.");
  if (!Number.isSafeInteger(input.version) || input.version < 1) throw new MeuEspacoError("Versão inválida. Atualize a lista.");
  const rejectionReason = input.rejectionReason?.trim() ?? "";
  if (input.action === "reject" && (!rejectionReason || rejectionReason.length > 10000)) throw new MeuEspacoError("Informe o motivo da recusa (até 10.000 caracteres).");
  try {
    return await prisma.$transaction(async (tx) => {
      const previous = await tx.workHourOvertimeReview.findUnique({ where: { id: input.id }, include: { record: { include: { schedule: true } } } });
      if (!previous || !previous.record || previous.status !== "PENDING" || previous.version !== input.version) throw new MeuEspacoError("Esta revisão mudou ou já foi decidida. Atualize a lista.", 409);
      if (!canReviewOvertime(role, user.employeeProfile?.deletedAt ? null : user.employeeProfile?.id, previous.supervisorId)) throw new MeuEspacoError("Esta revisão não está atribuída a você.", 403);
      const record = previous.record;
      const source = previous.sourceSnapshot as unknown as OvertimeSource;
      const freshSchedule = record.schedule;
      if (record.source !== "captura-horas" || record.scheduleId !== source.scheduleId || !freshSchedule || freshSchedule.deletedAt
        || freshSchedule.startsAt !== source.plannedStart || freshSchedule.endsAt !== source.plannedEnd
        || !isWorkHoursAllowedForSchedule(freshSchedule) || record.actualHours !== previous.calculatedHours
        || record.effectiveHours !== 8 || record.adjustedHours !== null) throw new MeuEspacoError("As horas ou o turno foram alterados. Reimporte a captura e atualize a lista.", 409);
      const effectiveHours = input.action === "approve" ? previous.calculatedHours : 8;
      const plannedHours = plannedProductiveHoursForSchedule(freshSchedule);
      const differenceMinutes = plannedHours === null ? null : calculateProductiveDifferenceMinutes(effectiveHours, plannedHours);
      // Compare-and-set plus Serializable prevents two decisions or a concurrent import.
      const changed = await tx.workHourOvertimeReview.updateMany({ where: { id: previous.id, version: input.version, status: "PENDING" },
        data: { status: input.action === "approve" ? "APPROVED" : "REJECTED", version: input.version + 1,
          answeredById: user.id, answeredAt: new Date(), rejectionReason: input.action === "reject" ? rejectionReason : null } });
      if (changed.count !== 1) throw new MeuEspacoError("Esta revisão mudou. Atualize a lista.", 409);
      const updated = await tx.workHourRecord.updateMany({ where: { id: record.id, updatedAt: record.updatedAt },
        data: { effectiveHours, differenceMinutes, status: differenceMinutes !== null && Math.abs(differenceMinutes) <= 5 ? "OK" : "DIVERGENT" } });
      if (updated.count !== 1) throw new MeuEspacoError("As horas mudaram. Atualize a lista.", 409);
      const review = await tx.workHourOvertimeReview.findUniqueOrThrow({ where: { id: previous.id } });
      await writeHistory(tx, review, user.id, previous, input.action === "approve" ? "Excedente de horas aprovado" : `Excedente de horas recusado: ${rejectionReason}`);
      return review;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") throw new MeuEspacoError("As horas mudaram durante a decisão. Atualize a lista.", 409);
    throw error;
  }
}
