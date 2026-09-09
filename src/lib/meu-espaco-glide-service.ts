import { prisma } from "@/lib/prisma";
import { isScheduledStatus } from "@/lib/attendance-calculation";
import { plannedProductiveHoursForSchedule } from "@/lib/work-hours-rules";
import { MeuEspacoError } from "@/lib/meu-espaco-access";
import { spaceDate, spaceToday } from "@/lib/meu-espaco-filters";
import { getSpaceResults } from "@/lib/meu-espaco-results-service";
import { spaceTargets } from "@/lib/meu-espaco-targets";
import { selectSpaceGlideEmployees } from "@/lib/meu-espaco-glide-scope";
import { moveSpaceDay, projectSpaceGlide, spaceMonthEnd } from "@/lib/meu-espaco-glide";
import type { MeuEspacoScope } from "@/lib/meu-espaco-scope";

export async function getSpaceGlide(scope: MeuEspacoScope, query: URLSearchParams, today = spaceToday()) {
  const month = query.get("month") || today.slice(0, 7), lob = query.get("lob") || "ADS", id = query.get("metric") || "quality";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month > today.slice(0, 7)) throw new MeuEspacoError("Selecione o mês atual ou um mês anterior.");
  spaceDate(`${month}-01`);
  const target = spaceTargets(lob).find((row) => row.id === id);
  if (!target) throw new MeuEspacoError("Indicador ou operação inválidos.");
  const raw = query.get("remainingWeight");
  const override = raw === null ? undefined : Number(raw);
  if (override !== undefined && (!raw?.trim() || !Number.isFinite(override) || override < 0 || override > 1e9)) throw new MeuEspacoError("Informe um volume restante entre 0 e 1 bilhão.");
  const employees = selectSpaceGlideEmployees(scope, lob, id, query.get("employeeId") || "");
  const filteredScope = { ...scope, employees, employeeIds: employees.map((p) => p.id) };
  const monthEnd = spaceMonthEnd(month), beforeToday = moveSpaceDay(today, -1), end = monthEnd < beforeToday ? monthEnd : beforeToday;
  const lookbackStart = moveSpaceDay(`${month}-01`, -6);
  const results = end >= `${month}-01` ? await getSpaceResults(filteredScope, new URLSearchParams({ startDate: lookbackStart, endDate: end, lob }), target.id) : null;
  const group = results?.groups.find((row) => row.lob === lob);
  const schedules = employees.length ? await prisma.schedule.findMany({ where: { employeeId: { in: filteredScope.employeeIds }, date: { gte: spaceDate(lookbackStart), lte: spaceDate(monthEnd) }, deletedAt: null },
    select: { employeeId: true, date: true, status: true, startsAt: true, endsAt: true, shift: { select: { name: true } } } }) : [];
  const cutoff = group?.daily.filter((row) => row.date >= `${month}-01` && (row.metric.weights?.[target.id]?.denominator ?? 0) > 0).at(-1)?.date;
  const sourceByKey = new Map(results?.sourceMetricDays?.map((row) => [`${row.employeeId}:${row.date}`, row.weight]) ?? []);
  const scheduled = new Map<string, number>(), matchedDenominators = new Map<string, number>(), seen = new Set<string>();
  for (const row of schedules) {
    const date = row.date.toISOString().slice(0, 10), key = `${row.employeeId}:${date}`;
    const eligible = id === "abs" ? isScheduledStatus(row.status) : (plannedProductiveHoursForSchedule(row) ?? 0) > 0;
    const weight = sourceByKey.get(key), historical = !!cutoff && date <= cutoff;
    // Missing partner-days are not treated as zero throughput in the observed rhythm.
    if (eligible && !seen.has(key) && (!historical || weight)) {
      scheduled.set(date, (scheduled.get(date) ?? 0) + 1); seen.add(key);
      if (weight) matchedDenominators.set(date, (matchedDenominators.get(date) ?? 0) + weight.denominator);
    }
  }
  return { ...projectSpaceGlide({ target, month, today, override, scheduled, matchedDenominators, daily: group?.daily.flatMap((row) => row.metric.weights?.[target.id] ? [{ date: row.date, weight: row.metric.weights[target.id]! }] : []) ?? [] }), updatedAt: group?.coverage.updatedAt ?? null };
}
