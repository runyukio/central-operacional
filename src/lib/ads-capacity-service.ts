import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { Actor } from "@/lib/mock-db";
import { canAccessAdsCapacity } from "@/lib/ads-capacity-permissions";
import { readAdsCapacitySchedules } from "@/lib/staff-coverage-service";
import { executiveQueueIds, loadExecutiveForecastRange } from "@/lib/executive-forecast-service";
import { shiftCategoryName } from "@/lib/shift-display";
import { isAbsenceStatus } from "@/lib/attendance-calculation";
import { addCapacityDays, buildAdsCapacityPlan, buildCapacityRates, capacityClock, capacityDate, capacityDay, capacityHistoryPeriod, capacityPeriod, CAPACITY_SHIFTS, type CapacityProduction } from "@/lib/ads-capacity-core";

export type AdsCapacityQuery = { startDate?: string; endDate?: string; shift?: string };
const normalizeLogin = (value: string) => value.trim().toLowerCase().split("@")[0];
export class AdsCapacityError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function authorizeAdsCapacity(actor: Actor) {
  const user = actor.email ? await prisma.user.findUnique({ where: { email: actor.email, deletedAt: null }, select: { status: true, role: { select: { name: true } } } }) : null;
  if (!user || !canAccessAdsCapacity({ status: user.status, role: user.role.name })) throw new AdsCapacityError("Você não tem permissão para consultar o planejamento ADS.", 403);
}

