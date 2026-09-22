export type CycleFeed = "queues" | "agents";
export type CycleReading = { feed: CycleFeed; cycle: string | null; importedAt: string | null };
export type CycleHealth = CycleReading & { expected: string; status: "ok" | "late" | "missing" | "invalid"; delayMinutes: number | null };
export type MonitorState = Partial<Record<CycleFeed, { incident: string | null }>>;
export type MonitorEvent = { id: string; kind: "late" | "recovered"; health: CycleHealth };
const minute = 60_000;

export function brazilWallTime(now: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}
export function cycleMillis(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2} \d{2}:(00|30)$/.test(value)) return null;
  const t = Date.parse(`${value.replace(" ", "T")}:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 16).replace("T", " ") === value ? t : null;
}
function formatWall(t: number) { return new Date(t).toISOString().slice(0, 16).replace("T", " "); }
export function evaluateCycle(reading: CycleReading, now: Date): CycleHealth {
  const wall = Date.parse(`${brazilWallTime(now).replace(" ", "T")}:00Z`);
  const expectedTime = Math.floor((wall - 5 * minute) / (30 * minute)) * 30 * minute;
  const expected = formatWall(expectedTime);
  if (!reading.cycle) return { ...reading, expected, status: "missing", delayMinutes: null };
  const actual = cycleMillis(reading.cycle);
  if (actual === null || actual > Math.floor(wall / (30 * minute)) * 30 * minute) return { ...reading, expected, status: "invalid", delayMinutes: null };
  return { ...reading, expected, status: actual < expectedTime ? "late" : "ok", delayMinutes: Math.max(0, Math.floor((wall - actual - 30 * minute) / minute)) };
}
export function transitionCycles(previous: MonitorState, health: CycleHealth[], now: Date) {
  const state: MonitorState = { ...previous }; const events: MonitorEvent[] = [];
  for (const h of health) {
    const incident = previous[h.feed]?.incident;
    if (h.status !== "ok" && !incident) {
      const id = `${h.feed}:${now.toISOString()}`;
      state[h.feed] = { incident: id }; events.push({ id: `${id}:late`, kind: "late", health: h });
    } else if (h.status === "ok" && incident) {
      state[h.feed] = { incident: null }; events.push({ id: `${incident}:recovered`, kind: "recovered", health: h });
    }
  }
  return { state, events };
}
export function monitorMessage(event: MonitorEvent | null, now: Date) {
  if (!event) return `🧪 TESTE • Monitor de ciclos Real Time\n<@=username(wb_lucasy)=>\nEste é um teste de envio do servidor. Não indica uma falha real.\nMonitoramento: filas e agentes, separadamente.\nTolerância: 5 minutos após o horário do ciclo esperado.\nUm alerta por ocorrência e um aviso ao normalizar.\nHorário: ${brazilWallTime(now)} • Brasília\nhttps://eastriverbrasil.com/real-time`;
  const h = event.health; const name = h.feed === "queues" ? "Filas" : "Agentes";
  const title = event.kind === "recovered" ? "✅ CICLO NORMALIZADO" : "⚠️ CICLO NÃO ATUALIZADO";
  const detail = h.status === "missing" ? "Sem ciclo disponível." : h.status === "invalid" ? "Ciclo inválido ou com data futura. Verificar a importação." : event.kind === "late" ? `Atraso desde o primeiro ciclo não recebido: ${h.delayMinutes} min.` : "A base voltou a atender ao ciclo esperado.";
  return `${title} • Real Time / ${name}\n<@=username(wb_lucasy)=>\nCiclo esperado: ${h.expected}\nÚltimo ciclo recebido: ${h.cycle ?? "Sem dados"}\n${detail}\nVerificado: ${brazilWallTime(now)} • Brasília\nhttps://eastriverbrasil.com/real-time`;
}
