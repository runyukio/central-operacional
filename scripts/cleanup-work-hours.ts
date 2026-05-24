import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const args = new Set(process.argv.slice(2));
const allowedArgs = new Set(["--dry-run", "--apply"]);
const unknownArgs = Array.from(args).filter((arg) => !allowedArgs.has(arg));
const apply = args.has("--apply");
const dryRun = args.has("--dry-run") || !apply;

const auditLogWhere = {
  entity: {
    in: ["WorkHourRecord", "WorkHourAdjustmentRequest", "WorkHourImportBatch"]
  }
};

const notificationWhere = {
  OR: [
    { category: "Horas Operacionais" },
    {
      entity: {
        in: ["WorkHourRecord", "WorkHourAdjustmentRequest", "WorkHourImportBatch"]
      }
    },
    { href: "/horas-operacionais" }
  ]
};

type CleanupSummary = {
  workHourRecords: number;
  workHourAdjustmentRequests: number;
  workHourHistories: number;
  workHourImportBatches: number;
  workHourNotifications: number;
  workHourAuditLogsPreserved: number;
  totalRemovable: number;
};

async function collectSummary(): Promise<CleanupSummary> {
  const [
    workHourRecords,
    workHourAdjustmentRequests,
    workHourHistories,
    workHourImportBatches,
    workHourNotifications,
    workHourAuditLogsPreserved
  ] = await Promise.all([
    prisma.workHourRecord.count(),
    prisma.workHourAdjustmentRequest.count(),
    prisma.workHourHistory.count(),
    prisma.workHourImportBatch.count(),
    prisma.notification.count({ where: notificationWhere }),
    prisma.auditLog.count({ where: auditLogWhere })
  ]);

  return {
    workHourRecords,
    workHourAdjustmentRequests,
    workHourHistories,
    workHourImportBatches,
    workHourNotifications,
    workHourAuditLogsPreserved,
    totalRemovable: workHourRecords + workHourAdjustmentRequests + workHourHistories + workHourImportBatches + workHourNotifications
  };
}

function printSummary(title: string, summary: CleanupSummary) {
  console.log(title);
  console.table({
    "WorkHourRecord encontrados/removíveis": summary.workHourRecords,
    "WorkHourAdjustmentRequest encontrados/removíveis": summary.workHourAdjustmentRequests,
    "WorkHourHistory encontrados/removíveis": summary.workHourHistories,
    "WorkHourImportBatch encontrados/removíveis": summary.workHourImportBatches,
    "Notificações de Horas Operacionais encontradas/removíveis": summary.workHourNotifications,
    "AuditLogs de horas encontrados/preservados": summary.workHourAuditLogsPreserved,
    "Total removível": summary.totalRemovable
  });
}

async function applyCleanup() {
  return prisma.$transaction(async (tx) => {
    const notifications = await tx.notification.deleteMany({ where: notificationWhere });
    const adjustments = await tx.workHourAdjustmentRequest.deleteMany();
    const histories = await tx.workHourHistory.deleteMany();
    const records = await tx.workHourRecord.deleteMany();
    const batches = await tx.workHourImportBatch.deleteMany();

    return {
      workHourRecords: records.count,
      workHourAdjustmentRequests: adjustments.count,
      workHourHistories: histories.count,
      workHourImportBatches: batches.count,
      workHourNotifications: notifications.count,
      workHourAuditLogsPreserved: await tx.auditLog.count({ where: auditLogWhere }),
      totalRemovable: records.count + adjustments.count + histories.count + batches.count + notifications.count
    } satisfies CleanupSummary;
  });
}

async function main() {
  if (unknownArgs.length) {
    console.error(`Argumento(s) inválido(s): ${unknownArgs.join(", ")}`);
    console.error("Use: npm run db:cleanup-work-hours -- --dry-run");
    console.error(" ou: npm run db:cleanup-work-hours -- --apply");
    process.exitCode = 1;
    return;
  }

  const before = await collectSummary();

  if (before.totalRemovable === 0) {
    console.log("Nenhum registro de horas encontrado.");
    printSummary("Resumo atual:", before);
    return;
  }

  if (dryRun) {
    printSummary("Dry-run de limpeza de Horas Operacionais. Nada foi alterado.", before);
    console.log("Para aplicar a limpeza: npm run db:cleanup-work-hours -- --apply");
    return;
  }

  const removed = await applyCleanup();
  printSummary("Limpeza de Horas Operacionais aplicada.", removed);

  const after = await collectSummary();
  printSummary("Resumo após limpeza:", after);
}

main()
  .catch((error) => {
    console.error("Falha ao limpar Horas Operacionais.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
