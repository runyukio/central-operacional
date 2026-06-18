const queueDictionary: Record<string, string> = {};

export function normalizeQueueId(value?: string | null) {
  const normalized = String(value ?? "").trim();
  return normalized || "";
}

export function getQueueNameById(queueId?: string | null, fallbackName?: string | null) {
  const normalizedQueueId = normalizeQueueId(queueId);
  if (!normalizedQueueId) return "Sem Fila ID";
  const mappedName = queueDictionary[normalizedQueueId] ?? String(fallbackName ?? "").trim();
  return mappedName || "Fila não mapeada";
}
