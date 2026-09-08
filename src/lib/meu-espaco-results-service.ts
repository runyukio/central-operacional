import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { allPerformanceQueueIds, getPerformanceQueueMetadataById, isSupervisorAhtQueue, selectSupervisorQualityDailyRows, visibleQualityRecordSql } from "@/lib/performance-service";
import { isAbsenceStatus, isScheduledStatus } from "@/lib/attendance-calculation";
import { spaceDate, spacePeriod } from "@/lib/meu-espaco-filters";
import { emptySpaceMetric, finishSpaceMetric, spaceLatencyQueueKind, spaceLobFamily, type MetricAccumulator } from "@/lib/meu-espaco-metrics";
import type { MeuEspacoScope } from "@/lib/meu-espaco-scope";
import type { SpaceResults } from "@/lib/meu-espaco-contract";

type ProductionDay = { employeeId: string; day: Date; output: number; ahtSubmit: number; duration: number; active: boolean; updatedAt: Date;
  latencyMinutesSum?: number; latencySubmits?: number; commentsLatencyMinutesSum?: number; commentsLatencySubmits?: number };
type QualityDay = { employeeId: string; supervisorId: string; qualityDay: Date; correct: number; total: number; updatedAt: Date };
const iso = (date: Date) => date.toISOString().slice(0, 10);

