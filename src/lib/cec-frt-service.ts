import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { Actor } from "@/lib/mock-db";
import { authorizePerformanceImport, authorizePerformanceRead, PerformanceError } from "@/lib/performance-service";
import { addCecFrt, cecFrtDay, cecFrtLogin, cecFrtMetrics, emptyCecFrt, parseCecFrtRows, type CecFrtCounts, type CecFrtDashboard } from "@/lib/cec-frt";

const date = (key: string) => new Date(`${key}T00:00:00Z`);
const iso = (value: Date) => value.toISOString().slice(0, 10);
const visible = Prisma.sql`JOIN "PerformanceImportBatch" b ON b.id=f."importBatchId" AND b.type='CEC_FRT' AND b.status='SUCCESS'`;

export async function prepareCecFrtSnapshot(actor: Actor, raw: Record<string, unknown>[]) {
  await authorizePerformanceImport(actor);
  let parsed: ReturnType<typeof parseCecFrtRows>;
  try { parsed = parseCecFrtRows(raw); } catch (error) { throw new PerformanceError((error as Error).message, 400); }
  if (parsed.errorCount) throw new PerformanceError(`${parsed.errorCount} linhas inválidas. A base anterior foi preservada. ${parsed.errors.join(" ")}`, 400);
  const logins = [...new Set(parsed.rows.map((row) => row.wbLogin))];
  const employees: Array<{ id: string; wbLogin: string }> = [];
  for (let i = 0; i < logins.length; i += 1000) {
    const part = logins.slice(i, i + 1000);
    employees.push(...await prisma.$queryRaw<Array<{ id: string; wbLogin: string }>>(Prisma.sql`
      SELECT id, "wbLogin" FROM "EmployeeProfile" WHERE "deletedAt" IS NULL
      AND lower(trim("wbLogin")) IN (${Prisma.join(part)})`));
  }
  const byLogin = new Map<string, string>();
  for (const employee of employees) {
    const login = cecFrtLogin(employee.wbLogin);
    if (byLogin.has(login)) throw new PerformanceError(`Login ${login} tem mais de um cadastro. Corrija o vínculo antes de importar.`, 400);
    byLogin.set(login, employee.id);
  }
  const unmatchedRows = parsed.rows.filter((row) => !byLogin.has(row.wbLogin)).length;
  return {
    rows: parsed.rows.map((row) => ({ ticketCreatedDay: date(row.day), wbLogin: row.wbLogin, employeeId: byLogin.get(row.wbLogin) ?? null,
      priority: row.priority, total: row.total, over240: row.over240, over1440: row.over1440 })),
    summary: { cecFrtRows: parsed.rows.length, unmatchedRows, unmatchedLogins: logins.filter((login) => !byLogin.has(login)).length,
      startDate: parsed.rows.reduce((min, row) => row.day < min ? row.day : min, parsed.rows[0].day),
      endDate: parsed.rows.reduce((max, row) => row.day > max ? row.day : max, parsed.rows[0].day) }
  };
}

