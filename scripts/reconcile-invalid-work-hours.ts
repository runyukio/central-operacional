import { PrismaClient } from "@prisma/client";
import { isWorkHoursAllowedForSchedule, workHoursBlockedReasonForSchedule } from "../src/lib/work-hours-rules";

const prisma = new PrismaClient();
const args = new Set(process.argv.slice(2));
const allowedArgs = new Set(["--dry-run", "--apply"]);
const unknownArgs = Array.from(args).filter((arg) => !allowedArgs.has(arg));
const apply = args.has("--apply");
const dryRun = args.has("--dry-run") || !apply;

async function findInvalidWorkHours() {
  const records = await prisma.workHourRecord.findMany({
    select: {
      id: true,
      employeeId: true,
      wbLogin: true,
      date: true,
      scheduleId: true,
      importBatchId: true,
      schedule: {
        select: {
          id: true,
          status: true,
          startsAt: true,
          endsAt: true
        }
      }
    }
  });

  return records
    .filter((record) => !isWorkHoursAllowedForSchedule(record.schedule))
    .map((record) => ({
      ...record,
      reason: workHoursBlockedReasonForSchedule(record.schedule)
    }));
}

async function main() {
  if (unknownArgs.length) {
    console.error(`Argumento(s) inválido(s): ${unknownArgs.join(", ")}`);
    console.error("Use: npm run db:reconcile-invalid-work-hours -- --dry-run");
    console.error(" ou: npm run db:reconcile-invalid-work-hours -- --apply");
    process.exitCode = 1;
    return;
  }

  const invalidRecords = await findInvalidWorkHours();
  const invalidRecordIds = invalidRecords.map((record) => record.id);
  const [adjustments, histories] = invalidRecordIds.length
    ? await Promise.all([
      prisma.workHourAdjustmentRequest.count({ where: { workHourRecordId: { in: invalidRecordIds } } }),
      prisma.workHourHistory.count({ where: { workHourRecordId: { in: invalidRecordIds } } })
    ])
    : [0, 0];

  const summary = {
    invalidWorkHourRecords: invalidRecords.length,
    relatedAdjustmentRequests: adjustments,
    relatedHistories: histories,
    affectedImportBatches: new Set(invalidRecords.map((record) => record.importBatchId).filter(Boolean)).size
  };

  if (!invalidRecords.length) {
    console.log("Nenhum registro de horas inválido encontrado.");
    console.table(summary);
    return;
  }

  if (dryRun) {
    console.log("Dry-run de reconciliação de Horas Operacionais inválidas. Nada foi alterado.");
    console.table(summary);
    console.log("Primeiros registros inválidos:");
    console.table(invalidRecords.slice(0, 20).map((record) => ({
      id: record.id,
      wbLogin: record.wbLogin,
      date: record.date.toISOString().slice(0, 10),
      scheduleId: record.scheduleId ?? "sem scheduleId",
      status: record.schedule?.status ?? "sem cronograma",
      reason: record.reason
    })));
    console.log("Para aplicar: npm run db:reconcile-invalid-work-hours -- --apply");
    return;
  }

  const result = await prisma.workHourRecord.deleteMany({
    where: { id: { in: invalidRecordIds } }
  });

  console.log("Reconciliação aplicada. Registros de horas inválidos removidos.");
  console.table({
    ...summary,
    removedWorkHourRecords: result.count
  });
}

main()
  .catch((error) => {
    console.error("Falha ao reconciliar Horas Operacionais inválidas.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
