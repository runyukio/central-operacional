import { Prisma, ScheduleStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeAbsenceReasonForInput } from "@/lib/absence-reasons";
import { isCaptureImportEligible } from "@/lib/work-hours-capture-eligibility";
import { isProtectedCaptureScheduleStatus } from "@/lib/work-hours-capture-integration-core";
import { answerWorkHourAdherenceJustification } from "@/lib/work-hours-capture-integration-service";
import { updateOperationalAttendance } from "@/lib/schedule-service";
import { MeuEspacoError } from "@/lib/meu-espaco-access";
import { decodeSpaceCursor, encodeSpaceCursor, pendingFingerprint, spaceDate, spacePendingFilters, spacePeriod, spaceToday } from "@/lib/meu-espaco-filters";
import type { MeuEspacoScope } from "@/lib/meu-espaco-scope";
import type { ManagementCounts, SpacePending, SpaceSummary } from "@/lib/meu-espaco-contract";

const absenceStatuses: ScheduleStatus[] = ["FALTA", "FALTA_JUSTIFICADA", "FALTA_INJUSTIFICADA", "ERRO_ESCALA"];
const protectedStatuses = Object.values(ScheduleStatus).filter(isProtectedCaptureScheduleStatus);
const inIds = (column: Prisma.Sql, ids: string[]) => ids.length ? Prisma.sql`${column} IN (${Prisma.join(ids)})` : Prisma.sql`FALSE`;
type DbPending = Omit<SpacePending, "date" | "answeredAt"> & { date: Date; answeredAt: Date | null };
const serialize = (row: DbPending): SpacePending => ({ ...row, date: row.date.toISOString().slice(0, 10), answeredAt: row.answeredAt?.toISOString() ?? null });

// One CTE supplies counts, the cursor feed and the item authorization check.
// Reasons are normalized by the same existing input function, including legacy aliases.
export async function spacePendingSource(scope: MeuEspacoScope) {
  const reasonRows = scope.employeeIds.length ? await prisma.attendanceRecord.groupBy({ by: ["absenceReason"],
    where: { employeeId: { in: scope.employeeIds }, isJustified: true, schedule: { deletedAt: null, status: { in: absenceStatuses } } }
  }) : [];
  const validReasons = reasonRows.flatMap((row) => row.absenceReason && normalizeAbsenceReasonForInput(row.absenceReason) ? [row.absenceReason] : []);
  const validReasonSql = validReasons.length ? Prisma.sql`a."absenceReason" IN (${Prisma.join(validReasons)})` : Prisma.sql`FALSE`;
  const eligibleIds = scope.profiles.filter((employee) => isCaptureImportEligible(employee, spaceToday())).map((employee) => employee.id);
  return Prisma.sql`WITH items AS (
    SELECT s.id, 'absence'::text AS kind, s.date, e.id AS "employeeId", e."fullName" AS "employeeName", e."wbLogin",
      l.name AS lob, e."supervisorId", COALESCE(sup."fullName", 'Sem supervisor') AS supervisor,
      (s.status NOT IN ('FALTA_JUSTIFICADA', 'FALTA_INJUSTIFICADA') AND NOT COALESCE(a."isJustified" AND ${validReasonSql}, FALSE)) AS pending,
      s.status::text AS status, COALESCE(a."absenceReason", '') AS reason, COALESCE(a."reasonCategory", '') AS "reasonCategory", COALESCE(a."supervisorJustification", '') AS justification,
      COALESCE(a."evidenceUrl", '') AS "evidenceUrl", a."justifiedAt" AS "answeredAt", COALESCE(u.name, '') AS "answeredBy",
      COALESCE(s."startsAt", '') AS "plannedStart", COALESCE(s."endsAt", '') AS "plannedEnd", NULL::double precision AS "capturedMinutes"
    FROM "Schedule" s JOIN "EmployeeProfile" e ON e.id=s."employeeId" JOIN "Lob" l ON l.id=e."lobId"
    LEFT JOIN "EmployeeProfile" sup ON sup.id=e."supervisorId"
    LEFT JOIN LATERAL (SELECT r.* FROM "AttendanceRecord" r WHERE r."scheduleId"=s.id AND r."employeeId"=e.id ORDER BY r."updatedAt" DESC, r.id DESC LIMIT 1) a ON TRUE
    LEFT JOIN "User" u ON u.id=a."justifiedById"
    WHERE s."deletedAt" IS NULL AND e."deletedAt" IS NULL AND ${inIds(Prisma.sql`e.id`, scope.employeeIds)}
      AND s.status::text IN (${Prisma.join(absenceStatuses)}) AND s.date <= ${spaceDate(spaceToday())}
    UNION ALL
    SELECT j.id, 'hours'::text, j.date, e.id, e."fullName", e."wbLogin", j.lob, j."supervisorId", COALESCE(sup."fullName", 'Sem supervisor'),
      j.status='PENDING', j.status, j.classification, ''::text, COALESCE(j.justification, ''), ''::text, j."answeredAt", COALESCE(u.name, ''),
      COALESCE(j."plannedStart", ''), COALESCE(j."plannedEnd", ''), j."sourceDurationMs"::double precision / 60000
    FROM "WorkHourAdherenceJustification" j JOIN "EmployeeProfile" e ON e.id=j."employeeId"
    LEFT JOIN "Schedule" s ON s.id=j."scheduleId" LEFT JOIN "EmployeeProfile" sup ON sup.id=j."supervisorId"
    LEFT JOIN "User" u ON u.id=j."answeredById"
    WHERE j.status IN ('PENDING', 'JUSTIFIED') AND ${inIds(Prisma.sql`j."supervisorId"`, scope.activeSupervisorIds)} AND ${inIds(Prisma.sql`e.id`, eligibleIds)}
      AND j.date >= e."goLiveDate"::date AND j.date <= ${spaceDate(spaceToday())}
      AND (s.id IS NULL OR (s."deletedAt" IS NULL AND s.status::text NOT IN (${Prisma.join(protectedStatuses)})))
      AND EXISTS (SELECT 1 FROM "WorkHourRecord" w WHERE w."employeeId"=j."employeeId" AND w.date=j.date)
      ${scope.supervisorId ? Prisma.sql`AND j."supervisorId"=${scope.supervisorId}` : Prisma.empty}
  )`;
}

