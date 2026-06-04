import { PrismaClient, type ScheduleStatus } from "@prisma/client";

import { scheduleStatusForAbsenceClassification } from "../src/lib/absence-reasons";

const prisma = new PrismaClient();
const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const dryRun = args.has("--dry-run") || !apply;
const includeWithoutHistory = args.has("--include-without-history");
const legacyReason = "Ausente";
const wrongReason = "Problema de saúde";
const correctedReason = "Não informado";
const correctedClassification = "UNJUSTIFIED" as const;
const absenceScheduleStatuses: ScheduleStatus[] = ["FALTA", "FALTA_JUSTIFICADA", "FALTA_INJUSTIFICADA"];

async function main() {
  const safeCandidates = await prisma.attendanceRecord.findMany({
    where: {
      absenceReason: { equals: wrongReason, mode: "insensitive" },
      histories: {
        some: {
          previousReason: { equals: legacyReason, mode: "insensitive" }
        }
      },
      schedule: {
        deletedAt: null,
        status: { in: absenceScheduleStatuses }
      }
    },
    include: {
      schedule: { select: { id: true, status: true, employeeId: true, date: true } },
      histories: {
        where: { previousReason: { equals: legacyReason, mode: "insensitive" } },
        orderBy: { createdAt: "desc" },
        take: 1
      }
    }
  });

  const reviewCandidates = await prisma.attendanceRecord.findMany({
    where: {
      absenceReason: { equals: wrongReason, mode: "insensitive" },
      histories: {
        none: {
          previousReason: { equals: legacyReason, mode: "insensitive" }
        }
      },
      schedule: {
        deletedAt: null,
        status: { in: absenceScheduleStatuses }
      }
    },
    include: {
      schedule: { select: { id: true, status: true, employeeId: true, date: true } },
      histories: {
        where: { previousReason: { equals: legacyReason, mode: "insensitive" } },
        orderBy: { createdAt: "desc" },
        take: 1
      }
    }
  });

  const candidates = includeWithoutHistory ? [...safeCandidates, ...reviewCandidates] : safeCandidates;
  const nextScheduleStatus = scheduleStatusForAbsenceClassification(correctedClassification);
  const statusChanges = candidates.filter((record) => record.schedule?.status !== nextScheduleStatus).length;

  console.log("Reconciliação de faltas marcadas como Problema de saúde vindas de Ausente.");
  console.log(`Candidatos seguros com histórico Ausente: ${safeCandidates.length}`);
  console.log(`Candidatos sem histórico individual: ${reviewCandidates.length}`);
  console.log(`Incluindo sem histórico nesta execução: ${includeWithoutHistory ? "sim" : "não"}`);
  console.log(`Total que seria alterado nesta execução: ${candidates.length}`);
  console.log(`Schedules que mudariam para Falta Injustificada: ${statusChanges}`);

  if (dryRun) {
    console.log("Dry-run: nada foi alterado.");
    console.log("Para aplicar: npm run db:reconcile-absence-health-from-ausente -- --apply");
    console.log("Se todos os registros sem histórico também foram conversão indevida, use: npm run db:reconcile-absence-health-from-ausente -- --apply --include-without-history");
    return;
  }

  if (!candidates.length) {
    console.log("Nenhum registro seguro para corrigir.");
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
            absenceReason: correctedReason,
            reasonClassification: correctedClassification,
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
            newReason: correctedReason,
            comment: "RECONCILE_ABSENCE_HEALTH_FROM_AUSENTE"
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
                after: { status: savedSchedule.status, absenceReason: correctedReason, reasonClassification: correctedClassification },
                previousValue: { status: beforeScheduleStatus },
                newValue: { status: savedSchedule.status, reasonClassification: correctedClassification },
                reason: "RECONCILE_ABSENCE_HEALTH_FROM_AUSENTE"
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
      reason: "RECONCILE_ABSENCE_HEALTH_FROM_AUSENTE",
      previousValue: { previousReason: legacyReason, previousMappedReason: wrongReason },
      newValue: {
        updatedRecords: candidates.length,
        nextReason: correctedReason,
        nextClassification: correctedClassification,
        nextScheduleStatus,
        withoutHistory: reviewCandidates.length,
        includeWithoutHistory,
        executedAt: now.toISOString(),
        origin: "script"
      }
    }
  });

  console.log("Reconciliação aplicada.");
  console.log(`Registros atualizados: ${candidates.length}`);
}

main()
  .catch((error) => {
    console.error("Falha ao reconciliar faltas vindas de Ausente.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
