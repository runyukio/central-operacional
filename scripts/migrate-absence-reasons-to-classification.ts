import { PrismaClient, type ScheduleStatus } from "@prisma/client";

import {
  absenceReasonClassificationLabel,
  getAbsenceReasonClassification,
  normalizeHistoricalAbsenceReason,
  scheduleStatusForAbsenceClassification
} from "../src/lib/absence-reasons";

const prisma = new PrismaClient();
const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const dryRun = args.has("--dry-run") || !apply;
const absenceScheduleStatuses: ScheduleStatus[] = ["FALTA", "FALTA_JUSTIFICADA", "FALTA_INJUSTIFICADA"];

type MigrationPlanRow = {
  attendanceRecordId: string;
  scheduleId: string | null;
  employeeId: string;
  date: Date;
  previousReason: string | null;
  nextReason: string;
  classification: "JUSTIFIED" | "UNJUSTIFIED";
  previousScheduleStatus: ScheduleStatus | null;
  nextScheduleStatus: ScheduleStatus;
};

function key(parts: Array<string | null | undefined>) {
  return parts.map((part) => part || "-").join(" -> ");
}

async function buildPlan(): Promise<MigrationPlanRow[]> {
  const records = await prisma.attendanceRecord.findMany({
    where: {
      absenceReason: { not: null },
      schedule: {
        deletedAt: null,
        status: { in: absenceScheduleStatuses }
      }
    },
    include: {
      schedule: {
        select: {
          id: true,
          status: true
        }
      }
    },
    orderBy: { updatedAt: "asc" }
  });

  return records.flatMap((record) => {
    const nextReason = normalizeHistoricalAbsenceReason(record.absenceReason);
    if (!nextReason) return [];
    const classification = getAbsenceReasonClassification(nextReason);
    if (!classification) return [];
    return [{
      attendanceRecordId: record.id,
      scheduleId: record.scheduleId,
      employeeId: record.employeeId,
      date: record.date,
      previousReason: record.absenceReason,
      nextReason,
      classification,
      previousScheduleStatus: record.schedule?.status ?? null,
      nextScheduleStatus: scheduleStatusForAbsenceClassification(classification)
    }];
  });
}

function summarize(plan: MigrationPlanRow[]) {
  const byReason = plan.reduce<Record<string, number>>((acc, row) => {
    const summaryKey = key([row.previousReason, row.nextReason, absenceReasonClassificationLabel(row.classification)]);
    acc[summaryKey] = (acc[summaryKey] ?? 0) + 1;
    return acc;
  }, {});
  const byScheduleStatus = plan.reduce<Record<string, number>>((acc, row) => {
    const summaryKey = key([row.previousScheduleStatus, row.nextScheduleStatus]);
    acc[summaryKey] = (acc[summaryKey] ?? 0) + 1;
    return acc;
  }, {});
  return { byReason, byScheduleStatus };
}

async function main() {
  const plan = await buildPlan();
  const summary = summarize(plan);

  if (dryRun) {
    console.log("Dry-run da migração de motivos para classificação. Nada foi alterado.");
    console.log(`Registros de AttendanceRecord que seriam atualizados: ${plan.length}`);
    console.log("Motivo antigo -> motivo novo -> classificação:");
    console.table(summary.byReason);
    console.log("Schedule.status anterior -> novo:");
    console.table(summary.byScheduleStatus);
    console.log("Para aplicar: npm run db:migrate-absence-reasons-classification -- --apply");
    return;
  }

  const systemUser = await prisma.user.findFirst({
    where: { deletedAt: null, role: { name: { in: ["ADMIN", "WFM"] } } },
    orderBy: { createdAt: "asc" },
    select: { id: true }
  });
  const now = new Date();

  for (let index = 0; index < plan.length; index += 100) {
    const chunk = plan.slice(index, index + 100);
    await prisma.$transaction(async (tx) => {
      for (const row of chunk) {
        const updated = await tx.attendanceRecord.update({
          where: { id: row.attendanceRecordId },
          data: {
            absenceReason: row.nextReason,
            reasonClassification: row.classification,
            isJustified: true,
            impactsAbs: true,
            impactsCoverage: true,
            updatedAt: now
          }
        });
        await tx.attendanceHistory.create({
          data: {
            attendanceRecordId: row.attendanceRecordId,
            changedById: systemUser?.id,
            previousStatus: updated.status,
            newStatus: updated.status,
            previousReason: row.previousReason,
            newReason: row.nextReason,
            comment: `MIGRATE_ABSENCE_REASONS_CLASSIFICATION: ${absenceReasonClassificationLabel(row.classification)}`
          }
        });

        if (row.scheduleId && row.previousScheduleStatus !== row.nextScheduleStatus) {
          const savedSchedule = await tx.schedule.update({
            where: { id: row.scheduleId },
            data: {
              status: row.nextScheduleStatus,
              updatedAt: now
            }
          });
          if (systemUser?.id) {
            await tx.scheduleChangeHistory.create({
              data: {
                scheduleId: row.scheduleId,
                employeeId: row.employeeId,
                changedById: systemUser.id,
                date: row.date,
                before: { status: row.previousScheduleStatus, absenceReason: row.previousReason },
                after: { status: savedSchedule.status, absenceReason: row.nextReason, reasonClassification: row.classification },
                previousValue: { status: row.previousScheduleStatus },
                newValue: { status: savedSchedule.status, reasonClassification: row.classification },
                reason: "MIGRATE_ABSENCE_REASONS_CLASSIFICATION"
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
      reason: "MIGRATE_ABSENCE_REASONS_TO_CLASSIFICATION",
      previousValue: { totalPlanned: plan.length },
      newValue: {
        updatedRecords: plan.length,
        byReason: summary.byReason,
        byScheduleStatus: summary.byScheduleStatus,
        executedAt: now.toISOString(),
        origin: "script"
      }
    }
  });

  console.log("Migração de motivos para classificação aplicada.");
  console.log(`Registros atualizados: ${plan.length}`);
  console.table(summary.byReason);
  console.table(summary.byScheduleStatus);
}

main()
  .catch((error) => {
    console.error("Falha ao migrar motivos para classificação.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
