import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { addDateKeyDays } from "@/lib/realtime-hours-timeline";
import {
  formatModerationDuration,
  moderationAssignmentWindows,
  normalizeModerationLogin,
  type AgentModerationDuration,
  type ModerationAssignmentWindow,
  type ModerationSchedule
} from "@/lib/performance-moderation-duration";

export type ModerationDurationScope = {
  employees: Array<{ employeeId: string; wbLogin: string }>;
  startDate: string;
  endDate: string;
  queueIds: string[];
  shiftId?: string;
  supervisorId?: string;
};

export type ModerationDurationAggregate = {
  employeeId: string;
  shiftDate: string;
  seconds: number;
  submit: number;
  shift: string;
  records: number;
};

/** Only consolidated employee/Shift Date totals leave the database. */
export function moderationDurationQuery(scope: ModerationDurationScope, windows: ModerationAssignmentWindow[]) {
  const identities = scope.employees.map(employee => ({
    employeeId: employee.employeeId, wbLogin: normalizeModerationLogin(employee.wbLogin)
  }));
  return Prisma.sql`
    WITH identities AS (
      SELECT * FROM jsonb_to_recordset(${JSON.stringify(identities)}::jsonb)
        AS i("employeeId" text, "wbLogin" text)
    ), windows AS (
      SELECT * FROM jsonb_to_recordset(${JSON.stringify(windows)}::jsonb)
        AS w("employeeId" text, "wbLogin" text, "shiftDate" date, "slotId" text, "assignmentOrder" integer,
          "slotStart" timestamptz, "slotEnd" timestamptz,
          "assignmentStart" timestamptz, "assignmentEnd" timestamptz,
          "shiftId" text, "shiftName" text, "supervisorId" text)
    ), source AS (
      SELECT DISTINCT ON (i."employeeId", p."bzTime", p."queueId")
        p.id AS "sourceId", i."employeeId", p."bzTime", p."moderationSeconds", p."submitNum"
      FROM identities i
      JOIN "ProductionRecord" p
        ON lower(regexp_replace(p."wbLogin", '\\s+', '', 'g')) = i."wbLogin"
      LEFT JOIN "PerformanceImportBatch" batch ON batch.id = p."importBatchId"
      WHERE p."bzDay" >= ${new Date(addDateKeyDays(scope.startDate, -1) + "T00:00:00Z")}
        AND p."bzDay" < ${new Date(addDateKeyDays(scope.endDate, 3) + "T00:00:00Z")}
        AND p."queueId" IN (${Prisma.join(scope.queueIds)})
        AND (p."importBatchId" IS NULL OR batch.status IN ('SUCCESS', 'PARTIAL'))
      ORDER BY i."employeeId", p."bzTime", p."queueId", p."updatedAt" DESC, p.id DESC
    ), ranked AS (
      SELECT p."employeeId", w."shiftDate", p."moderationSeconds", p."submitNum", w."shiftId", w."shiftName", w."supervisorId",
        ROW_NUMBER() OVER (PARTITION BY p."sourceId" ORDER BY CASE
          WHEN p."bzTime" AT TIME ZONE 'America/Sao_Paulo' < w."slotStart"
            THEN w."slotStart" - (p."bzTime" AT TIME ZONE 'America/Sao_Paulo')
          WHEN p."bzTime" AT TIME ZONE 'America/Sao_Paulo' > w."slotEnd"
            THEN (p."bzTime" AT TIME ZONE 'America/Sao_Paulo') - w."slotEnd"
          ELSE interval '0'
        END, w."assignmentOrder") AS choice
      FROM source p
      -- Join windows by employee before choosing a slot, rather than scanning
      -- every employee's window for each imported record.
      JOIN windows w ON w."employeeId" = p."employeeId"
        -- bzTime is already a Brazilian wall timestamp. Interpret it once.
        AND p."bzTime" AT TIME ZONE 'America/Sao_Paulo' >= w."assignmentStart"
        AND p."bzTime" AT TIME ZONE 'America/Sao_Paulo' < w."assignmentEnd"
    ), assigned AS (
      SELECT "employeeId", "shiftDate", "moderationSeconds", "submitNum", "shiftName"
      FROM ranked
      -- Match against adjacent slots first, then filter the assigned Shift Date.
      WHERE choice = 1 AND "shiftDate" BETWEEN ${scope.startDate}::date AND ${scope.endDate}::date
        ${scope.shiftId ? Prisma.sql`AND "shiftId" = ${scope.shiftId}` : Prisma.empty}
        ${scope.supervisorId ? Prisma.sql`AND "supervisorId" = ${scope.supervisorId}` : Prisma.empty}
    )
    SELECT "employeeId", to_char("shiftDate", 'YYYY-MM-DD') AS "shiftDate",
      SUM("moderationSeconds"::numeric)::double precision AS seconds,
      SUM("submitNum")::double precision AS submit,
      MAX("shiftName") AS shift,
      COUNT(*)::integer AS records
    FROM assigned
    GROUP BY "employeeId", "shiftDate"
    ORDER BY "employeeId", "shiftDate"
  `;
}

