import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const before = {
    schedulesAusente: await prisma.schedule.count({ where: { status: "AUSENTE" } }),
    attendanceAusente: await prisma.attendanceRecord.count({ where: { status: "AUSENTE" } }),
    activeAtestadoReasons: await prisma.attendanceRecord.count({ where: { absenceReason: { equals: "Atestado", mode: "insensitive" } } }),
    activeAtestadoCategories: await prisma.attendanceRecord.count({ where: { reasonCategory: { equals: "Atestado", mode: "insensitive" } } }),
    importRowsAusente: await prisma.scheduleImportRow.count({ where: { status: { equals: "Ausente", mode: "insensitive" } } })
  };

  const [schedules, attendanceRecords, atestadoReasons, atestadoCategories, importRows] = await prisma.$transaction([
    prisma.schedule.updateMany({ where: { status: "AUSENTE" }, data: { status: "FALTA", updatedAt: new Date() } }),
    prisma.attendanceRecord.updateMany({ where: { status: "AUSENTE" }, data: { status: "FALTA", updatedAt: new Date() } }),
    prisma.attendanceRecord.updateMany({ where: { absenceReason: { equals: "Atestado", mode: "insensitive" } }, data: { absenceReason: "Ausente", updatedAt: new Date() } }),
    prisma.attendanceRecord.updateMany({ where: { reasonCategory: { equals: "Atestado", mode: "insensitive" } }, data: { reasonCategory: "Ausente", updatedAt: new Date() } }),
    prisma.scheduleImportRow.updateMany({ where: { status: { equals: "Ausente", mode: "insensitive" } }, data: { status: "Falta" } })
  ]);

  const after = {
    schedulesAusente: await prisma.schedule.count({ where: { status: "AUSENTE" } }),
    attendanceAusente: await prisma.attendanceRecord.count({ where: { status: "AUSENTE" } }),
    activeAtestadoReasons: await prisma.attendanceRecord.count({ where: { absenceReason: { equals: "Atestado", mode: "insensitive" } } }),
    activeAtestadoCategories: await prisma.attendanceRecord.count({ where: { reasonCategory: { equals: "Atestado", mode: "insensitive" } } }),
    importRowsAusente: await prisma.scheduleImportRow.count({ where: { status: { equals: "Ausente", mode: "insensitive" } } })
  };

  await prisma.auditLog.create({
    data: {
      action: "ALTERACAO_ESCALA",
      entity: "Schedule",
      reason: "Migração operacional: status Ausente convertido para Falta; motivo Atestado convertido para Ausente.",
      previousValue: before,
      newValue: {
        after,
        updated: {
          schedules: schedules.count,
          attendanceRecords: attendanceRecords.count,
          atestadoReasons: atestadoReasons.count,
          atestadoCategories: atestadoCategories.count,
          importRows: importRows.count
        }
      }
    }
  });

  console.log("Migração Ausente -> Falta concluída.");
  console.table({
    "Schedule.status AUSENTE -> FALTA": schedules.count,
    "AttendanceRecord.status AUSENTE -> FALTA": attendanceRecords.count,
    "AttendanceRecord.absenceReason Atestado -> Ausente": atestadoReasons.count,
    "AttendanceRecord.reasonCategory Atestado -> Ausente": atestadoCategories.count,
    "ScheduleImportRow.status Ausente -> Falta": importRows.count
  });
  console.log("Saldos após migração:", after);
}

main()
  .catch((error) => {
    console.error("Falha ao migrar Ausente para Falta.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
