import { Prisma } from "@prisma/client";
import { cancelAdherenceForDeletedWorkHours, cancelWorkHourAdherenceForDay } from "./work-hours-adherence-cleanup";
import { isCaptureImportEligible, type CaptureEligibilityProfile } from "./work-hours-capture-eligibility";
import { calculateOperationalHours, isProtectedCaptureScheduleStatus, shouldCreateLowAdherence } from "./work-hours-capture-integration-core";

type AdherenceEmployee = CaptureEligibilityProfile & { id: string; wbLogin: string; fullName: string; supervisorId: string | null };

// Capture and manual entry share one threshold/lifecycle. The duration is always
// the source duration, never the result of the operational-hours bonus/fixed rule.
export async function syncWorkHourAdherence(tx: Prisma.TransactionClient, input: {
  employee: AdherenceEmployee;
  schedule: { id: string; status: string; startsAt: string | null; endsAt: string | null; deletedAt?: Date | null };
  date: Date;
  durationMs: number;
  actorId: string;
  hadOperationalHours: boolean;
  source: "CAPTURE" | "MANUAL";
  sourceChanged?: boolean;
}) {
  const { employee, schedule, date, durationMs, actorId } = input;
  const dateKey = date.toISOString().slice(0, 10);
  if (!isCaptureImportEligible(employee, dateKey) || schedule.deletedAt || isProtectedCaptureScheduleStatus(schedule.status)) return;
  const reconciliationKey = `${employee.id}:${dateKey}:${schedule.id}`;
  if (!input.hadOperationalHours) {
    await cancelAdherenceForDeletedWorkHours(tx, { employeeId: employee.id, date, actorId, reason: "Novo lançamento após ausência do registro de horas" });
  }
  if (!shouldCreateLowAdherence(durationMs)) {
    await cancelWorkHourAdherenceForDay(tx, { employeeId: employee.id, date, actorId,
      reason: "Aderência cancelada: duração atual igual ou superior a 7:25." });
    return;
  }
  const existing = await tx.workHourAdherenceJustification.findUnique({ where: { reconciliationKey } });
  const sameValidatedDuration = Boolean(existing && existing.status !== "CANCELLED" && !input.sourceChanged
    && existing.sourceDurationMs === durationMs && existing.scheduleId === schedule.id && existing.supervisorId === employee.supervisorId);
  if (sameValidatedDuration && existing?.status === "JUSTIFIED") return;
  const classification = calculateOperationalHours(0, { lob: employee.lob.name, legacySkill: employee.skill,
    skillNames: employee.skillAssignments?.map((item) => item.skill.name) }).classificationLabel;
  const values = { scheduleId: schedule.id, supervisorId: employee.supervisorId, lob: employee.lob.name, classification,
    plannedStart: schedule.startsAt, plannedEnd: schedule.endsAt, sourceDurationMs: durationMs };
  const saved = await tx.workHourAdherenceJustification.upsert({
    where: { reconciliationKey },
    create: { ...values, reconciliationKey, employeeId: employee.id, date, slotKey: schedule.id, wbLogin: employee.wbLogin },
    update: { ...values, ...(sameValidatedDuration ? {} : { status: "PENDING", justification: null, answeredById: null, answeredAt: null }) }
  });
  if (employee.supervisorId) {
    const supervisor = await tx.employeeProfile.findUnique({ where: { id: employee.supervisorId }, select: { userId: true } });
    if (supervisor?.userId) {
      const duplicate = await tx.notification.findFirst({ where: { userId: supervisor.userId, entity: "WorkHourAdherenceJustification", entityId: saved.id, readAt: null } });
      if (!duplicate) {
        const minutes = Math.floor(durationMs / 60_000);
        const duration = `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
        await tx.notification.create({ data: {
          userId: supervisor.userId, title: "Justificativa de aderência pendente",
          body: `${employee.fullName} registrou ${duration} ${input.source === "MANUAL" ? "em lançamento manual" : "na Captura de Horas"} em ${dateKey}.`,
          category: "Horas Operacionais", type: "WARNING", entity: "WorkHourAdherenceJustification", entityId: saved.id,
          href: `/horas-operacionais?startDate=${dateKey}&endDate=${dateKey}`
        } });
      }
    }
  }
  if (!sameValidatedDuration) {
    await tx.auditLog.create({ data: {
      actorId, action: existing ? "EDICAO" : "CRIACAO", entity: "WorkHourAdherenceJustification", entityId: saved.id,
      reason: input.source === "MANUAL" ? "Horas manuais inferiores a 7:25." : "Captura original inferior a 7:25 após comparecimento validado.",
      previousValue: existing ? { capturedMs: existing.sourceDurationMs, status: existing.status, justification: existing.justification,
        answeredById: existing.answeredById, answeredAt: existing.answeredAt?.toISOString() ?? null } : Prisma.JsonNull,
      newValue: { reconciliationKey, capturedMs: durationMs, durationSource: input.source, status: saved.status }
    } });
  }
}