export async function getSpaceSummary(scope: MeuEspacoScope, query: URLSearchParams): Promise<SpaceSummary> {
  const period = spacePeriod(query), source = await spacePendingSource(scope);
  const endExclusive = new Date(+spaceDate(period.endDate) + 86_400_000);
  const counts = await prisma.$queryRaw<Array<ManagementCounts & { supervisorId: string | null; supervisor: string }>>(Prisma.sql`${source}
    SELECT "supervisorId", MAX(supervisor) AS supervisor,
      COUNT(*) FILTER (WHERE pending AND kind='absence')::integer AS absences,
      COUNT(*) FILTER (WHERE pending AND kind='hours')::integer AS hours,
      COUNT(*) FILTER (WHERE NOT pending AND ("answeredAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo') >= ${spaceDate(period.startDate)} AND ("answeredAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo') < ${endExclusive})::integer AS answered,
      TO_CHAR(MIN(date) FILTER (WHERE pending), 'YYYY-MM-DD') AS oldest
    FROM items GROUP BY "supervisorId"`);
  const rows = new Map<string, SpaceSummary["supervisors"][number]>();
  for (const profile of scope.profiles) {
    if (scope.activeSupervisorIds.includes(profile.id)) {
      rows.set(profile.id, { id: profile.id, name: profile.fullName, teamSize: 0, absences: 0, hours: 0, answered: 0, oldest: null });
    }
  }
  for (const employee of scope.employees) {
    if (!employee.supervisorId || !scope.activeSupervisorIds.includes(employee.supervisorId)) continue;
    const row = rows.get(employee.supervisorId) ?? { id: employee.supervisorId, name: employee.supervisor?.fullName || "Sem supervisor", teamSize: 0, absences: 0, hours: 0, answered: 0, oldest: null };
    row.teamSize++; rows.set(row.id, row);
  }
  const management: ManagementCounts = { absences: 0, hours: 0, answered: 0, oldest: null };
  for (const count of counts) {
    if (!count.supervisorId || !scope.activeSupervisorIds.includes(count.supervisorId)) continue;
    management.absences += count.absences; management.hours += count.hours; management.answered += count.answered;
    if (count.oldest && (!management.oldest || count.oldest < management.oldest)) management.oldest = count.oldest;
    if (count.supervisorId) rows.set(count.supervisorId, { id: count.supervisorId, name: count.supervisor,
      teamSize: rows.get(count.supervisorId)?.teamSize ?? 0, absences: count.absences, hours: count.hours, answered: count.answered, oldest: count.oldest });
  }
  return { actor: { name: scope.user.name, role: scope.role, broad: scope.broad, canRespond: scope.canRespond },
    selectedSupervisorId: scope.supervisorId, management, period,
    supervisors: [...rows.values()].filter((row) => !scope.supervisorId || row.id === scope.supervisorId).sort((a, b) => (b.absences + b.hours) - (a.absences + a.hours) || a.name.localeCompare(b.name, "pt-BR")),
    lobs: [...new Set(scope.profiles.map((employee) => employee.lob.name))].sort() };
}

