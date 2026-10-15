export type CycleFeed = "queues" | "agents";
export type CycleReading = { feed: CycleFeed; cycle: string | null; importedAt: string | null };
export type CycleHealth = CycleReading & { expected: string; status: "ok" | "late" | "missing" | "invalid"; delayMinutes: number | null };
export type MonitorState = Partial<Record<CycleFeed, { incident: string | null }>>;
export type MonitorEvent = { id: string; kind: "late" | "recovered"; health: CycleHealth };
const minute = 60_000;
const staleAfterMinutes = 20;

export function brazilWallTime(now: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}
export function evaluateCycle(reading: CycleReading, now: Date): CycleHealth {
  const expected = brazilWallTime(new Date(now.getTime() - staleAfterMinutes * minute));
  if (!reading.importedAt) return { ...reading, expected, status: "missing", delayMinutes: null };
  const importedAt = Date.parse(reading.importedAt);
  const elapsed = now.getTime() - importedAt;
  if (!Number.isFinite(importedAt) || elapsed < 0) return { ...reading, expected, status: "invalid", delayMinutes: null };
  return { ...reading, expected, status: elapsed > staleAfterMinutes * minute ? "late" : "ok", delayMinutes: Math.floor(elapsed / minute) };
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
  if (!event) return `🧪 TESTE • Monitor de atualizações Real Time\n<@=username(wb_lucasy)=>\nEste é um teste de envio do servidor. Não indica uma falha real.\nMonitoramento: filas e agentes, separadamente.\nAlerta: mais de ${staleAfterMinutes} minutos sem uma importação concluída.\nUm alerta por ocorrência e um aviso ao normalizar.\nHorário: ${brazilWallTime(now)} • Brasília\nhttps://eastriverbrasil.com/real-time`;
  const h = event.health; const name = h.feed === "queues" ? "Filas" : "Agentes";
  const title = event.kind === "recovered" ? "✅ ATUALIZAÇÃO NORMALIZADA" : "⚠️ BASE SEM ATUALIZAÇÃO";
  const detail = h.status === "missing" ? "Nenhuma importação concluída disponível." : h.status === "invalid" ? "Horário de importação inválido ou futuro. Verificar a importação." : event.kind === "late" ? `Sem atualização há mais de ${staleAfterMinutes} minutos (${h.delayMinutes} min desde a última importação).` : "A base voltou a receber atualização dentro do limite de 20 minutos.";
  const lastUpdate = h.importedAt && h.status !== "invalid" ? brazilWallTime(new Date(h.importedAt)) : "Indisponível";
  return `${title} • Real Time / ${name}\n<@=username(wb_lucasy)=>\nÚltima atualização: ${lastUpdate}\nÚltimo ciclo recebido: ${h.cycle ?? "Sem dados"}\n${detail}\nVerificado: ${brazilWallTime(now)} • Brasília\nhttps://eastriverbrasil.com/real-time`;
}
