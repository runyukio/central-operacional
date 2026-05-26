export const AGENT_JOB_TITLE = "Agente";

export function normalizeJobTitle(value: unknown) {
  const raw = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!raw) return raw;
  const comparable = normalizeComparableJobTitle(raw);
  if (comparable === "moderador de conteudo") return AGENT_JOB_TITLE;
  return raw;
}

export function normalizeComparableJobTitle(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
