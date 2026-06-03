import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const dryRun = args.has("--dry-run") || !apply;

const deprecatedReasons = ["Ausente", "AUSENTE", "ausente"];
const replacementReason = "Problema de saúde";

const reasonWhere = (field: "absenceReason" | "reasonCategory" | "previousReason" | "newReason") => ({
  [field]: { equals: "Ausente", mode: "insensitive" as const }
});

async function main() {
  const now = new Date();
  const before = {
    attendanceRecordAbsenceReason: await prisma.attendanceRecord.count({ where: reasonWhere("absenceReason") }),
    attendanceRecordReasonCategory: await prisma.attendanceRecord.count({ where: reasonWhere("reasonCategory") }),
    attendanceHistoryPreviousReason: await prisma.attendanceHistory.count({ where: reasonWhere("previousReason") }),
    attendanceHistoryNewReason: await prisma.attendanceHistory.count({ where: reasonWhere("newReason") })
  };
  const total = Object.values(before).reduce((sum, value) => sum + value, 0);

  if (dryRun) {
    console.log("Dry-run da migração de motivo de justificativa Ausente -> Problema de saúde. Nada foi alterado.");
    console.table(before);
    console.log(`Total de campos encontrados com motivo legado: ${total}`);
    console.log("Para aplicar: npm run db:migrate-ausente-to-problema-saude -- --apply");
    return;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const [
      attendanceRecordAbsenceReason,
      attendanceRecordReasonCategory,
      attendanceHistoryPreviousReason,
      attendanceHistoryNewReason
    ] = await Promise.all([
      tx.attendanceRecord.updateMany({
        where: reasonWhere("absenceReason"),
        data: { absenceReason: replacementReason, updatedAt: now }
      }),
      tx.attendanceRecord.updateMany({
        where: reasonWhere("reasonCategory"),
        data: { reasonCategory: replacementReason, updatedAt: now }
      }),
      tx.attendanceHistory.updateMany({
        where: reasonWhere("previousReason"),
        data: { previousReason: replacementReason }
      }),
      tx.attendanceHistory.updateMany({
        where: reasonWhere("newReason"),
        data: { newReason: replacementReason }
      })
    ]);

    await tx.auditLog.create({
      data: {
        action: "EDICAO",
        entity: "AttendanceRecord",
        reason: "MIGRATE_ABSENCE_REASON_AUSENTE_TO_PROBLEMA_SAUDE",
        previousValue: { deprecatedReasons, before },
        newValue: {
          replacementReason,
          updated: {
            attendanceRecordAbsenceReason: attendanceRecordAbsenceReason.count,
            attendanceRecordReasonCategory: attendanceRecordReasonCategory.count,
            attendanceHistoryPreviousReason: attendanceHistoryPreviousReason.count,
            attendanceHistoryNewReason: attendanceHistoryNewReason.count
          }
        }
      }
    });

    return {
      attendanceRecordAbsenceReason: attendanceRecordAbsenceReason.count,
      attendanceRecordReasonCategory: attendanceRecordReasonCategory.count,
      attendanceHistoryPreviousReason: attendanceHistoryPreviousReason.count,
      attendanceHistoryNewReason: attendanceHistoryNewReason.count
    };
  });

  console.log("Migração de motivo de justificativa Ausente -> Problema de saúde aplicada.");
  console.table(updated);
  console.log("Schedule.status não foi alterado.");
}

main()
  .catch((error) => {
    console.error("Falha ao migrar motivo de justificativa Ausente para Problema de saúde.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