export async function getPerformanceModerationDurations(scope: ModerationDurationScope) {
  return (await getPerformanceAgentShiftProduction(scope)).durations;
}

export async function getPerformanceAgentShiftProduction(scope: ModerationDurationScope) {
  const employees = Array.from(new Map(scope.employees.map(employee => [employee.employeeId, employee])).values());
  const result = new Map<string, AgentModerationDuration>(employees.map(employee => [
    employee.employeeId, { seconds: null, duration: "Sem dados", byShiftDate: [] }
  ]));
  if (!employees.length || !scope.queueIds.length) return { durations: result, production: [] as ModerationDurationAggregate[] };

  // A normalized login must identify exactly one registered employee.
  const logins = new Set<string>();
  for (const employee of employees) {
    const login = normalizeModerationLogin(employee.wbLogin);
    if (!login || logins.has(login)) throw new Error("WB/Login ambíguo ao consolidar Moderation Duration.");
    logins.add(login);
  }
  const schedules = await prisma.schedule.findMany({
    where: {
      employeeId: { in: employees.map(employee => employee.employeeId) },
      deletedAt: null,
      date: {
        gte: new Date(addDateKeyDays(scope.startDate, -1) + "T00:00:00Z"),
        lte: new Date(addDateKeyDays(scope.endDate, 1) + "T00:00:00Z")
      }
    },
    select: {
      id: true, employeeId: true, date: true, startsAt: true, endsAt: true, status: true,
      shiftId: true, supervisorId: true,
      shift: { select: { name: true, startsAt: true, endsAt: true } }
    }
  });
  const windows = moderationAssignmentWindows(employees, schedules as ModerationSchedule[]);
  const selected = windows.filter(window =>
    window.shiftDate >= scope.startDate && window.shiftDate <= scope.endDate
    && (!scope.shiftId || window.shiftId === scope.shiftId)
    && (!scope.supervisorId || window.supervisorId === scope.supervisorId)
  );
  if (!selected.length) return { durations: result, production: [] as ModerationDurationAggregate[] };
  const aggregates = await prisma.$queryRaw<ModerationDurationAggregate[]>(moderationDurationQuery({ ...scope, employees }, windows));
  for (const window of selected) {
    const agent = result.get(window.employeeId)!;
    if (!agent.byShiftDate.some(day => day.shiftDate === window.shiftDate)) {
      agent.byShiftDate.push({ employeeId: window.employeeId, shiftDate: window.shiftDate, seconds: null, duration: "Sem dados" });
    }
  }
  for (const aggregate of aggregates) {
    const agent = result.get(aggregate.employeeId);
    const day = agent?.byShiftDate.find(day => day.shiftDate === aggregate.shiftDate);
    const seconds = Number(aggregate.seconds);
    if (!agent || !day || !Number.isFinite(seconds) || seconds < 0) throw new Error("Total inválido de Moderation Duration.");
    day.seconds = Math.round(seconds);
    day.duration = formatModerationDuration(seconds);
    agent.seconds = (agent.seconds ?? 0) + seconds;
  }
  for (const agent of result.values()) {
    agent.duration = formatModerationDuration(agent.seconds);
    if (agent.seconds !== null) agent.seconds = Math.round(agent.seconds);
    agent.byShiftDate.sort((a, b) => a.shiftDate.localeCompare(b.shiftDate));
  }
  return { durations: result, production: aggregates };
}