export async function listSpacePending(scope: MeuEspacoScope, query: URLSearchParams) {
  const filters = spacePendingFilters(query);
  const fingerprint = pendingFingerprint(`${scope.user.id}:${scope.supervisorId || "all"}`, filters);
  const cursor = decodeSpaceCursor(query.get("cursor"), fingerprint);
  const source = await spacePendingSource(scope);
  const rows = await prisma.$queryRaw<DbPending[]>(Prisma.sql`${source} SELECT * FROM items
    WHERE pending=${filters.state === "pending"} AND date >= ${spaceDate(filters.startDate)} AND date <= ${spaceDate(filters.endDate)}
      ${filters.kind === "all" ? Prisma.empty : Prisma.sql`AND kind=${filters.kind}`}
      ${filters.lob ? Prisma.sql`AND lob=${filters.lob}` : Prisma.empty}
      ${filters.search ? Prisma.sql`AND (POSITION(LOWER(${filters.search}) IN LOWER("employeeName"))>0 OR POSITION(LOWER(${filters.search}) IN LOWER("wbLogin"))>0)` : Prisma.empty}
      ${cursor ? Prisma.sql`AND (date, kind, id) > (${spaceDate(cursor.date)}, ${cursor.kind}, ${cursor.id})` : Prisma.empty}
    ORDER BY date ASC, kind ASC, id ASC LIMIT 51`);
  const hasMore = rows.length > 50, data = rows.slice(0, 50).map(serialize), last = data.at(-1);
  return { data, hasMore, nextCursor: hasMore && last ? encodeSpaceCursor({ date: last.date, id: last.id, kind: last.kind, fingerprint }) : null };
}

export async function getSpacePendingItem(scope: MeuEspacoScope, kind: string, id: string) {
  if (!["absence", "hours"].includes(kind) || !id || id.length > 160) throw new MeuEspacoError("Ocorrência inválida.");
  const source = await spacePendingSource(scope);
  const rows = await prisma.$queryRaw<DbPending[]>(Prisma.sql`${source} SELECT * FROM items WHERE kind=${kind} AND id=${id} LIMIT 1`);
  if (!rows[0]) throw new MeuEspacoError("Ocorrência indisponível ou fora da sua responsabilidade. Atualize a lista.", 404);
  return serialize(rows[0]);
}

export async function getSpacePendingHistory(scope: MeuEspacoScope, kind: string, id: string) {
  const item = await getSpacePendingItem(scope, kind, id);
  if (kind === "absence") {
    const history = await prisma.attendanceHistory.findMany({ where: { attendanceRecord: { scheduleId: id, employeeId: item.employeeId } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 30, select: { id: true, createdAt: true, previousReason: true, newReason: true, comment: true, changedBy: { select: { name: true } } } });
    return { item, history: history.map((row) => ({ id: row.id, date: row.createdAt.toISOString(), actor: row.changedBy?.name || "Sistema", text: [row.previousReason, row.newReason, row.comment].filter(Boolean).join(" → ") })) };
  }
  const audit = await prisma.auditLog.findMany({ where: { entity: "WorkHourAdherenceJustification", entityId: id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 30,
    select: { id: true, createdAt: true, reason: true, newValue: true, actor: { select: { name: true } } } });
  const history = audit.map((row) => { const value = row.newValue && typeof row.newValue === "object" && !Array.isArray(row.newValue) ? row.newValue : {};
    return { id: row.id, date: row.createdAt.toISOString(), actor: row.actor?.name || "Sistema", text: typeof value.justification === "string" ? value.justification : row.reason || "Registro atualizado." }; });
  return { item, history: history.length ? history : item.answeredAt ? [{ id: item.id, date: item.answeredAt, actor: item.answeredBy, text: item.justification }] : [] };
}

export async function respondSpacePending(scope: MeuEspacoScope, kind: string, id: string, input: { justification: string; reason?: string; reasonCategory?: string; evidenceUrl?: string }) {
  if (!scope.canRespond) throw new MeuEspacoError("Seu perfil tem acesso somente à consulta neste espaço.", 403);
  const item = await getSpacePendingItem(scope, kind, id);
  if (!item.pending) throw new MeuEspacoError("Esta ocorrência já foi respondida. Atualize a lista.", 409);
  if (kind === "hours") {
    const result = await answerWorkHourAdherenceJustification(scope.actor, { id, justification: input.justification });
    if ("error" in result) throw new MeuEspacoError(result.error || "Não foi possível responder.");
  } else {
    const schedule = await prisma.schedule.findFirst({ where: { id, deletedAt: null, employeeId: { in: scope.employeeIds } }, include: { shift: true, employee: { select: { shift: true } } } });
    if (!schedule) throw new MeuEspacoError("Ocorrência não encontrada.", 404);
    const attendance = await prisma.attendanceRecord.findFirst({ where: { scheduleId: id, employeeId: item.employeeId }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], select: { id: true } });
    const result = await updateOperationalAttendance(scope.actor, { employeeId: item.employeeId, scheduleId: id, attendanceRecordId: attendance?.id,
      date: item.date, shift: schedule.shift?.name || schedule.employee.shift.name, status: schedule.status === "ERRO_ESCALA" ? "Erro de escala" : "Falta",
      absenceReason: input.reason, reasonCategory: input.reasonCategory, supervisorJustification: input.justification, hasEvidence: Boolean(input.evidenceUrl), evidenceUrl: input.evidenceUrl });
    if ("error" in result) throw new MeuEspacoError(result.error || "Não foi possível responder.");
  }
  return { data: await getSpacePendingItem(scope, kind, id) };
}
