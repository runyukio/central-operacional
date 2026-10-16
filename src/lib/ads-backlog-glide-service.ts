import { prisma } from "./prisma";
import type { Actor } from "./mock-db";
import { normalizeRole, canAccessRealTimeQueues } from "./permissions";
import { canAccessAdsCapacity } from "./ads-capacity-permissions";
import { readAdsCapacityPlan } from "./ads-capacity-service";
import { readAdsCapacitySchedules } from "./staff-coverage-service";
import { getRealtimeSnapshot } from "./realtime-service";
import { loadExecutiveForecastRange } from "./executive-forecast-service";
import { parseAdsExecutiveCycle } from "./ads-executive-report-core";
import { addCapacityDays, capacityClock, capacityDate, capacityDay, capacitySkill } from "./ads-capacity-core";
import { ADS_GLIDE_STALE_MINUTES, buildAdsBacklogGlide, glideForecastDates, resolveGlideAttendance, type AdsGlideAgent, type AdsBacklogGlidePoint, type AdsBacklogGlideState } from "./ads-backlog-glide-core";
import { readObservedAdsGlideAbs, type ObservedAdsGlideAbs } from "./ads-backlog-glide-abs";
import { buildGlideDemandContext, type GlideDemandContext } from "./ads-backlog-glide-demand";

export class AdsBacklogGlideError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export type AdsBacklogGlideQuery = { horizonDays?: string };
export type AdsBacklogGlideResponse = {
  snapshotCycle: string | null;
  currentBacklog: number | null;
  absRate: number | null;
  absReference: ObservedAdsGlideAbs;
  demand: GlideDemandContext | null;
  calculatedAt: string;
  historyPeriod: { startDate: string; endDate: string };
  sources: {
    snapshotImportedAt: string | null;
    snapshotAgeMinutes: number | null;
    cycleAgeMinutes: number | null;
    latestProductionAt: string | null;
    productionUpdatedAt: string | null;
    latestVolumeAt: string | null;
    volumeUpdatedAt: string | null;
    forecastCutoff: string | null;
  };
  warnings: string[];
  points: AdsBacklogGlidePoint[];
  clearanceAt: number | null;
  reaccumulates: boolean;
  state: AdsBacklogGlideState;
  assumedSharedCapacity: true;
};

/** Always use the current database role; an old session cannot retain access. */
export async function authorizeAdsBacklogGlide(actor: Actor): Promise<Actor> {
  const user = actor.email ? await prisma.user.findUnique({ where: { email: actor.email, deletedAt: null }, select: { status: true, role: { select: { name: true } } } }) : null;
  const permission = user ? { status: user.status, role: user.role.name } : null;
  if (!permission || !canAccessAdsCapacity(permission) || !canAccessRealTimeQueues(permission)) {
    throw new AdsBacklogGlideError("Você não tem permissão para consultar o glide path ADS.", 403);
  }
  return { ...actor, role: normalizeRole(permission.role) };
}

