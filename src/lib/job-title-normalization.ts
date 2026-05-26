export const AGENT_JOB_TITLE = "Agente";
const agentJobTitleAliases = new Set(["agente", "agent", "moderador de conteudo", "content moderator"]);
const supervisorJobTitleAliases = new Set([
  "supervisor",
  "gestor",
  "coordenador",
  "coordenadora",
  "gerente",
  "manager",
  "management",
  "wfm",
  "admin",
  "administrador",
  "administradora"
]);

export function normalizeJobTitle(value: unknown) {
  const raw = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!raw) return raw;
  if (isAgentJobTitle(raw)) return AGENT_JOB_TITLE;
  return raw;
}

export function isAgentJobTitle(value: unknown) {
  return agentJobTitleAliases.has(normalizeComparableJobTitle(value));
}

export function canBeSupervisorJobTitle(value: unknown) {
  return supervisorJobTitleAliases.has(normalizeComparableJobTitle(value));
}

export function normalizeComparableJobTitle(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
