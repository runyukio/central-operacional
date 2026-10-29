import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { readAdsProductivityAlert } from "./ads-productivity-alert-service";
import { getAdsExecutiveAutomationSnapshot } from "./ads-executive-webhook-service";
import { WORK_HOUR_TOLERANCE_MINUTES } from "./work-hours-rules";
import { ADS_PLANNED_SCHEDULE_STATUSES, addAdsDays, adsAhtComparison, adsBrazilClock, adsEligibleForHour, adsPendingReport, adsProductiveSchedule, adsScheduleConflict,
  adsWallInstant, adsWeekDays, type AdsAlertPlan, type AdsOperationalReport, type AdsSchedule } from "./ads-operational-alerts-core";
import { ahtOperationalReport, hoursOperationalReport, latenessOperationalReport, productivityOperationalReport, requiredOperationalReport,
  volumeOperationalReport, type AdsAhtCase, type AdsHoursRow, type AdsLatenessRow, type AdsRequiredRow } from "./ads-operational-alerts-report";

type SourceSchedule = AdsSchedule & { scheduleId: string };
const wbKey = (value: string) => value.trim().toLowerCase().replace(/\s+/g, "");
// Keep known schedule conflicts in private server configuration, never in public source.
export function operationalExcludedWbs() {
  const configured = process.env.ADS_OPERATIONAL_ALERT_EXCLUDED_WBS;
  if (configured === undefined) throw new Error("ADS schedule exclusions have not been validated");
  return new Set(configured.split(",").map(wbKey).filter(Boolean));
}
async function schedules(from: string, through: string) {
  return prisma.$queryRaw<SourceSchedule[]>(Prisma.sql`
    SELECT s.id AS "scheduleId",s."employeeId",to_char(s.date,'YYYY-MM-DD') AS day,s.status::text AS status,
      s."startsAt",s."endsAt",e."workStartTime" AS "profileStart",e."workEndTime" AS "profileEnd",
      e."fullName" AS name,COALESCE(e."wbLogin",'') AS "wbLogin",su."fullName" AS supervisor
    FROM "Schedule" s JOIN "EmployeeProfile" e ON e.id=s."employeeId" JOIN "Lob" l ON l.id=s."lobId" AND e."lobId"=l.id
    LEFT JOIN "EmployeeProfile" su ON su.id=e."supervisorId" AND su."deletedAt" IS NULL
    WHERE s."deletedAt" IS NULL AND e."deletedAt" IS NULL AND upper(trim(l.name))='ADS' AND e."roleTitle"='Agente'
      AND lower(trim(e."operationalStatus")) IN ('ativo','active','nesting')
      AND s.date >= ${from}::date AND s.date <= ${through}::date
    ORDER BY s.date,e."fullName",s.id
  `);
}
export function createOperationalDataContext() {
  const hours = new Map<string, ReturnType<typeof loadHourly>>();
  return { hourly(plan: AdsAlertPlan) { let promise = hours.get(plan.end); if (!promise) { promise = loadHourly(plan); hours.set(plan.end, promise); } return promise; } };
}
async function loadHourly(plan: AdsAlertPlan) {
  const [source, daily] = await Promise.all([
    readAdsProductivityAlert(new Date(adsWallInstant(plan.end).getTime() + 180_000), true),
    schedules(addAdsDays(plan.referenceDate, -1), plan.end.slice(0, 10))
  ]);
  if (source.status !== "ready") return null;
  const allowed = new Set(daily.filter(row => adsEligibleForHour(row, plan, operationalExcludedWbs())).map(row => row.employeeId));
  const evaluated = source.result.evaluated.filter(row => row.employeeId && allowed.has(row.employeeId));
  return { evaluated, excluded: source.result.evaluated.length - evaluated.length + source.result.issues.length };
}
async function loadVolume(plan: AdsAlertPlan, now: Date) {
  const end = adsWallInstant(plan.end);
  const closing = await prisma.realTimeImportBatch.findFirst({ where: { status: "SUCCESS", queueRows: { gt: 0 },
    importedAt: { gte: new Date(end.getTime() - 90_000), lte: new Date(end.getTime() + 90_000) } }, select: { id: true } });
  if (!closing) return adsPendingReport(plan, "Falta uma coleta válida de filas no fechamento da hora.");
  const cycle = plan.referenceDate !== adsBrazilClock(now).day ? `${plan.referenceDate} 23:30` : undefined;
  const executive = await getAdsExecutiveAutomationSnapshot(cycle);
  const bucket = executive.buckets[Number(plan.start.slice(11, 13))];
  if (executive.dateKey !== plan.referenceDate || !bucket?.cycleDownload || bucket.input === null || bucket.forecast === null || bucket.backlog === null
    || [bucket.input,bucket.forecast,bucket.backlog].some(n => !Number.isFinite(n) || n < 0)) return adsPendingReport(plan, "Executive ainda sem entrada, forecast ou backlog válidos para a mesma hora.");
  return volumeOperationalReport(plan, { input: bucket.input, forecast: bucket.forecast, backlog: bucket.backlog });
}
async function loadAht(plan: AdsAlertPlan, hourly: NonNullable<Awaited<ReturnType<typeof loadHourly>>>) {
  const wbs = [...new Set(hourly.evaluated.map(row => wbKey(row.wbLogin)))];
  if (!wbs.length) return ahtOperationalReport(plan, []);
  const history = await prisma.$queryRaw<Array<{ wb: string; submits: number; seconds: number; days: number }>>(Prisma.sql`
    SELECT regexp_replace(lower(trim(p."wbLogin")),'[[:space:]]+','','g') AS wb,sum(p."submitNum")::double precision AS submits,
      sum(p."moderationSeconds")::double precision AS seconds,count(DISTINCT p."bzDay"::date)::int AS days
    FROM "ProductionRecord" p JOIN "Lob" l ON l.id=p."lobId"
    WHERE upper(trim(l.name))='ADS' AND p."bzDay">=${addAdsDays(plan.referenceDate,-14)}::date AND p."bzDay"<${plan.referenceDate}::date
      AND p."submitNum">0 AND p."moderationSeconds">=0
      AND regexp_replace(lower(trim(p."wbLogin")),'[[:space:]]+','','g') IN (${Prisma.join(wbs)}) GROUP BY 1
  `);
  const byWb = new Map(history.map(row => [row.wb,row]));
  const sample: AdsAhtCase[] = [];
  for (const agent of hourly.evaluated) { const comparison = adsAhtComparison(agent, byWb.get(wbKey(agent.wbLogin))); if (comparison) sample.push({ agent, ...comparison }); }
  return ahtOperationalReport(plan, sample);
}
async function loadLateness(plan: AdsAlertPlan) {
  const rows = (await schedules(plan.referenceDate,plan.referenceDate)).filter(row => adsProductiveSchedule(row) && row.startsAt === plan.start.slice(11));
  const entries: AdsLatenessRow[] = [];
  for (const row of rows) {
    const pending = adsScheduleConflict(row,operationalExcludedWbs());
    let first: Date | null = null;
    if (!pending && row.wbLogin) {
      const result = await prisma.realTimeHoursRecord.aggregate({ where: {
        wbLogin: { equals: row.wbLogin, mode: "insensitive" }, isSessionActive: true, identityConfidence: { in: ["HIGH","MEDIUM"] },
        eventType: { in: ["SESSION_START","SESSION_RESUME"] },
        capturedAt: { gte: new Date(adsWallInstant(plan.start).getTime()-3_600_000), lte: adsWallInstant(plan.end) }
      }, _min: { capturedAt: true } });
      first = result._min.capturedAt;
    }
    entries.push({ name: row.name, wb: row.wbLogin, supervisor: row.supervisor, pending,
      first: first ? new Date(first.getTime()-3*3_600_000).toISOString().slice(0,19) : null,
      delay: first ? (first.getTime()-adsWallInstant(plan.start).getTime())/60_000 : null });
  }
  return latenessOperationalReport(plan, entries);
}
async function loadHours(plan: AdsAlertPlan) {
  const daily = (await schedules(plan.referenceDate,plan.referenceDate)).filter(row => adsProductiveSchedule(row)
    && row.startsAt === plan.start.slice(11) && row.endsAt === plan.end.slice(11));
  const records = daily.length ? await prisma.workHourRecord.findMany({ where: { scheduleId: { in: daily.map(row=>row.scheduleId) }, date: new Date(`${plan.referenceDate}T00:00:00Z`) },
    select: { scheduleId: true, plannedStart: true, plannedEnd: true, plannedHours: true, effectiveHours: true, differenceMinutes: true, updatedAt: true, status: true,
      adjustments: { where: { status: { in: ["ABERTO","EM_ANALISE"] } }, select: { id: true } } } }) : [];
  const justifications = daily.length ? await prisma.workHourAdherenceJustification.findMany({ where: { scheduleId: { in: daily.map(row=>row.scheduleId) },
    date: new Date(`${plan.referenceDate}T00:00:00Z`), plannedStart: plan.start.slice(11), plannedEnd: plan.end.slice(11) }, select: { scheduleId: true, status: true } }) : [];
  const bySchedule = new Map(records.map(row=>[row.scheduleId,row]));
  const answered = new Set(justifications.filter(row=>row.status!=="PENDING").map(row=>row.scheduleId));
  const entries: AdsHoursRow[] = daily.map(row => {
    const record=bySchedule.get(row.scheduleId);
    let pending: string | null = null;
    if (adsScheduleConflict(row,operationalExcludedWbs())) pending="Jornada divergente";
    else if (!record || record.plannedStart!==row.startsAt || record.plannedEnd!==row.endsAt || record.updatedAt < adsWallInstant(plan.end)) pending="Fechamento pendente";
    else if (record.adjustments.length) pending="Ajuste em análise";
    else if (answered.has(row.scheduleId)) pending="Justificativa registrada";
    else if (["MISSING_WORK_HOURS","NO_SCHEDULE"].includes(record.status) || record.plannedHours===null || !Number.isFinite(record.plannedHours) || record.plannedHours<=0 || !Number.isFinite(record.effectiveHours)
      || record.effectiveHours<0 || record.differenceMinutes===null) pending="Horas não consolidadas";
    const deficit=record?.differenceMinutes===null || record?.differenceMinutes===undefined ? null : -record.differenceMinutes;
    return { name: row.name, wb: row.wbLogin, supervisor: row.supervisor, planned: record?.plannedHours??null, effective: record?.effectiveHours??null,
      deficit: deficit!==null && deficit>WORK_HOUR_TOLERANCE_MINUTES ? deficit : 0, pending };
  });
  return hoursOperationalReport(plan, entries);
}
async function loadRequired(plan: AdsAlertPlan) {
  const days=adsWeekDays(plan.referenceDate);
  const rows=await prisma.$queryRaw<Array<AdsRequiredRow & { scheduleRows: number }>>(Prisma.sql`
    WITH days AS (SELECT generate_series(${days[0]}::date,${days.at(-1)}::date,interval '1 day')::date AS day),
    shifts AS (SELECT id,name,"startsAt","endsAt" FROM "Shift" WHERE name IN ('Manhã','Tarde','Noite'))
    SELECT to_char(d.day,'YYYY-MM-DD') AS day,sh.name AS shift,sh."startsAt",sh."endsAt",c."requiredStaff" AS required,
      count(DISTINCT s."employeeId") FILTER(WHERE s.status::text IN (${Prisma.join(ADS_PLANNED_SCHEDULE_STATUSES)})
        AND (s.status::text<>'TROCA_APROVADA' OR (nullif(trim(s."startsAt"),'') IS NOT NULL AND nullif(trim(s."endsAt"),'') IS NOT NULL)))::int AS planned,
      count(s.id)::int AS "scheduleRows"
    FROM days d CROSS JOIN shifts sh JOIN "Lob" l ON upper(trim(l.name))='ADS'
    LEFT JOIN "StaffCoverage" c ON c.date=d.day AND c."shiftId"=sh.id AND c."lobId"=l.id
    LEFT JOIN "Schedule" s ON s.date=d.day AND s."shiftId"=sh.id AND s."lobId"=l.id AND s."deletedAt" IS NULL
      AND EXISTS(SELECT 1 FROM "EmployeeProfile" e WHERE e.id=s."employeeId" AND e."lobId"=l.id AND e."deletedAt" IS NULL AND e."roleTitle"='Agente' AND lower(trim(e."operationalStatus")) IN ('ativo','active','nesting'))
    GROUP BY d.day,sh.id,sh.name,sh."startsAt",sh."endsAt",c."requiredStaff" ORDER BY d.day,sh."startsAt"
  `);
  if (rows.length!==days.length*3) return adsPendingReport(plan,"Cadastro dos três turnos ainda incompleto.");
  return requiredOperationalReport(plan,rows.map(row=>({...row,planned:row.scheduleRows ? row.planned : null})));
}
export async function readOperationalReport(plan: AdsAlertPlan, now: Date, context = createOperationalDataContext()): Promise<AdsOperationalReport> {
  if (plan.kind==="volume") return loadVolume(plan,now);
  if (plan.kind==="lateness") return loadLateness(plan);
  if (plan.kind==="hours") return loadHours(plan);
  if (plan.kind==="required") return loadRequired(plan);
  const hourly=await context.hourly(plan);
  if (!hourly) return adsPendingReport(plan,"As 13 coletas necessárias ainda não formam uma hora válida.");
  return plan.kind==="productivity" ? productivityOperationalReport(plan,hourly.evaluated,hourly.excluded) : loadAht(plan,hourly);
}