/** Read-only: no audit writes, no requirement refresh, no changes to imported data. */
export async function readAdsCapacityPlan(actor: Actor, query: AdsCapacityQuery, now = new Date()) {
  await authorizeAdsCapacity(actor);
  const clock = capacityClock(now), today = capacityDate(clock);
  let period: ReturnType<typeof capacityPeriod>;
  try { period = capacityPeriod(query, today); } catch (error) { throw new AdsCapacityError((error as Error).message, 400); }
  const historyPeriod = capacityHistoryPeriod(today);
  const historyStart = new Date(capacityDay(historyPeriod.startDate));
  const historyEnd = new Date(capacityDay(addCapacityDays(historyPeriod.endDate, 2)));
  const queueIds = executiveQueueIds("ADS");
  const forecastDates: string[] = [];
  for (let day = addCapacityDays(period.startDate, -1); day <= addCapacityDays(period.endDate, 2); day = addCapacityDays(day, 1)) forecastDates.push(day);
  const [historySchedules, schedules, rawProduction, attendances, requirements, shifts, forecast, identities] = await Promise.all([
    readAdsCapacitySchedules({ startDate: historyStart, endDate: new Date(capacityDay(historyPeriod.endDate)) }),
    readAdsCapacitySchedules(
      { startDate: new Date(capacityDay(addCapacityDays(period.startDate, -1))), endDate: new Date(capacityDay(addCapacityDays(period.endDate, 1))) },
      { currentAdsOnly: true }
    ),
    prisma.$queryRaw<Array<{ employeeId: string | null; wbLogin: string; at: Date; submit: number; valid: boolean; updatedAt: Date }>>(Prisma.sql`
      SELECT p."employeeId", p."wbLogin", p."bzTime" AS "at", SUM(p."submitNum")::double precision AS "submit",
        BOOL_AND(p."submitNum" >= 0 AND (p."importBatchId" IS NULL OR b."status" = 'SUCCESS')) AS "valid", MAX(p."updatedAt") AS "updatedAt"
      FROM "ProductionRecord" p LEFT JOIN "PerformanceImportBatch" b ON b."id" = p."importBatchId"
      WHERE p."queueId" IN (${Prisma.join(queueIds)}) AND p."bzDay" >= ${historyStart} AND p."bzDay" < ${historyEnd}
        AND p."bzTime" >= ${historyStart} AND p."bzTime" < ${historyEnd}
      GROUP BY p."employeeId", p."wbLogin", p."bzTime"
    `),
    prisma.attendanceRecord.findMany({ where: { date: { gte: historyStart, lt: historyEnd } }, select: { scheduleId: true, employeeId: true, date: true, status: true } }),
    prisma.staffCoverage.findMany({ where: { date: { gte: new Date(capacityDay(period.startDate)), lte: new Date(capacityDay(period.endDate)) }, lob: { name: { equals: "ADS", mode: "insensitive" } } }, select: { date: true, requiredStaff: true, shift: { select: { name: true } } }, orderBy: [{ date: "asc" }, { shift: { name: "asc" } }] }),
    prisma.shift.findMany({ select: { id: true, name: true, startsAt: true, endsAt: true }, orderBy: { name: "asc" } }),
    loadExecutiveForecastRange("ADS", forecastDates, today),
    // Resolve fallback against the whole registry, including inactive/duplicate aliases.
    prisma.employeeProfile.findMany({ select: { id: true, wbLogin: true } })
  ]);
  const people = new Map([...historySchedules, ...schedules].map((s) => [s.employeeId, s]));
  const byLogin = new Map<string, Set<string>>();
  for (const person of identities) {
    const login = normalizeLogin(person.wbLogin), ids = byLogin.get(login) ?? new Set();
    if (login) { ids.add(person.id); byLogin.set(login, ids); }
  }
  let unmatchedProductionRows = 0, incompleteProductionRows = 0;
  const historyLimit = Math.max(capacityDay(addCapacityDays(historyPeriod.endDate, 1)), ...historySchedules.map((s) => s.end ?? 0));
  const referenceProduction = rawProduction.filter((row) => row.at.getTime() < historyLimit);
  const production = referenceProduction.flatMap<CapacityProduction>((row) => {
    if (!row.valid) incompleteProductionRows++;
    const matches = byLogin.get(normalizeLogin(row.wbLogin));
    const employeeId = row.employeeId ?? (matches?.size === 1 ? [...matches][0] : null);
    if (!employeeId || !people.has(employeeId)) { unmatchedProductionRows++; return []; }
    return [{ employeeId, at: row.at.getTime(), submit: Number(row.submit), valid: row.valid }];
  });
  const absence = new Set<string>(), presence = new Set<string>();
  const scheduleByEmployeeDate = new Map(historySchedules.map((s) => [`${s.employeeId}|${s.date}`, s.id]));
  for (const attendance of attendances) {
    const id = attendance.scheduleId ?? scheduleByEmployeeDate.get(`${attendance.employeeId}|${capacityDate(attendance.date.getTime())}`);
    if (!id) continue;
    if (isAbsenceStatus(attendance.status)) absence.add(id);
    if (["PRESENTE", "ATRASO", "SAIDA_ANTECIPADA"].includes(attendance.status)) presence.add(id);
  }
  const history = buildCapacityRates(historySchedules.filter((s) => !absence.has(s.id)), production, presence, clock);
  const templates = CAPACITY_SHIFTS.flatMap((category) => {
    const shift = shifts.find((s) => s.name === category) ?? shifts.find((s) => shiftCategoryName(s.name) === category);
    return shift ? [{ shift: category, startsAt: shift.startsAt, endsAt: shift.endsAt }] : [];
  });
  // Match the current date/category view: canonical shifts take precedence, never sum duplicate category requirements.
  const registered = new Map<string, { date: string; shift: string; required: number }>();
  for (const requirement of [...requirements].sort((a, b) => Number(CAPACITY_SHIFTS.includes(b.shift.name as typeof CAPACITY_SHIFTS[number])) - Number(CAPACITY_SHIFTS.includes(a.shift.name as typeof CAPACITY_SHIFTS[number])))) {
    const date = capacityDate(requirement.date.getTime()), shift = shiftCategoryName(requirement.shift.name), key = `${date}|${shift}`;
    if (!registered.has(key)) registered.set(key, { date, shift, required: requirement.requiredStaff });
  }
  const plan = buildAdsCapacityPlan({ ...period, schedules, history, requirements: [...registered.values()], forecast: forecast.points, templates });
  const warnings: string[] = [];
  if (!plan.reconciliation.forecastComplete) warnings.push("Forecast indisponível ou incompleto. A capacidade continua disponível, mas o saldo não pode ser calculado.");
  if (templates.length < 3) warnings.push("Existem turnos sem horário cadastrado. Revise a cobertura do período.");
  if (incompleteProductionRows) warnings.push("Há produção vinculada a importações não concluídas integralmente. Os turnos afetados não formam a média individual.");
  if (unmatchedProductionRows) warnings.push(`${unmatchedProductionRows} registros de produção não puderam ser associados aos parceiros elegíveis desta consulta.`);
  if (plan.summary.missing) warnings.push(`${plan.summary.missing} participações em turnos estão sem referência de produtividade ou horário válido. A capacidade exibida é parcial.`);
  const incompleteShifts = [...history.rates.values()].reduce((sum, rate) => sum + rate.incompleteShifts, 0);
  if (incompleteShifts) warnings.push(`${incompleteShifts} turnos históricos sem cobertura horária completa, presença/produção confirmada ou ainda em andamento foram desconsiderados. Lacunas não viram zero.`);
  const outsideSubmit = [...history.rates.values()].reduce((sum, rate) => sum + rate.outsideSubmit, 0);
  if (outsideSubmit) warnings.push(`${outsideSubmit.toLocaleString("pt-BR")} submits fora dos intervalos históricos elegíveis não aumentaram a produtividade utilizada.`);
  const maxDate = (values: Date[]) => values.length ? new Date(Math.max(...values.map((date) => date.getTime()))).toISOString() : null;
  const sources = { latestProductionAt: maxDate(referenceProduction.map((r) => r.at)), productionUpdatedAt: maxDate(referenceProduction.map((r) => r.updatedAt)), latestVolumeAt: forecast.latestVolumeAt, volumeUpdatedAt: forecast.updatedAt, forecastCutoff: today };
  const version = createHash("sha256").update(JSON.stringify({ period, historyPeriod, plan, sources })).digest("hex");
  return { ...plan, period, historyPeriod, sources, warnings, version, calculatedAt: now.toISOString() };
}

export type AdsCapacitySnapshot = Awaited<ReturnType<typeof readAdsCapacityPlan>>;
export type AdsCapacitySummary = Omit<AdsCapacitySnapshot, "data"> & { data: Array<Omit<AdsCapacitySnapshot["data"][number], "agents">> };
export function capacitySummary(snapshot: AdsCapacitySnapshot): AdsCapacitySummary {
  return { ...snapshot, data: snapshot.data.map(({ agents: _agents, ...row }) => row) };
}
