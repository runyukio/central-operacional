import { isExecutivePresentHeadcountRow } from "@/lib/realtime-report-headcount";
import { isRealtimeActiveEmployeeStatus } from "@/lib/realtime-employee-status";

export type AdsExecutiveQueueMetric = {
  input: number;
  output: number;
  ahtMs: number | null;
  latencyMs: number | null;
  maxLatencyMs: number | null;
  backlog: number;
};

export type AdsExecutiveQueueRow = {
  lob: string;
  slaTargetMinutes?: number | null;
  history: Array<AdsExecutiveQueueMetric & { cycleDownload: string }>;
};

export type ExecutiveReportLob = "ADS" | "VIDEO";
export type ExecutiveAgentLob = ExecutiveReportLob | "COMMENTS";

export type AdsExecutiveAgentRow = {
  displayName: string;
  wbLogin: string;
  rawWbLogin: string;
  skill?: string;
  lob: string;
  crossingStatus: string;
  personType: string;
  employeeStatus: string;
  presenceStatus: string;
  isSchedulePresent?: boolean;
  shift?: string;
  history: Array<{
    cycleDownload: string;
    submit: number;
    ahtMs: number | null;
    moderationMs: number;
  }>;
};

export type AdsExecutiveForecastPoint = {
  dateKey: string;
  hour: number;
  input: number;
};

export type AdsExecutiveRequirement = {
  hour: number;
  required: number;
};

export type AdsExecutiveHourBucket = {
  hour: number;
  label: string;
  cycleDownload: string | null;
  input: number | null;
  output: number | null;
  forecast: number | null;
  ahtMs: number | null;
  latencyMs: number | null;
  maxLatencyMs: number | null;
  backlog: number | null;
  required: number | null;
  online: number | null;
};

export type AdsExecutiveRankingRow = {
  name: string;
  wbLogin: string;
  submit: number;
  ahtMs: number | null;
};

export type AdsExecutiveKpi = {
  label: string;
  value: number | null;
  previous: number | null;
  delta: number | null;
  betterWhen: "up" | "down";
};

export type AdsExecutiveReportSnapshot = {
  lob: ExecutiveReportLob;
  latencyTargetMinutes: number;
  selectedCycle: string;
  dateKey: string;
  dateLabel: string;
  latestHourLabel: string;
  currentHour: number;
  buckets: AdsExecutiveHourBucket[];
  cards: AdsExecutiveKpi[];
  topAgents: AdsExecutiveRankingRow[];
  lowAgents: AdsExecutiveRankingRow[];
};

export type ParsedExecutiveCycle = {
  cycleDownload: string;
  dateKey: string;
  hour: number;
  minute: number;
  timestamp: number;
};

type QueueSnapshot = ParsedExecutiveCycle & { metric: AdsExecutiveQueueMetric };