/** Read only: no schedule updates, imports, stored requirements or external deliveries. */
export async function readAdsBacklogGlide(actor: Actor, query: AdsBacklogGlideQuery = {}, now = new Date()): Promise<AdsBacklogGlideResponse> {
  const currentActor = await authorizeAdsBacklogGlide(actor);
  const horizonDays = query.horizonDays === undefined ? 14 : Number(query.horizonDays);
  if (![7, 14].includes(horizonDays) || query.horizonDays?.trim() === "") throw new AdsBacklogGlideError("Selecione um horizonte de 7 ou 14 dias.", 400);
  const clock = capacityClock(now), today = capacityDate(clock), endDate = addCapacityDays(today, horizonDays - 1);
  const endTimestamp = capacityDay(addCapacityDays(endDate, 1));
  const [plan, initialRealtime, previousSchedules, absReference] = await Promise.all([
    readAdsCapacityPlan(currentActor, { startDate: today, endDate, shift: "Todos" }, now),
    getRealtimeSnapshot(currentActor, { view: "queues" }),
    // Include the preceding night cohort, which is deliberately outside the planning table's start dates.
    readAdsCapacitySchedules({ startDate: new Date(capacityDay(addCapacityDays(today, -1))), endDate: new Date(capacityDay(addCapacityDays(today, -1))) }, { currentAdsOnly: true }),
    readObservedAdsGlideAbs(today)
  ]);
  if ("error" in initialRealtime) throw new AdsBacklogGlideError(initialRealtime.error || "Não foi possível consultar o Real Time.", initialRealtime.status ?? 500);
  let realtime = initialRealtime;
  // A late reimport must not silently make an older operational cycle the newest backlog.
  const cycles = realtime.data.queueView.cycles.flatMap((cycle) => {
    try { return [{ cycle: cycle.value, timestamp: parseAdsExecutiveCycle(cycle.value).timestamp }]; } catch { return []; }
  }).sort((a, b) => b.timestamp - a.timestamp);
  if (cycles[0] && cycles[0].cycle !== realtime.data.queueView.selectedCycle) {
    const latest = await getRealtimeSnapshot(currentActor, { view: "queues", cycleDownload: cycles[0].cycle });
    if ("error" in latest) throw new AdsBacklogGlideError(latest.error || "Não foi possível consultar o ciclo mais recente.", latest.status ?? 500);
    realtime = latest;
  }
  const snapshotCycle = realtime.data.queueView.selectedCycle || null;
  let snapshotTimestamp: number | null = null;
  try { if (snapshotCycle) snapshotTimestamp = parseAdsExecutiveCycle(snapshotCycle).timestamp; } catch { /* Invalid source stays unavailable. */ }
  const cycle = realtime.data.queueView.cycles.find((row) => row.value === snapshotCycle);
  const snapshotImportedAt = cycle?.importedAt ?? null;
  const snapshotAgeMinutes = snapshotImportedAt && Number.isFinite(Date.parse(snapshotImportedAt)) ? (now.getTime() - Date.parse(snapshotImportedAt)) / 60_000 : null;
  const cycleAgeMinutes = snapshotTimestamp === null ? null : (clock - snapshotTimestamp) / 60_000;
  const queueRows = realtime.data.queueView.rows.filter((row) => row.lob.trim().toUpperCase() === "ADS");
  const validBacklog = queueRows.length > 0 && queueRows.every((row) => Number.isFinite(row.current.backlog) && row.current.backlog >= 0);
  const currentBacklog = validBacklog ? queueRows.reduce((sum, row) => sum + row.current.backlog, 0) : null;
  const stale = snapshotTimestamp !== null && (cycleAgeMinutes! > ADS_GLIDE_STALE_MINUTES || cycleAgeMinutes! < -5 || snapshotAgeMinutes === null || snapshotAgeMinutes > ADS_GLIDE_STALE_MINUTES || snapshotAgeMinutes < -5);
  const warnings = [...plan.warnings, ...absReference.warnings,
    "Projeção consolidada de ADS: considera capacidade compartilhada entre filas. Restrições de skill, prioridade e roteamento podem impedir a limpeza de uma fila específica.",
    "As entradas futuras usam a previsão histórica da Central. O ritmo recebido hoje é exibido separadamente e não é extrapolado para todo o horizonte.",
    "O ABS observado nos últimos sete dias completos é aplicado somente a turnos ainda sem presença confirmada. Não há novo desconto de pausas nem fator 1,29."
  ];
  if (stale) warnings.push("O ciclo ou a importação do Real Time está desatualizado ou com horário inconsistente. A projeção parte do ciclo indicado; a previsão de limpeza foi suspensa.");
  if (currentBacklog === null) warnings.push("Backlog ADS indisponível ou inválido no último ciclo. Ausência de filas não é tratada como backlog zero.");
  const base = { snapshotCycle, currentBacklog, absRate: absReference.rate, absReference, demand: null as GlideDemandContext | null, calculatedAt: now.toISOString(), historyPeriod: plan.historyPeriod,
    sources: { snapshotImportedAt, snapshotAgeMinutes, cycleAgeMinutes, ...plan.sources }, warnings, assumedSharedCapacity: true as const };
  if (snapshotTimestamp === null || snapshotTimestamp >= endTimestamp || capacityDate(snapshotTimestamp) < today) {
    if (snapshotTimestamp !== null && capacityDate(snapshotTimestamp) < today) warnings.push("O último ciclo pertence a um dia anterior. Atualize a base para combinar o backlog com o cronograma atual.");
    return { ...base, points: [], clearanceAt: null, reaccumulates: false, state: stale ? "stale" : "incomplete" };
  }
  const planAgents = plan.data.flatMap((row) => row.agents);
  const rates = new Map(planAgents.map((agent) => [agent.employeeId, agent]));
  // Reuse an already-calculated canonical skill reference. Rebuilding a donor pool
  // from only future roster members would silently produce a different average.
  const skillRates = new Map(planAgents.filter((agent) => agent.source === "skill" && agent.rate !== null).map((agent) => [capacitySkill(agent.skill), agent.rate!]));
  const agents: AdsGlideAgent[] = [...planAgents, ...previousSchedules.filter((agent) => agent.end !== null && agent.end > snapshotTimestamp!).map((agent) => {
    const reference = rates.get(agent.employeeId);
    return { ...agent, rate: reference?.rate ?? skillRates.get(capacitySkill(agent.skill)) ?? null };
  })];
  const employeeIds = [...new Set(agents.map((agent) => agent.employeeId))];
  const [forecast, attendances] = await Promise.all([
    loadExecutiveForecastRange("ADS", glideForecastDates(snapshotTimestamp - 3 * 3_600_000, endTimestamp)),
    employeeIds.length ? prisma.attendanceRecord.findMany({ where: { employeeId: { in: employeeIds }, date: { gte: new Date(capacityDay(addCapacityDays(today, -1))), lt: new Date(endTimestamp) } }, select: { employeeId: true, scheduleId: true, date: true, status: true } }) : []
  ]);
  const { confirmedPresent, unavailable } = resolveGlideAttendance(agents, snapshotTimestamp, attendances.map((row) => ({ ...row, date: capacityDate(row.date.getTime()) })));
  const demand = buildGlideDemandContext({ snapshotTimestamp, queueHistories: queueRows.map(row => row.history), forecast: forecast.points });
  const result = buildAdsBacklogGlide({ snapshotTimestamp, endTimestamp, currentBacklog, agents, forecast: forecast.points, confirmedPresent, unavailable, stale, absRate: absReference.rate });
  warnings.push(...forecast.warnings);
  if (result.points.some((point) => point.missingAgents > 0)) warnings.push("Há agentes sem referência de produtividade. A capacidade é incompleta e a previsão de limpeza foi suspensa.");
  if (agents.some(agent => agent.start === null || agent.end === null || agent.end <= agent.start)) warnings.push("Há cronogramas com horário inválido. A capacidade é incompleta e a previsão de limpeza foi suspensa.");
  if (result.points.some((point) => point.forecast === null)) warnings.push("Há horas sem forecast disponível. Essas horas não viram volume zero; a previsão de limpeza foi suspensa.");
  const uncoveredIntervals = result.points.filter((point) => point.scheduledAgents === 0).length;
  if (uncoveredIntervals) warnings.push(`${uncoveredIntervals} intervalos estão sem pessoas disponíveis no cronograma após as ausências confirmadas. A capacidade desses intervalos é zero.`);
  if (result.state === "no-clearance") warnings.push("O backlog não zera no horizonte com o forecast, cronograma e ABS considerados.");
  if (result.reaccumulates) warnings.push("A projeção zera em um intervalo e volta a acumular depois. A primeira zeragem não representa limpeza sustentada.");
  return { ...base, ...result, demand, warnings: [...new Set(warnings)] };
}
