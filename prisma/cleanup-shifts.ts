import { Prisma, PrismaClient } from "@prisma/client";

import { cleanShiftName, shiftLookupKey } from "../src/lib/shift-display";

const prisma = new PrismaClient();

const SHIFT_STATUS_CONFIG_KEY = "settings.shiftStatus";

const standardShifts: Record<string, { startsAt: string; endsAt: string; color: string }> = {
  Manhã: { startsAt: "08:00", endsAt: "14:00", color: "#2563EB" },
  Tarde: { startsAt: "14:00", endsAt: "20:00", color: "#F97316" },
  Noite: { startsAt: "20:00", endsAt: "02:00", color: "#7C3AED" },
  Folga: { startsAt: "", endsAt: "", color: "#64748B" }
};

const blockedShiftKeys = new Set(["FERIAS", "PLANTAO"]);

async function main() {
  const targetShifts = new Map<string, { id: string; name: string }>();
  for (const [name, data] of Object.entries(standardShifts)) {
    const shift = await prisma.shift.upsert({
      where: { name },
      update: data,
      create: { name, ...data }
    });
    targetShifts.set(name, { id: shift.id, name: shift.name });
  }

  const shiftStatus = await readShiftStatusMap();
  const allShifts = await prisma.shift.findMany({ orderBy: { name: "asc" } });
  const stats = {
    employees: 0,
    schedules: 0,
    attendanceRecords: 0,
    staffCoverages: 0,
    staffCoveragesSkipped: 0,
    shiftReports: 0,
    oldShiftsInactivated: 0,
    blockedShiftsInactivated: 0
  };

  for (const shift of allShifts) {
    const cleanName = cleanShiftName(shift.name);
    const target = targetShifts.get(cleanName);

    if (target && target.id !== shift.id) {
      const migrated = await migrateShiftReferences(shift.id, target.id);
      stats.employees += migrated.employees;
      stats.schedules += migrated.schedules;
      stats.attendanceRecords += migrated.attendanceRecords;
      stats.staffCoverages += migrated.staffCoverages;
      stats.staffCoveragesSkipped += migrated.staffCoveragesSkipped;
      stats.shiftReports += migrated.shiftReports;
      shiftStatus[shift.id] = "INACTIVE";
      stats.oldShiftsInactivated += 1;
      continue;
    }

    if (blockedShiftKeys.has(shiftLookupKey(cleanName))) {
      shiftStatus[shift.id] = "INACTIVE";
      stats.blockedShiftsInactivated += 1;
    }
  }

  for (const target of targetShifts.values()) {
    shiftStatus[target.id] = "ACTIVE";
  }

  await prisma.systemConfig.upsert({
    where: { key: SHIFT_STATUS_CONFIG_KEY },
    update: { value: shiftStatus as Prisma.JsonObject, description: "Status configurável de turnos após limpeza de nomes antigos" },
    create: { key: SHIFT_STATUS_CONFIG_KEY, value: shiftStatus as Prisma.JsonObject, description: "Status configurável de turnos após limpeza de nomes antigos" }
  });

  console.log("Turnos normalizados com sucesso.");
  console.table(stats);
}

async function migrateShiftReferences(fromShiftId: string, toShiftId: string) {
  const employees = await prisma.employeeProfile.updateMany({ where: { shiftId: fromShiftId }, data: { shiftId: toShiftId } });
  const schedules = await prisma.schedule.updateMany({ where: { shiftId: fromShiftId }, data: { shiftId: toShiftId } });
  const attendanceRecords = await migrateAttendanceRecords(fromShiftId, toShiftId);
  const staffCoverages = await migrateStaffCoverage(fromShiftId, toShiftId);
  const shiftReports = await prisma.shiftReport.updateMany({ where: { shiftId: fromShiftId }, data: { shiftId: toShiftId } });

  return {
    employees: employees.count,
    schedules: schedules.count,
    attendanceRecords: attendanceRecords.updated + attendanceRecords.detached,
    staffCoverages: staffCoverages.updated,
    staffCoveragesSkipped: staffCoverages.skipped,
    shiftReports: shiftReports.count
  };
}

async function migrateAttendanceRecords(fromShiftId: string, toShiftId: string) {
  const records = await prisma.attendanceRecord.findMany({
    where: { shiftId: fromShiftId },
    select: { id: true, employeeId: true, date: true }
  });
  let updated = 0;
  let detached = 0;

  for (const record of records) {
    const duplicate = await prisma.attendanceRecord.findFirst({
      where: {
        id: { not: record.id },
        employeeId: record.employeeId,
        date: record.date,
        shiftId: toShiftId
      },
      select: { id: true }
    });

    if (duplicate) {
      await prisma.attendanceRecord.update({ where: { id: record.id }, data: { shiftId: null } });
      detached += 1;
    } else {
      await prisma.attendanceRecord.update({ where: { id: record.id }, data: { shiftId: toShiftId } });
      updated += 1;
    }
  }

  return { updated, detached };
}

async function migrateStaffCoverage(fromShiftId: string, toShiftId: string) {
  const rows = await prisma.staffCoverage.findMany({
    where: { shiftId: fromShiftId },
    select: { id: true, date: true, lobId: true }
  });
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const duplicate = await prisma.staffCoverage.findFirst({
      where: {
        id: { not: row.id },
        date: row.date,
        lobId: row.lobId,
        shiftId: toShiftId
      },
      select: { id: true }
    });
    if (duplicate) {
      skipped += 1;
      continue;
    }
    await prisma.staffCoverage.update({ where: { id: row.id }, data: { shiftId: toShiftId } });
    updated += 1;
  }

  return { updated, skipped };
}

async function readShiftStatusMap() {
  const config = await prisma.systemConfig.findUnique({ where: { key: SHIFT_STATUS_CONFIG_KEY }, select: { value: true } });
  const value = config?.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return {} as Record<string, "ACTIVE" | "INACTIVE">;
  const entries = Object.entries(value).filter((entry): entry is [string, "ACTIVE" | "INACTIVE"] => entry[1] === "ACTIVE" || entry[1] === "INACTIVE");
  return Object.fromEntries(entries);
}

main()
  .catch((error) => {
    console.error("Falha ao normalizar turnos.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