export function buildAdsExecutiveReportSnapshot(input: {
  queueRows: AdsExecutiveQueueRow[];
  agentRows: AdsExecutiveAgentRow[];
  selectedCycle: string;
  lob?: ExecutiveReportLob;
  forecast?: AdsExecutiveForecastPoint[];
  requirements?: AdsExecutiveRequirement[];
}): AdsExecutiveReportSnapshot {
  const selected = parseAdsExecutiveCycle(input.selectedCycle);
  const lob = input.lob ?? "ADS";
  const queues = input.queueRows.filter((row) => normalize(row.lob) === normalize(lob));
  const backlogLatencyQueues = lob === "VIDEO"
    ? queues.filter((row) => row.slaTargetMinutes === 15)
    : queues;
  const agents = input.agentRows.filter((row) => isExecutiveAgentForLob(row, lob));
  const queueSnapshots = buildQueueSnapshots(queues, selected.timestamp);
  const backlogLatencySnapshots = buildQueueSnapshots(backlogLatencyQueues, selected.timestamp);
  const queueByHour = buildQueueHourDeltas(queueSnapshots, selected.dateKey);
  const backlogLatencyByHour = buildQueueHourDeltas(backlogLatencySnapshots, selected.dateKey);
  const agentByHour = buildAgentHourDeltas(agents, selected);
  const forecastByHour = new Map(
    (input.forecast ?? [])
      .filter((row) => row.dateKey === selected.dateKey)
      .map((row) => [row.hour, Math.max(0, Math.round(row.input))])
  );
  const requiredByHour = new Map((input.requirements ?? []).map((row) => [row.hour, row.required]));
  const currentOnline = agents.filter((row) => isExecutiveAgentOnlineAtCycle(row, input.selectedCycle)).length;

  const buckets = Array.from({ length: 24 }, (_, hour): AdsExecutiveHourBucket => {
    const queue = queueByHour.get(hour);
    const backlogLatency = backlogLatencyByHour.get(hour);
    const agent = agentByHour.get(hour);
    const isCurrentHour = hour === selected.hour;
    return {
      hour,
      label: `${String(hour).padStart(2, "0")}h`,
      cycleDownload: queue?.cycleDownload ?? agent?.cycleDownload ?? null,
      input: queue?.metric.input ?? null,
      output: queue?.metric.output ?? null,
      forecast: forecastByHour.get(hour) ?? null,
      ahtMs: queue?.metric.ahtMs ?? null,
      latencyMs: queue?.metric.latencyMs ?? null,
      maxLatencyMs: backlogLatency?.metric.maxLatencyMs ?? null,
      backlog: backlogLatency?.metric.backlog ?? null,
      required: requiredByHour.get(hour) ?? null,
      online: isCurrentHour ? currentOnline : agent?.online ?? null
    };
  });

  const filled = buckets.filter((bucket) => bucket.cycleDownload && bucket.hour <= selected.hour);
  const latest = filled.at(-1) ?? null;
  const previous = filled.length > 1 ? filled.at(-2) ?? null : null;
  const rankings = buildAgentRankings(agents, latest?.cycleDownload ?? input.selectedCycle, previous?.cycleDownload ?? null);

  return {
    lob,
    latencyTargetMinutes: lob === "VIDEO" ? 15 : 120,
    selectedCycle: input.selectedCycle,
    dateKey: selected.dateKey,
    dateLabel: formatDateLabel(selected.dateKey),
    latestHourLabel: latest?.cycleDownload ?? input.selectedCycle,
    currentHour: selected.hour,
    buckets,
    cards: [
      kpi("Last-hour Submit", latest?.output ?? null, previous?.output ?? null, "up"),
      kpi("Last-hour Input", latest?.input ?? null, previous?.input ?? null, "up"),
      kpi("Online agents", latest?.online ?? null, previous?.online ?? null, "up"),
      kpi("Current Backlog", latest?.backlog ?? null, previous?.backlog ?? null, "down")
    ],
    topAgents: rankings.top,
    lowAgents: rankings.low
  };
}

