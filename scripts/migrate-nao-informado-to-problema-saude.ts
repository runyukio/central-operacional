import { PrismaClient, type ScheduleStatus } from "@prisma/client";

import { scheduleStatusForAbsenceClassification } from "../src/lib/absence-reasons";

const prisma = new PrismaClient();
const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const dryRun = args.has("--dry-run") || !apply;
const previousReason = "Não informado";
const nextReason = "Problema de saúde";
const nextClassification = "JUSTIFIED" as const;
const absenceScheduleStatuses: ScheduleStatus[] = ["FALTA", "FALTA_JUSTIFICADA", "FALTA_INJUSTIFICADA"];

async function main() {
  const candidates = await prisma.attendanceRecord.findMany({
    where: {
      absenceReason: { equals: previousReason, mode: "insensitive" },
      schedule: {
        deletedAt: null,
        status: { in: absenceScheduleStatuses }
      }
    },
    include: {
      schedule: { select: { id: true, status: true, employeeId: true, date: true } }
    },
    orderBy: { updatedAt: "asc" }
  });

  const nextScheduleStatus = scheduleStatusForAbsenceClassification(nextClassification);
  const statusChanges = candidates.filter((record) => record.schedule?.status !== nextScheduleStatus).length;

  console.log("Migração de motivo Não informado -> Problema de saúde.");
  console.log(`Registros que seriam alterados: ${candidates.length}`);
  console.log(`Schedules que mudariam para Falta Justificada: ${statusChanges}`);

  if (dryRun) {
    console.log("Dry-run: nada foi alterado.");
    console.log("Para aplicar: npm run db:migrate-nao-informado-to-problema-saude -- --apply");
    return;
  }

  if (!candidates.length) {
    console.log("Nenhum registro encontrado para migrar.");
    return;
  }

  const systemUser = await prisma.user.findFirst({
    where: { deletedAt: null, role: { name: { in: ["ADMIN", "WFM"] } } },
    orderBy: { createdAt: "asc" },
    select: { id: true }
  });
  const now = new Date();

  for (let index = 0; index < candidates.length; index += 100) {
    const chunk = candidates.slice(index, index + 100);
    await prisma.$transaction(async (tx) => {
      for (const record of chunk) {
        const beforeScheduleStatus = record.schedule?.status ?? null;
        const updated = await tx.attendanceRecord.update({
          where: { id: record.id },
          data: {
            absenceReason: nextReason,
            reasonClassification: nextClassification,
            isJustified: true,
            impactsAbs: true,
            impactsCoverage: true,
            updatedAt: now
          }
        });

        await tx.attendanceHistory.create({
          data: {
            attendanceRecordId: record.id,
            changedById: systemUser?.id,
            previousStatus: record.status,
            newStatus: updated.status,
            previousReason: record.absenceReason,
            newReason: nextReason,
            comment: "MIGRATE_NAO_INFORMADO_TO_PROBLEMA_SAUDE"
          }
        });

        if (record.schedule && record.schedule.status !== nextScheduleStatus) {
          const savedSchedule = await tx.schedule.update({
            where: { id: record.schedule.id },
            data: { status: nextScheduleStatus, updatedAt: now }
          });

          if (systemUser?.id) {
            await tx.scheduleChangeHistory.create({
              data: {
                scheduleId: record.schedule.id,
                employeeId: record.schedule.employeeId,
                changedById: systemUser.id,
                date: record.schedule.date,
                before: { status: beforeScheduleStatus, absenceReason: record.absenceReason },
                after: { status: savedSchedule.status, absenceReason: nextReason, reasonClassification: nextClassification },
                previousValue: { status: beforeScheduleStatus },
                newValue: { status: savedSchedule.status, reasonClassification: nextClassification },
                reason: "MIGRATE_NAO_INFORMADO_TO_PROBLEMA_SAUDE"
              }
            });
          }
        }
      }
    }, { maxWait: 10000, timeout: 20000 });
  }

  await prisma.auditLog.create({
    data: {
      actorId: systemUser?.id,
      action: "EDICAO",
      entity: "AttendanceRecord",
      reason: "MIGRATE_NAO_INFORMADO_TO_PROBLEMA_SAUDE",
      previousValue: { reason: previousReason },
      newValue: {
        updatedRecords: candidates.length,
        nextReason,
        nextClassification,
        nextScheduleStatus,
        executedAt: now.toISOString(),
        origin: "script"
      }
    }
  });

  console.log("Migração aplicada.");
  console.log(`Registros atualizados: ${candidates.length}`);
}

main()
  .catch((error) => {
    console.error("Falha ao migrar Não informado para Problema de saúde.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
