const realtimeActiveEmployeeStatuses = new Set(["ativo", "active", "nesting"]);

export function isRealtimeActiveEmployeeStatus(value: unknown) {
  return realtimeActiveEmployeeStatuses.has(normalizeEmployeeStatus(value));
}

export function matchesRealtimeEmployeeStatus(value: unknown, filter: unknown) {
  const normalizedFilter = normalizeEmployeeStatus(filter);
  if (normalizedFilter === "ativo") return isRealtimeActiveEmployeeStatus(value);
  return normalizeEmployeeStatus(value) === normalizedFilter;
}

function normalizeEmployeeStatus(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("pt-BR");
}
