import { PrismaClient, type AttendanceStatus, type ScheduleStatus } from "@prisma/client";

const prisma = new PrismaClient();
const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const dryRun = args.has("--dry-run") || !apply;

function attendanceStatusForSchedule(status: ScheduleStatus): AttendanceStatus {
  switch (status) {
    case "AUSENTE":
    case "FALTA":
      return "FALTA";
    case "PRESENTE":
    case "NESTING":
    case "VENDA_FOLGA_APROVADA":
    case "FOLGA_APROVADA":
      return "PRESENTE";
    case "ATRASO":
      return "ATRASO";
    case "SAIDA_ANTECIPADA":
      return "SAIDA_ANTECIPADA";
    case "AFASTADO":
      return "AFASTADO";
    case "FERIAS":
      return "FERIAS";
    case "TREINAMENTO":
      return "TREINAMENTO";
    case "FOLGA":
      return "FOLGA";
    case "TROCA_APROVADA":
      return "TROCA_APROVADA";
    case "ERRO_ESCALA":
      return "ERRO_ESCALA";
    default:
      return "SEM_ESCALA";
  }
}

async function main() {
  const now = new Date();
  const summary = {
    schedulesAusenteToFalta: 0,
    attendanceAusenteToFalta: 0,
    pendingCreated: 0,
    pendingResolved: 0,
    ignored: 0
  };

  const schedulesAusente = await prisma.schedule.findMany({
    where: { status: "AUSENTE", deletedAt: null },
    select: { id: true }
  });
  summary.schedulesAusenteToFalta = schedulesAusente.length;

  const attendanceAusente = await prisma.attendanceRecord.findMany({
    where: { status: "AUSENTE" },
    select: { id: true }
  });
  summary.attendanceAusenteToFalta = attendanceAusente.length;

  const faltaSchedules = await prisma.schedule.findMany({
    where: { status: { in: ["AUSENTE", "FALTA"] }, deletedAt: null },
    include: {
      attendanceRecords: {
        orderBy: { updatedAt: "desc" },
        take: 1
      }
    }
  });

  const missingAttendanceSchedules = faltaSchedules.filter((schedule) => !schedule.attendanceRecords.length);
  summary.pendingCreated = missingAttendanceSchedules.length;

  const stalePendingRecords = await prisma.attendanceRecord.findMany({
    where: {
      isJustified: false,
      schedule: {
        deletedAt: null,
        status: { not: "FALTA" }
      }
    },
    include: {
      schedule: { select: { id: true, status: true } }
    }
  });
  summary.pendingResolved = stalePendingRecords.length;

  if (dryRun) {
    console.log("Dry-run de reconciliação de justificativas. Nada foi alterado.");
    console.table(summary);
    console.log("Para aplicar: npm run db:reconcile-attendance -- --apply");
    return;
  }

  await prisma.$transaction(async (tx) => {
    if (schedulesAusente.length) {
      await tx.schedule.updateMany({
        where: { id: { in: schedulesAusente.map((schedule) => schedule.id) } },
        data: { status: "FALTA", updatedAt: now }
      });
    }

    if (attendanceAusente.length) {
      await tx.attendanceRecord.updateMany({
        where: { id: { in: attendanceAusente.map((record) => record.id) } },
        data: { status: "FALTA", updatedAt: now }
      });
    }

    for (const schedule of missingAttendanceSchedules) {
      const record = await tx.attendanceRecord.create({
        data: {
          employeeId: schedule.employeeId,
          scheduleId: schedule.id,
          date: schedule.date,
          shiftId: schedule.shiftId,
          status: "FALTA",
          absenceReason: "Sem justificativa",
          reasonCategory: "Cronograma",
          supervisorJustification: null,
          isJustified: false,
          impactsAbs: true,
          impactsCoverage: true
        }
      });
      await tx.attendanceHistory.create({
        data: {
          attendanceRecordId: record.id,
          previousStatus: null,
          newStatus: "FALTA",
          previousReason: null,
          newReason: "Sem justificativa",
          comment: "Pendência criada por reconciliação de Falta sem AttendanceRecord."
        }
      });
    }

    for (const record of stalePendingRecords) {
      const nextStatus = attendanceStatusForSchedule(record.schedule?.status ?? "SEM_ESCALA");
      const saved = await tx.attendanceRecord.update({
        where: { id: record.id },
        data: {
          status: nextStatus,
          absenceReason: null,
          reasonCategory: null,
          supervisorJustification: null,
          isJustified: true,
          impactsAbs: false,
          impactsCoverage: false,
          justifiedAt: now,
          updatedAt: now
        }
      });
      await tx.attendanceHistory.create({
        data: {
          attendanceRecordId: saved.id,
          previousStatus: record.status,
          newStatus: saved.status,
          previousReason: record.absenceReason,
          newReason: null,
          comment: `Pendência encerrada por reconciliação: cronograma atual está como ${record.schedule?.status ?? "SEM_ESCALA"}.`
        }
      });
    }

    await tx.auditLog.create({
      data: {
        action: "ALTERACAO_ESCALA",
        entity: "AttendanceRecord",
        reason: "Reconciliação de faltas, justificativas pendentes e registros legados Ausente.",
        newValue: summary
      }
    });
  });

  console.log("Reconciliação de justificativas aplicada.");
  console.table(summary);
}

main()
  .catch((error) => {
    console.error("Falha ao reconciliar justificativas.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