export async function importCecFrtSnapshot(actor: Actor, raw: Record<string, unknown>[], fileName: string) {
  const user = await authorizePerformanceImport(actor);
  const prepared = await prepareCecFrtSnapshot(actor, raw);
  const batch = await prisma.performanceImportBatch.create({ data: { type: "CEC_FRT", fileName, status: "PROCESSING", importedById: user.id,
    rowsTotal: prepared.rows.length, rowsValid: prepared.rows.length, rowsError: 0 } });
  try {
    for (let i = 0; i < prepared.rows.length; i += 1500) {
      await prisma.performanceCecFrtRecord.createMany({ data: prepared.rows.slice(i, i + 1500).map((row) => ({ ...row, importBatchId: batch.id })) });
    }
    // Publish the fully staged snapshot atomically. Concurrent uploads cannot expose two snapshots.
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('performance-cec-frt-snapshot'))::text`;
      await tx.performanceImportBatch.update({ where: { id: batch.id }, data: { status: "SUCCESS", rowsInserted: prepared.rows.length, importedAt: new Date() } });
      // Does not touch CPD, production, quality, or another in-progress upload.
      await tx.performanceImportBatch.deleteMany({ where: { type: "CEC_FRT", status: { not: "PROCESSING" }, id: { not: batch.id } } });
    }, { timeout: 120000 });
  } catch (error) {
    await prisma.performanceImportBatch.deleteMany({ where: { id: batch.id, status: "PROCESSING" } });
    throw error;
  }
  return prepared.summary;
}

export type CecFrtDayRow = CecFrtCounts & { employeeId: string | null; wbLogin: string; day: Date; name: string; skill: string; supervisorId: string | null; supervisor: string; records: number; updatedAt: Date };
export async function loadCecFrtDays(start: Date, end: Date, employeeIds?: string[]): Promise<CecFrtDayRow[]> {
  if (employeeIds && !employeeIds.length) return [];
  return prisma.$queryRaw<CecFrtDayRow[]>(Prisma.sql`
    SELECT f."employeeId", f."wbLogin", f."ticketCreatedDay" AS day,
      COALESCE(e."fullName", f."wbLogin") AS name, COALESCE(e.skill, '') AS skill,
      e."supervisorId", COALESCE(s."fullName", 'Sem supervisor') AS supervisor,
      COALESCE(SUM(f.total) FILTER (WHERE f.priority='NORMAL'),0)::double precision AS "normalTotal",
      COALESCE(SUM(f."over1440") FILTER (WHERE f.priority='NORMAL'),0)::double precision AS "normalOver",
      COALESCE(SUM(f.total) FILTER (WHERE f.priority IN ('P0','HM')),0)::double precision AS "urgentTotal",
      COALESCE(SUM(f."over240") FILTER (WHERE f.priority IN ('P0','HM')),0)::double precision AS "urgentOver",
      COUNT(*)::integer AS records, MAX(b."importedAt") AS "updatedAt"
    FROM "PerformanceCecFrtRecord" f ${visible}
    LEFT JOIN "EmployeeProfile" e ON e.id=f."employeeId"
    LEFT JOIN "EmployeeProfile" s ON s.id=e."supervisorId"
    WHERE f."ticketCreatedDay">=${start} AND f."ticketCreatedDay"<=${end}
      ${employeeIds ? Prisma.sql`AND f."employeeId" IN (${Prisma.join(employeeIds)})` : Prisma.empty}
    GROUP BY f."employeeId", f."wbLogin", f."ticketCreatedDay", e."fullName", e.skill, e."supervisorId", s."fullName"
    ORDER BY f."ticketCreatedDay", f."wbLogin"`);
}

export function cecFrtPeriod(query: URLSearchParams, today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" })) {
  const startDate = query.get("startDate") || `${today.slice(0, 7)}-01`, endDate = query.get("endDate") || today;
  if (!cecFrtDay(startDate) || !cecFrtDay(endDate) || startDate > endDate || +date(endDate) - +date(startDate) > 365 * 86400000) {
    throw new PerformanceError("Selecione datas válidas, em um período de até 366 dias.", 400);
  }
  const requestedView = query.get("view") || "daily";
  if (!["daily", "weekly", "monthly"].includes(requestedView)) throw new PerformanceError("A base SLA/FRT CEC é diária. Selecione Diário, Semanal ou Mensal.", 400);
  return { startDate, endDate, view: requestedView as CecFrtDashboard["view"] };
}

export type CecCpdDay = { wbLogin: string; employeeId: string | null; name: string; supervisor: string; skill: string; day: Date; tickets: number };
export function buildCecFrtDashboard(period: ReturnType<typeof cecFrtPeriod>, frt: CecFrtDayRow[], cpd: CecCpdDay[]) {
  type Aggregate = { counts: CecFrtCounts; tickets: number; cpdRecords: number; agentDays: Set<string> };
  const empty = (): Aggregate => ({ counts: emptyCecFrt(), tickets: 0, cpdRecords: 0, agentDays: new Set() });
  const summary = empty(), trend = new Map<string, Aggregate>();
  const agents = new Map<string, Aggregate & { name: string; supervisor: string; skill: string; linked: boolean }>();
  const supervisors = new Map<string, { name: string; counts: CecFrtCounts }>();
  const bucket = (value: Date) => {
    const d = new Date(value);
    if (period.view === "monthly") d.setUTCDate(1);
    if (period.view === "weekly") d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
    return iso(d);
  };
  function targets(row: CecFrtDayRow | CecCpdDay) {
    const key = bucket(row.day), login = cecFrtLogin(row.wbLogin);
    if (!trend.has(key)) trend.set(key, empty());
    if (!agents.has(login)) agents.set(login, { ...empty(), name: row.name, supervisor: row.supervisor, skill: row.skill, linked: Boolean(row.employeeId) });
    return [summary, trend.get(key)!, agents.get(login)!];
  }
  for (const row of frt) {
    for (const target of targets(row)) addCecFrt(target.counts, row);
    const id = row.supervisorId || "unassigned";
    if (!supervisors.has(id)) supervisors.set(id, { name: row.supervisor, counts: emptyCecFrt() });
    addCecFrt(supervisors.get(id)!.counts, row);
  }
  for (const row of cpd) for (const target of targets(row)) {
    target.tickets += row.tickets; target.cpdRecords++;
    if (row.tickets > 0) target.agentDays.add(`${cecFrtLogin(row.wbLogin)}|${iso(row.day)}`);
  }
  const output = (value: Aggregate) => ({ output: value.cpdRecords ? value.tickets : null,
    cpd: value.agentDays.size ? Math.round(value.tickets / value.agentDays.size * 100) / 100 : null });
  return { summary: cecFrtMetrics(summary.counts), ...output(summary), agentDays: summary.agentDays.size,
    coverage: { rows: frt.reduce((sum, row) => sum + row.records, 0), unmatchedRows: frt.filter((row) => !row.employeeId).reduce((sum, row) => sum + row.records, 0),
      latestDay: frt.length ? frt.map((row) => iso(row.day)).sort().at(-1)! : null,
      latestCpdDay: cpd.length ? cpd.map((row) => iso(row.day)).sort().at(-1)! : null },
    trend: [...trend].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => ({ period: key, ...cecFrtMetrics(value.counts), ...output(value) })),
    agents: [...agents].sort(([a], [b]) => a.localeCompare(b)).map(([wbLogin, value]) => ({ wbLogin, name: value.name, supervisor: value.supervisor, skill: value.skill, linked: value.linked, ...cecFrtMetrics(value.counts), ...output(value) })),
    supervisors: [...supervisors].map(([id, value]) => ({ id, name: value.name, ...cecFrtMetrics(value.counts) })) };
}

export async function getCecFrtDashboard(actor: Actor, query: URLSearchParams): Promise<CecFrtDashboard> {
  const auth = await authorizePerformanceRead(actor), period = cecFrtPeriod(query);
  const ids = auth.ownEmployee ? [auth.ownEmployee.id] : undefined;
  const [frt, cpd, ranges, lastImport] = await Promise.all([
    loadCecFrtDays(date(period.startDate), date(period.endDate), ids),
    prisma.$queryRaw<CecCpdDay[]>(Prisma.sql`SELECT c."wbLogin", c."employeeId", c."performanceDay" AS day,
      COALESCE(e."fullName",c."wbLogin") AS name, COALESCE(s."fullName", 'Sem supervisor') AS supervisor, COALESCE(e.skill,'') AS skill,
      SUM(c."ticketCount")::double precision AS tickets FROM "PerformanceCecCpdRecord" c
      LEFT JOIN "EmployeeProfile" e ON e.id=c."employeeId" LEFT JOIN "EmployeeProfile" s ON s.id=e."supervisorId"
      WHERE c."performanceDay">=${date(period.startDate)} AND c."performanceDay"<=${date(period.endDate)}
      ${ids ? Prisma.sql`AND c."employeeId" IN (${Prisma.join(ids)})` : Prisma.empty}
      GROUP BY c."wbLogin",c."employeeId",c."performanceDay",e."fullName",e.skill,s."fullName"`),
    prisma.$queryRaw<Array<{ start: Date | null; end: Date | null }>>(Prisma.sql`SELECT MIN(f."ticketCreatedDay") AS start, MAX(f."ticketCreatedDay") AS end
      FROM "PerformanceCecFrtRecord" f ${visible} ${ids ? Prisma.sql`WHERE f."employeeId" IN (${Prisma.join(ids)})` : Prisma.empty}`),
    prisma.performanceImportBatch.findFirst({ where: { type: "CEC_FRT", status: "SUCCESS" }, orderBy: { importedAt: "desc" }, select: { fileName: true, importedAt: true } })
  ]);
  return { period: { startDate: period.startDate, endDate: period.endDate }, view: period.view, canImport: auth.canImport,
    dataRange: ranges[0]?.start && ranges[0]?.end ? { startDate: iso(ranges[0].start), endDate: iso(ranges[0].end) } : null,
    lastImport: lastImport ? { ...lastImport, importedAt: lastImport.importedAt.toISOString() } : null,
    ...buildCecFrtDashboard(period, frt, cpd) };
}
