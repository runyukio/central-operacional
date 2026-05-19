import { PrismaClient, type AttendanceStatus, type ScheduleStatus } from "@prisma/client";

const prisma = new PrismaClient();
const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const dryRun = args.has("--dry-run") || !apply;
const restoreAfastado = args.has("--restore-afastado-from-history");

type JsonRecord = Record<string, unknown>;

const nonAbsenceAttendanceBySchedule: Partial<Record<ScheduleStatus, AttendanceStatus>> = {
  ESCALADO: "PRESENTE",
  PRESENTE: "PRESENTE",
  ATRASO: "ATRASO",
  SAIDA_ANTECIPADA: "SAIDA_ANTECIPADA",
  AFASTADO: "AFASTADO",
  FOLGA: "FOLGA",
  FERIAS: "FERIAS",
  TREINAMENTO: "TREINAMENTO",
  NESTING: "PRESENTE",
  TROCA_APROVADA: "TROCA_APROVADA",
  VENDA_FOLGA_APROVADA: "PRESENTE",
  FOLGA_APROVADA: "FOLGA",
  SEM_ESCALA: "SEM_ESCALA",
  ERRO_ESCALA: "ERRO_ESCALA",
  FERIADO: "SEM_ESCALA",
  CONFLITO: "SEM_ESCALA",
  DESCOBERTO: "SEM_ESCALA"
};

function jsonStatus(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const record = value as JsonRecord;
  const raw = record.status ?? record.newStatus ?? record.previousStatus;
  return String(raw ?? "").toUpperCase();
}

function hasAfastadoHistory(value: unknown) {
  return jsonStatus(value) === "AFASTADO" || JSON.stringify(value ?? {}).includes("AFASTADO");
}

function attendanceStatusForSchedule(status: ScheduleStatus): AttendanceStatus {
  if (status === "AUSENTE" || status === "FALTA") return "FALTA";
  return nonAbsenceAttendanceBySchedule[status] ?? "SEM_ESCALA";
}

async function main() {
  const now = new Date();
  const summary = {
    faltaWithoutAttendance: 0,
    pendingCreated: 0,
    nonFaltaPendingResolved: 0,
    afastadoPendingResolved: 0,
    scheduleAusenteToFalta: 0,
    attendanceAusenteToFalta: 0,
    potentialAfastadoConvertedToFalta: 0,
    restoredAfastadoFromHistory: 0,
    ignored: 0
  };

  const faltaSchedules = await prisma.schedule.findMany({
    where: { status: "FALTA", deletedAt: null },
    include: {
      attendanceRecords: {
        orderBy: { updatedAt: "desc" },
        take: 1
      }
    }
  });
  const faltaWithoutAttendance = faltaSchedules.filter((schedule) => !schedule.attendanceRecords.length);
  summary.faltaWithoutAttendance = faltaWithoutAttendance.length;
  summary.pendingCreated = faltaWithoutAttendance.length;

  const nonFaltaPending = await prisma.attendanceRecord.findMany({
    where: {
      isJustified: false,
      schedule: {
        deletedAt: null,
        status: { not: "FALTA" }
      }
    },
    include: { schedule: { select: { id: true, status: true } } }
  });
  summary.nonFaltaPendingResolved = nonFaltaPending.length;
  summary.afastadoPendingResolved = nonFaltaPending.filter((record) => record.status === "AFASTADO" || record.schedule?.status === "AFASTADO").length;

  const scheduleAusente = await prisma.schedule.findMany({
    where: { status: "AUSENTE", deletedAt: null },
    select: { id: true }
  });
  summary.scheduleAusenteToFalta = scheduleAusente.length;

  const attendanceAusente = await prisma.attendanceRecord.findMany({
    where: { status: "AUSENTE" },
    select: { id: true }
  });
  summary.attendanceAusenteToFalta = attendanceAusente.length;

  const currentFaltaById = new Set(faltaSchedules.map((schedule) => schedule.id));
  const histories = await prisma.scheduleChangeHistory.findMany({
    where: { scheduleId: { not: null } },
    select: { scheduleId: true, before: true, previousValue: true },
    orderBy: { createdAt: "desc" },
    take: 20000
  });
  const potentialAfastadoScheduleIds = Array.from(new Set(
    histories
      .filter((history) => history.scheduleId && currentFaltaById.has(history.scheduleId) && (hasAfastadoHistory(history.before) || hasAfastadoHistory(history.previousValue)))
      .map((history) => history.scheduleId!)
  ));
  summary.potentialAfastadoConvertedToFalta = potentialAfastadoScheduleIds.length;
  summary.restoredAfastadoFromHistory = restoreAfastado ? potentialAfastadoScheduleIds.length : 0;

  if (dryRun) {
    console.log("Dry-run de reconciliação de faltas/justificativas. Nada foi alterado.");
    console.table(summary);
    if (potentialAfastadoScheduleIds.length) {
      console.log("Há registros atuais como Falta com histórico anterior de Afastado.");
      console.log("Para restaurar esses casos junto com o apply, rode com --restore-afastado-from-history.");
    }
    console.log("Para aplicar: npm run db:reconcile-absence-justifications -- --apply");
    return;
  }

  await prisma.$transaction(async (tx) => {
    if (scheduleAusente.length) {
      await tx.schedule.updateMany({
        where: { id: { in: scheduleAusente.map((schedule) => schedule.id) } },
        data: { status: "FALTA", updatedAt: now }
      });
    }

    if (attendanceAusente.length) {
      await tx.attendanceRecord.updateMany({
        where: { id: { in: attendanceAusente.map((record) => record.id) } },
        data: { status: "FALTA", updatedAt: now }
      });
    }

    for (const schedule of faltaWithoutAttendance) {
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
          comment: "Pendência criada por reconciliação: Schedule.status = Falta sem AttendanceRecord."
        }
      });
    }

    for (const record of nonFaltaPending) {
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

    if (restoreAfastado && potentialAfastadoScheduleIds.length) {
      await tx.schedule.updateMany({
        where: { id: { in: potentialAfastadoScheduleIds }, status: "FALTA" },
        data: { status: "AFASTADO", updatedAt: now }
      });
      await tx.attendanceRecord.updateMany({
        where: { scheduleId: { in: potentialAfastadoScheduleIds }, isJustified: false },
        data: {
          status: "AFASTADO",
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
    }

    await tx.auditLog.create({
      data: {
        action: "ALTERACAO_ESCALA",
        entity: "AttendanceRecord",
        reason: "Reconciliação geral de faltas, afastados e justificativas pendentes.",
        newValue: { ...summary, dryRun: false, restoreAfastado }
      }
    });
  });

  console.log("Reconciliação de faltas/justificativas aplicada.");
  console.table(summary);
}

main()
  .catch((error) => {
    console.error("Falha ao reconciliar faltas/justificativas.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