export function parseAdsExecutiveCycle(value: string): ParsedExecutiveCycle {
  const match = value.match(/(\d{4})[-/](\d{2})[-/](\d{2})(?:[T_\s-]+(\d{2})[:-](\d{2})(?::?(\d{2}))?)?/);
  if (!match) throw new Error(`Ciclo do Real Time inválido: ${value || "vazio"}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4] ?? 0);
  const minute = Number(match[5] ?? 0);
  const second = Number(match[6] ?? 0);
  return {
    cycleDownload: value,
    dateKey: `${match[1]}-${match[2]}-${match[3]}`,
    hour,
    minute,
    timestamp: Date.UTC(year, month - 1, day, hour, minute, second)
  };
}

function buildQueueSnapshots(rows: AdsExecutiveQueueRow[], maxTimestamp: number) {
  const byCycle = new Map<string, AdsExecutiveQueueMetric[]>();
  for (const row of rows) {
    for (const item of row.history) {
      const parsed = safeParseCycle(item.cycleDownload);
      if (!parsed || parsed.timestamp > maxTimestamp) continue;
      const metrics = byCycle.get(item.cycleDownload) ?? [];
      metrics.push(item);
      byCycle.set(item.cycleDownload, metrics);
    }
  }

  const latestByHour = new Map<string, QueueSnapshot>();
  for (const [cycleDownload, metrics] of byCycle) {
    const parsed = parseAdsExecutiveCycle(cycleDownload);
    const key = `${parsed.dateKey}|${parsed.hour}`;
    const snapshot: QueueSnapshot = { ...parsed, metric: summarizeQueueMetrics(metrics) };
    const existing = latestByHour.get(key);
    if (!existing || snapshot.timestamp > existing.timestamp) latestByHour.set(key, snapshot);
  }
  return [...latestByHour.values()].sort((a, b) => a.timestamp - b.timestamp);
}

function buildQueueHourDeltas(snapshots: QueueSnapshot[], dateKey: string) {
  const result = new Map<number, { cycleDownload: string; metric: AdsExecutiveQueueMetric }>();
  let previous: QueueSnapshot | null = null;
  for (const snapshot of snapshots) {
    if (snapshot.dateKey === dateKey) {
      result.set(snapshot.hour, {
        cycleDownload: snapshot.cycleDownload,
        metric: queueDelta(snapshot.metric, previous?.metric ?? null)
      });
    }
    previous = snapshot;
  }
  return result;
}

function buildAgentHourDeltas(rows: AdsExecutiveAgentRow[], selected: ParsedExecutiveCycle) {
  const hourly = new Map<number, { cycleDownload: string; timestamp: number; online: number }>();
  for (const row of rows) {
    const latestByHour = new Map<string, ReturnType<typeof parseAdsExecutiveCycle> & { submit: number }>();
    for (const item of row.history) {
      const parsed = safeParseCycle(item.cycleDownload);
      if (!parsed || parsed.timestamp > selected.timestamp) continue;
      const key = `${parsed.dateKey}|${parsed.hour}`;
      const existing = latestByHour.get(key);
      if (!existing || parsed.timestamp > existing.timestamp) latestByHour.set(key, { ...parsed, submit: finite(item.submit) });
    }
    const ordered = [...latestByHour.values()].sort((a, b) => a.timestamp - b.timestamp);
    let previous: (typeof ordered)[number] | null = null;
    for (const snapshot of ordered) {
      if (snapshot.dateKey === selected.dateKey) {
        const submit = cumulativeDelta(snapshot.submit, previous?.submit ?? null);
        const current = hourly.get(snapshot.hour) ?? {
          cycleDownload: snapshot.cycleDownload,
          timestamp: snapshot.timestamp,
          online: 0
        };
        if (submit > 0) current.online += 1;
        if (snapshot.timestamp >= current.timestamp) {
          current.cycleDownload = snapshot.cycleDownload;
          current.timestamp = snapshot.timestamp;
        }
        hourly.set(snapshot.hour, current);
      }
      previous = snapshot;
    }
  }
  return hourly;
}

function buildAgentRankings(rows: AdsExecutiveAgentRow[], currentCycle: string, previousCycle: string | null) {
  const currentTarget = parseAdsExecutiveCycle(currentCycle);
  const previousTarget = previousCycle ? parseAdsExecutiveCycle(previousCycle) : null;
  const ranked: AdsExecutiveRankingRow[] = [];
  for (const row of rows) {
    const current = historyAtOrBefore(row, currentTarget);
    if (!current) continue;
    const previous = previousTarget ? historyAtOrBefore(row, previousTarget) : previousHistory(row, currentTarget.timestamp);
    const submit = cumulativeDelta(current.submit, previous?.submit ?? null);
    if (submit <= 0) continue;
    const moderation = cumulativeDelta(current.moderationMs, previous?.moderationMs ?? null);
    ranked.push({
      name: row.displayName || row.wbLogin || row.rawWbLogin || "Unknown agent",
      wbLogin: row.wbLogin || row.rawWbLogin,
      submit,
      ahtMs: moderation > 0 ? moderation / submit : current.ahtMs
    });
  }
  return {
    top: [...ranked].sort((a, b) => b.submit - a.submit || a.name.localeCompare(b.name)).slice(0, 5),
    low: [...ranked].sort((a, b) => a.submit - b.submit || a.name.localeCompare(b.name)).slice(0, 5)
  };
}

function historyAtOrBefore(row: AdsExecutiveAgentRow, target: ParsedExecutiveCycle) {
  return row.history
    .map((item) => ({ ...item, parsed: safeParseCycle(item.cycleDownload) }))
    .filter((item) => item.parsed && item.parsed.dateKey === target.dateKey && item.parsed.timestamp <= target.timestamp)
    .sort((a, b) => (b.parsed?.timestamp ?? 0) - (a.parsed?.timestamp ?? 0))[0] ?? null;
}

function previousHistory(row: AdsExecutiveAgentRow, timestamp: number) {
  return row.history
    .map((item) => ({ ...item, parsed: safeParseCycle(item.cycleDownload) }))
    .filter((item) => item.parsed && item.parsed.timestamp < timestamp)
    .sort((a, b) => (b.parsed?.timestamp ?? 0) - (a.parsed?.timestamp ?? 0))[0] ?? null;
}

function hadExecutiveActivityInSelectedHour(row: AdsExecutiveAgentRow, selected: ParsedExecutiveCycle) {
  const snapshots = row.history
    .map((item) => ({ ...item, parsed: safeParseCycle(item.cycleDownload) }))
    .filter((item) => item.parsed && item.parsed.timestamp <= selected.timestamp)
    .sort((left, right) => (left.parsed?.timestamp ?? 0) - (right.parsed?.timestamp ?? 0));
  const current = snapshots
    .filter((item) => item.parsed?.dateKey === selected.dateKey && item.parsed.hour === selected.hour)
    .at(-1);
  if (!current?.parsed) return false;
  const previous = snapshots.filter((item) => (item.parsed?.timestamp ?? 0) < current.parsed!.timestamp).at(-1);
  return cumulativeDelta(current.submit, previous?.submit ?? null) > 0;
}

function summarizeQueueMetrics(metrics: AdsExecutiveQueueMetric[]): AdsExecutiveQueueMetric {
  const input = metrics.reduce((sum, item) => sum + finite(item.input), 0);
  const output = metrics.reduce((sum, item) => sum + finite(item.output), 0);
  const weightedAht = metrics.reduce((sum, item) => sum + (item.ahtMs ?? 0) * finite(item.output), 0);
  const weightedLatency = metrics.reduce((sum, item) => sum + (item.latencyMs ?? 0) * finite(item.input), 0);
  const ahtValues = metrics.map((item) => item.ahtMs).filter(isNumber);
  const latencyValues = metrics.map((item) => item.latencyMs).filter(isNumber);
  const maxValues = metrics.map((item) => item.maxLatencyMs).filter(isNumber);
  return {
    input,
    output,
    ahtMs: output > 0 ? weightedAht / output : average(ahtValues),
    latencyMs: input > 0 ? weightedLatency / input : average(latencyValues),
    maxLatencyMs: maxValues.length ? Math.max(...maxValues) : null,
    backlog: metrics.reduce((sum, item) => sum + finite(item.backlog), 0)
  };
}

function queueDelta(current: AdsExecutiveQueueMetric, previous: AdsExecutiveQueueMetric | null): AdsExecutiveQueueMetric {
  const input = cumulativeDelta(current.input, previous?.input ?? null);
  const output = cumulativeDelta(current.output, previous?.output ?? null);
  return {
    input,
    output,
    ahtMs: weightedAverageDelta(current.output, current.ahtMs, previous?.output ?? null, previous?.ahtMs ?? null),
    latencyMs: weightedAverageDelta(current.input, current.latencyMs, previous?.input ?? null, previous?.latencyMs ?? null) ?? current.latencyMs,
    maxLatencyMs: current.maxLatencyMs,
    backlog: current.backlog
  };
}

function weightedAverageDelta(currentTotal: number, currentAverage: number | null, previousTotal: number | null, previousAverage: number | null) {
  if (currentAverage === null || previousTotal === null || previousAverage === null || currentTotal < previousTotal) return currentAverage;
  const deltaTotal = cumulativeDelta(currentTotal, previousTotal);
  if (deltaTotal <= 0) return currentAverage;
  const weighted = currentAverage * currentTotal - previousAverage * previousTotal;
  return weighted >= 0 ? weighted / deltaTotal : currentAverage;
}

function cumulativeDelta(current: number | null | undefined, previous: number | null | undefined) {
  const currentValue = finite(current);
  if (!isNumber(previous)) return currentValue;
  return currentValue >= previous ? currentValue - previous : currentValue;
}

function kpi(label: string, value: number | null, previous: number | null, betterWhen: "up" | "down"): AdsExecutiveKpi {
  return { label, value, previous, delta: value !== null && previous !== null ? value - previous : null, betterWhen };
}

export function isExecutiveAgentForLob(row: AdsExecutiveAgentRow, lob: ExecutiveAgentLob) {
  return normalize(row.lob) === normalize(lob)
    && normalize(row.crossingStatus) === "encontrado"
    && normalize(row.personType) === "agente"
    && isRealtimeActiveEmployeeStatus(row.employeeStatus);
}

export function isExecutiveAgentOnlineAtCycle(row: AdsExecutiveAgentRow, selectedCycle: string) {
  const selected = parseAdsExecutiveCycle(selectedCycle);
  return isExecutivePresentHeadcountRow(row) || hadExecutiveActivityInSelectedHour(row, selected);
}

function safeParseCycle(value: string) {
  try {
    return parseAdsExecutiveCycle(value);
  } catch {
    return null;
  }
}

function normalize(value: unknown) {
  return String(value ?? "").trim().toLocaleLowerCase("pt-BR");
}

function finite(value: number | null | undefined) {
  return Number.isFinite(value) ? Number(value) : 0;
}

function isNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function formatDateLabel(dateKey: string) {
  const [year, month, day] = dateKey.split("-");
  return `${day}/${month}/${year}`;
}
