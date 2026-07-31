import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { baseTimesForShift } from "@/lib/shift-base-times";
import { cleanShiftName } from "@/lib/shift-display";

const SAO_PAULO_TIME_ZONE = "America/Sao_Paulo";
const scheduledShiftChangeStatuses = new Set(["SCHEDULED", "AGENDADA"]);

type ScheduledShiftChangePayload = Record<string, unknown>;

export function saoPauloDateKey(referenceDate = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SAO_PAULO_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(referenceDate);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

export function isShiftChangeEffective(startDate: Date | string, referenceDate = new Date()) {
  const startDateKey = typeof startDate === "string" ? startDate.slice(0, 10) : startDate.toISOString().slice(0, 10);
  return startDateKey <= saoPauloDateKey(referenceDate);
}

export async function applyDueFixedShiftChanges(referenceDate = new Date()) {
  const effectiveThrough = saoPauloDateKey(referenceDate);
  const requests = await prisma.request.findMany({
    where: {
      status: { in: ["APROVADO", "CONCLUIDO"] },
      type: { name: { contains: "turno", mode: "insensitive" } }
    },
    select: {
      id: true,
      code: true,
      employeeId: true,
      payload: true
    },
    orderBy: { createdAt: "asc" },
    take: 500
  });

  const dueRequests = requests.filter((request) => isDueFixedShiftChange(request.payload, effectiveThrough));
  const failures: Array<{ requestId: string; code: string; error: string }> = [];
  let applied = 0;
  let schedulesUpdated = 0;

  for (const request of dueRequests) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const current = await tx.request.findUnique({
          where: { id: request.id },
          select: {
            id: true,
            code: true,
            employeeId: true,
            requesterId: true,
            payload: true,
            status: true,
            updatedAt: true,
            employee: {
              select: {
                id: true,
                shiftId: true,
                workStartTime: true,
                workEndTime: true,
                supervisorId: true,
                shift: { select: { name: true } }
              }
            }
          }
        });
        if (!current || !isDueFixedShiftChange(current.payload, effectiveThrough)) {
          return { applied: false, schedulesUpdated: 0 };
        }
        if (!current.employeeId || !current.employee) {
          throw new Error("Solicitação sem colaborador vinculado.");
        }

        const payload = (current.payload ?? {}) as ScheduledShiftChangePayload;
        const desiredShift = cleanShiftName(String(payload.desiredShift ?? ""));
        const startDate = parseDateOnly(payload.shiftChangeStartDate ?? payload.shiftChangeDate ?? payload.requestedDate);
        const approvedById = String(payload.shiftChangeApprovedById ?? "").trim();
        if (!desiredShift || !startDate || !approvedById) {
          throw new Error("Dados da vigência da troca de turno estão incompletos.");
        }

        const shift = await tx.shift.findFirst({
          where: {
            OR: [
              { name: desiredShift },
              { name: { startsWith: `${desiredShift} (` } }
            ]
          }
        });
        if (!shift) throw new Error("Turno solicitado não encontrado.");
        const baseTimes = baseTimesForShift(desiredShift);
        if (!baseTimes?.startsAt || !baseTimes.endsAt) {
          throw new Error("A troca de turno deve selecionar Manhã, Tarde ou Noite.");
        }

        const guard = await tx.request.updateMany({
          where: { id: current.id, updatedAt: current.updatedAt },
          data: { updatedAt: referenceDate }
        });
        if (guard.count !== 1) return { applied: false, schedulesUpdated: 0 };

        const beforeEmployee = serialize({
          id: current.employee.id,
          shiftId: current.employee.shiftId,
          shift: current.employee.shift.name,
          workStartTime: current.employee.workStartTime,
          workEndTime: current.employee.workEndTime
        });
        const updatedEmployee = await tx.employeeProfile.update({
          where: { id: current.employeeId },
          data: {
            shiftId: shift.id,
            workStartTime: baseTimes.startsAt,
            workEndTime: baseTimes.endsAt
          },
          include: { shift: true }
        });
        const afterEmployee = serialize({
          id: updatedEmployee.id,
          shiftId: updatedEmployee.shiftId,
          shift: updatedEmployee.shift.name,
          workStartTime: updatedEmployee.workStartTime,
          workEndTime: updatedEmployee.workEndTime
        });

        const schedules = await tx.schedule.findMany({
          where: {
            employeeId: current.employeeId,
            deletedAt: null,
            date: { gte: startDate }
          },
          include: { shift: true },
          orderBy: { date: "asc" }
        });
        let updatedScheduleCount = 0;
        for (const schedule of schedules) {
          if (schedule.shiftId === shift.id && schedule.startsAt === baseTimes.startsAt && schedule.endsAt === baseTimes.endsAt) continue;
          const before = serialize(schedule);
          const after = await tx.schedule.update({
            where: { id: schedule.id },
            data: {
              shiftId: shift.id,
              startsAt: baseTimes.startsAt,
              endsAt: baseTimes.endsAt,
              observation: `Troca de turno fixa vigente pela solicitação ${current.code}`
            },
            include: { shift: true }
          });
          await tx.scheduleChangeHistory.create({
            data: {
              scheduleId: after.id,
              employeeId: current.employeeId,
              changedById: approvedById,
              date: schedule.date,
              before,
              after: serialize(after),
              previousValue: before,
              newValue: serialize(after),
              reason: `Troca de turno fixa entrou em vigência pela solicitação ${current.code}`
            }
          });
          updatedScheduleCount += 1;
        }

        const appliedAt = referenceDate.toISOString();
        const message = `Troca de turno fixa vigente desde ${formatDatePtBr(startDate)}. Turno cadastral atualizado.`;
        await tx.request.update({
          where: { id: current.id },
          data: {
            payload: {
              ...(payload as Prisma.InputJsonObject),
              shiftChangeAppliedAt: appliedAt,
              shiftChangeAppliedById: approvedById,
              shiftChangeApplicationStatus: "APPLIED",
              shiftChangeApplicationMessage: message,
              shiftChangeScheduledFor: startDate.toISOString().slice(0, 10)
            },
            history: {
              create: {
                actorId: approvedById,
                action: "Turno entrou em vigência",
                from: current.status,
                to: current.status,
                reason: message,
                metadata: {
                  shiftChangeUpdated: true,
                  shiftChangeEffectiveDate: startDate.toISOString().slice(0, 10),
                  baseTimes,
                  schedulesUpdated: updatedScheduleCount
                }
              }
            }
          }
        });

        await tx.auditLog.create({
          data: {
            actorId: approvedById,
            action: "EDICAO",
            entity: "EmployeeProfile",
            entityId: current.employeeId,
            reason: `Troca de turno fixa entrou em vigência pela solicitação ${current.code}`,
            previousValue: beforeEmployee,
            newValue: afterEmployee
          }
        });
        await tx.notification.create({
          data: {
            userId: current.requesterId,
            title: "Troca de turno em vigência",
            body: `A troca de turno da solicitação ${current.code} entrou em vigência hoje.`,
            category: "Solicitações",
            type: "SUCCESS",
            entity: "Request",
            entityId: current.id,
            href: `/esteiras?request=${current.code}`
          }
        });

        if (current.employee.supervisorId) {
          const supervisor = await tx.employeeProfile.findUnique({
            where: { id: current.employee.supervisorId },
            select: { userId: true }
          });
          if (supervisor?.userId && supervisor.userId !== current.requesterId) {
            await tx.notification.create({
              data: {
                userId: supervisor.userId,
                title: "Troca de turno em vigência",
                body: `${current.code} entrou em vigência e o turno cadastral foi atualizado.`,
                category: "Solicitações",
                type: "REQUEST",
                entity: "Request",
                entityId: current.id,
                href: `/esteiras?request=${current.code}`
              }
            });
          }
        }

        return { applied: true, schedulesUpdated: updatedScheduleCount };
      }, { maxWait: 10000, timeout: 30000 });

      if (result.applied) {
        applied += 1;
        schedulesUpdated += result.schedulesUpdated;
      }
    } catch (error) {
      failures.push({
        requestId: request.id,
        code: request.code,
        error: error instanceof Error ? error.message : "Falha ao aplicar troca de turno agendada."
      });
    }
  }

  return {
    success: failures.length === 0,
    effectiveThrough,
    due: dueRequests.length,
    applied,
    schedulesUpdated,
    failures
  };
}

function isDueFixedShiftChange(payloadValue: Prisma.JsonValue | null, effectiveThrough: string) {
  const payload = (payloadValue ?? {}) as ScheduledShiftChangePayload;
  if (String(payload.shiftChangeType ?? "Fixa") !== "Fixa") return false;
  if (!scheduledShiftChangeStatuses.has(String(payload.shiftChangeApplicationStatus ?? "").toUpperCase())) return false;
  if (payload.shiftChangeAppliedAt) return false;
  const startDate = String(payload.shiftChangeStartDate ?? payload.shiftChangeDate ?? payload.requestedDate ?? "").slice(0, 10);
  return Boolean(startDate) && startDate <= effectiveThrough;
}

function parseDateOnly(value: unknown) {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDatePtBr(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(date);
}

function serialize(value: unknown) {
  return value ? JSON.parse(JSON.stringify(value)) : {};
}