export async function getSpaceResults(scope: MeuEspacoScope, query: URLSearchParams): Promise<SpaceResults> {
  const period = spacePeriod(query), start = spaceDate(period.startDate), end = new Date(+spaceDate(period.endDate) + 86_400_000);
  const employees = scope.employees.filter((employee) => !query.get("lob") || spaceLobFamily(employee.lob.name) === query.get("lob"));
  const ids = employees.map((employee) => employee.id);
  if (!ids.length) return { period, groups: [], partners: [], supervisors: [] };
  const cecIds = employees.filter((employee) => spaceLobFamily(employee.lob.name) === "CEC").map((employee) => employee.id);
  const kapIds = employees.filter((employee) => ["ADS", "TNS"].includes(spaceLobFamily(employee.lob.name))).map((employee) => employee.id);
  const tnsIds = employees.filter((employee) => spaceLobFamily(employee.lob.name) === "TNS").map((employee) => employee.id);
  const productionQueries = ["ADS", "TNS"].map(async (family) => {
    const familyIds = employees.filter((employee) => spaceLobFamily(employee.lob.name) === family).map((employee) => employee.id);
    const queues = allPerformanceQueueIds().filter((id) => spaceLobFamily(getPerformanceQueueMetadataById(id).lob) === family);
    const ahtQueues = queues.filter((id) => isSupervisorAhtQueue(getPerformanceQueueMetadataById(id)));
    if (!familyIds.length || !queues.length) return [] as ProductionDay[];
    const ahtFilter = ahtQueues.length ? Prisma.sql`p."queueId" IN (${Prisma.join(ahtQueues)})` : Prisma.sql`FALSE`;
    const latencyFilter = (kind: "primary" | "comments") => {
      const selected = queues.filter((id) => spaceLatencyQueueKind(getPerformanceQueueMetadataById(id)) === kind);
      return selected.length ? Prisma.sql`p."queueId" IN (${Prisma.join(selected)}) AND p."latencyMinutesSum" IS NOT NULL AND p."latencyMinutesSum">=0 AND p."submitNum">0` : Prisma.sql`FALSE`;
    };
    const latency = latencyFilter("primary"), commentsLatency = latencyFilter("comments");
    return prisma.$queryRaw<ProductionDay[]>(Prisma.sql`SELECT p."employeeId", DATE_TRUNC('day', p."bzDay") AS day,
      SUM(p."submitNum")::double precision AS output,
      COALESCE(SUM(p."submitNum") FILTER (WHERE ${ahtFilter}),0)::double precision AS "ahtSubmit",
      COALESCE(SUM(p."moderationSeconds") FILTER (WHERE ${ahtFilter}),0)::double precision AS duration,
      COALESCE(SUM(p."latencyMinutesSum") FILTER (WHERE ${latency}),0)::double precision AS "latencyMinutesSum",
      COALESCE(SUM(p."submitNum") FILTER (WHERE ${latency}),0)::double precision AS "latencySubmits",
      COALESCE(SUM(p."latencyMinutesSum") FILTER (WHERE ${commentsLatency}),0)::double precision AS "commentsLatencyMinutesSum",
      COALESCE(SUM(p."submitNum") FILTER (WHERE ${commentsLatency}),0)::double precision AS "commentsLatencySubmits",
      TRUE AS active, MAX(p."updatedAt") AS "updatedAt"
      FROM "ProductionRecord" p WHERE p."employeeId" IN (${Prisma.join(familyIds)}) AND p."bzDay">=${start} AND p."bzDay"<${end}
        AND p."queueId" IN (${Prisma.join(queues)}) GROUP BY p."employeeId", DATE_TRUNC('day', p."bzDay")`);
  });
  const [productionParts, cec, kap, legacy, cecQuality, schedules] = await Promise.all([
    Promise.all(productionQueries),
    cecIds.length ? prisma.$queryRaw<ProductionDay[]>(Prisma.sql`SELECT c."employeeId", DATE_TRUNC('day', c."performanceDay") AS day,
      SUM(c."ticketCount")::double precision AS output, 0::double precision AS "ahtSubmit", 0::double precision AS duration,
      BOOL_OR(c."ticketCount">0) AS active, MAX(c."updatedAt") AS "updatedAt"
      FROM "PerformanceCecCpdRecord" c WHERE c."employeeId" IN (${Prisma.join(cecIds)}) AND c."performanceDay">=${start} AND c."performanceDay"<${end}
      GROUP BY c."employeeId", DATE_TRUNC('day', c."performanceDay")`) : Promise.resolve([] as ProductionDay[]),
    kapIds.length ? prisma.$queryRaw<QualityDay[]>(Prisma.sql`SELECT q."employeeId", ''::text AS "supervisorId", DATE_TRUNC('day', q."auditDate") AS "qualityDay",
      COUNT(DISTINCT CASE WHEN LOWER(TRIM(q."finalResult"))='correct' THEN q."concatKey" END)::integer AS correct,
      COUNT(DISTINCT q."concatKey")::integer AS total, MAX(q."updatedAt") AS "updatedAt"
      FROM "QualityRecord" q WHERE q."employeeId" IN (${Prisma.join(kapIds)}) AND q."auditDate">=${start} AND q."auditDate"<${end}
      ${visibleQualityRecordSql} GROUP BY q."employeeId", DATE_TRUNC('day', q."auditDate")`) : Promise.resolve([] as QualityDay[]),
    tnsIds.length ? prisma.$queryRaw<QualityDay[]>(Prisma.sql`SELECT q."employeeId", ''::text AS "supervisorId", DATE_TRUNC('day', q."auditDate") AS "qualityDay",
      GREATEST(SUM(q.sampling)-SUM(q.mislabeled+q.leakage+q."falsePositive"),0)::integer AS correct,
      SUM(q.sampling)::integer AS total, MAX(q."updatedAt") AS "updatedAt"
      FROM "TnsQualityRecord" q WHERE q."employeeId" IN (${Prisma.join(tnsIds)}) AND q."auditDate">=${start} AND q."auditDate"<${end}
      GROUP BY q."employeeId", DATE_TRUNC('day', q."auditDate")`) : Promise.resolve([] as QualityDay[]),
    cecIds.length ? prisma.$queryRaw<QualityDay[]>(Prisma.sql`SELECT q."employeeId", ''::text AS "supervisorId", DATE_TRUNC('day', q."qualityDate") AS "qualityDay",
      SUM(q."passQuantity")::integer AS correct, SUM(q."passQuantity"+q."failQuantity")::integer AS total, MAX(q."updatedAt") AS "updatedAt"
      FROM "CecQualityRecord" q WHERE q."employeeId" IN (${Prisma.join(cecIds)}) AND q."qualityDate">=${start} AND q."qualityDate"<${end}
      GROUP BY q."employeeId", DATE_TRUNC('day', q."qualityDate")`) : Promise.resolve([] as QualityDay[]),
    prisma.schedule.groupBy({ by: ["employeeId", "date", "status"], where: { employeeId: { in: ids }, date: { gte: start, lt: end }, deletedAt: null }, _count: { _all: true }, _max: { updatedAt: true } })
  ]);
  const production = [...productionParts.flat(), ...cec];
  const quality = [...selectSupervisorQualityDailyRows(kap, legacy), ...cecQuality];
  const byEmployee = new Map(employees.map((employee) => [employee.id, { employee, metric: emptySpaceMetric() }]));
  const supervisors = new Map<string, { name: string; groups: Map<string, MetricAccumulator> }>();
  const groups = new Map<string, { metric: MetricAccumulator; daily: Map<string, MetricAccumulator>; employees: number;
    productionPartners: Set<string>; qualityPartners: Set<string>; schedulePartners: Set<string>;
    productionLatest: string | null; qualityLatest: string | null; scheduleLatest: string | null; updatedAt: string | null }>();
  for (const employee of employees) {
    const lob = spaceLobFamily(employee.lob.name);
    if (!supervisors.has(employee.supervisorId!)) supervisors.set(employee.supervisorId!, { name: employee.supervisor?.fullName || "Supervisor", groups: new Map() });
    if (!supervisors.get(employee.supervisorId!)!.groups.has(lob)) supervisors.get(employee.supervisorId!)!.groups.set(lob, emptySpaceMetric());
    if (!groups.has(lob)) groups.set(lob, { metric: emptySpaceMetric(), daily: new Map(), employees: 0, productionPartners: new Set(), qualityPartners: new Set(), schedulePartners: new Set(), productionLatest: null, qualityLatest: null, scheduleLatest: null, updatedAt: null });
    groups.get(lob)!.employees++;
  }
  function targets(employeeId: string, date: string, updatedAt: Date | null, source: "production" | "quality" | "schedule") {
    const employee = byEmployee.get(employeeId)!;
    const group = groups.get(spaceLobFamily(employee.employee.lob.name))!;
    if (!group.daily.has(date)) group.daily.set(date, emptySpaceMetric());
    group[`${source}Partners`].add(employeeId);
    if (!group[`${source}Latest`] || date > group[`${source}Latest`]!) group[`${source}Latest`] = date;
    if (updatedAt && (!group.updatedAt || updatedAt.toISOString() > group.updatedAt)) group.updatedAt = updatedAt.toISOString();
    return [employee.metric, group.metric, group.daily.get(date)!, supervisors.get(employee.employee.supervisorId!)!.groups.get(spaceLobFamily(employee.employee.lob.name))!];
  }
  for (const row of production) {
    const date = iso(row.day);
    for (const target of targets(row.employeeId, date, row.updatedAt, "production")) {
      target.output += row.output; target.days.add(date);
      if (row.active) target.agentDays.add(`${row.employeeId}:${date}`);
      target.ahtSubmit += row.ahtSubmit; target.duration += row.duration;
      target.latencyMinutesSum += row.latencyMinutesSum ?? 0; target.latencySubmits += row.latencySubmits ?? 0;
      target.commentsLatencyMinutesSum += row.commentsLatencyMinutesSum ?? 0; target.commentsLatencySubmits += row.commentsLatencySubmits ?? 0;
    }
  }
  for (const row of quality) for (const target of targets(row.employeeId, iso(row.qualityDay), row.updatedAt, "quality")) {
    target.correct += row.correct; target.samples += row.total;
  }
  for (const row of schedules) for (const target of targets(row.employeeId, iso(row.date), row._max.updatedAt, "schedule")) {
    if (isScheduledStatus(row.status)) target.planned += row._count._all;
    if (isAbsenceStatus(row.status)) target.absences += row._count._all;
  }
  return { period, supervisors: [...supervisors].map(([id, supervisor]) => ({ id, name: supervisor.name,
    groups: [...supervisor.groups].map(([lob, metric]) => ({ lob, metric: finishSpaceMetric(metric, lob) })) })),
    groups: [...groups.entries()].map(([lob, group]) => ({ lob, teamSize: group.employees, metric: finishSpaceMetric(group.metric, lob),
    daily: [...group.daily.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, metric: finishSpaceMetric(value, lob) })),
    coverage: { productionPartners: group.productionPartners.size, qualityPartners: group.qualityPartners.size, schedulePartners: group.schedulePartners.size,
      productionLatest: group.productionLatest, qualityLatest: group.qualityLatest, scheduleLatest: group.scheduleLatest, updatedAt: group.updatedAt } })),
    partners: [...byEmployee.values()].map(({ employee, metric }) => ({ id: employee.id, name: employee.fullName, wbLogin: employee.wbLogin,
      skill: employee.skill || "Sem skill principal", lob: spaceLobFamily(employee.lob.name), metric: finishSpaceMetric(metric, spaceLobFamily(employee.lob.name)) })).sort((a,b) => a.name.localeCompare(b.name, "pt-BR")) };
}
