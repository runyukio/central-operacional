/** CEC FRT is an SLA percentage by ticket creation day, not an average duration. */
export type CecPriority = "NORMAL" | "P0" | "HM";
export type CecFrtRow = { day: string; wbLogin: string; priority: CecPriority; total: number; over240: number; over1440: number };
export type CecFrtCounts = { normalTotal: number; normalOver: number; urgentTotal: number; urgentOver: number };
export const emptyCecFrt = (): CecFrtCounts => ({ normalTotal: 0, normalOver: 0, urgentTotal: 0, urgentOver: 0 });
export function cecFrtPercent(over: number, total: number) {
  return total > 0 ? Math.round((1 - over / total) * 10000) / 100 : null;
}
export function cecFrtMetrics(counts: CecFrtCounts) {
  return { ...counts, normalSla: cecFrtPercent(counts.normalOver, counts.normalTotal), urgentSla: cecFrtPercent(counts.urgentOver, counts.urgentTotal) };
}
export function addCecFrt(target: CecFrtCounts, value: CecFrtCounts) {
  target.normalTotal += value.normalTotal; target.normalOver += value.normalOver;
  target.urgentTotal += value.urgentTotal; target.urgentOver += value.urgentOver;
}
export function cecFrtLogin(value: unknown) {
  const text = String(value ?? "").trim().toLowerCase();
  // The source identifies partners by the email prefix, including historical domain typos.
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text) ? text.split("@")[0] : text;
}
export function cecFrtPriority(value: unknown): CecPriority | null {
  const key = String(value ?? "").trim().toUpperCase();
  return key === "NORMAL" ? "NORMAL" : ["PO", "P0"].includes(key) ? "P0" : key === "HM" ? "HM" : null;
}
export function cecFrtDay(value: unknown): string | null {
  let text = String(value ?? "").trim();
  if (value instanceof Date) text = Number.isFinite(+value) ? value.toISOString().slice(0, 10) : "";
  if (typeof value === "number") {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000);
    text = Number.isFinite(+date) ? date.toISOString().slice(0, 10) : "";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === text ? text : null;
}
const header = (key: string) => key.trim().toLowerCase().replace(/\s+/g, "").replace(/\([^)]*\)/g, "");
const required = ["ticket_base_created_at", "ticket_agent_email", "merge_group_name_group_priority", "first_reply_time_over_240_count", "first_reply_time_over_0_count", "first_reply_time_over_1440_count"];
function counter(value: unknown) {
  if (value === null || value === undefined || String(value).trim() === "" || typeof value === "boolean") return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 && n <= 2147483647 ? n : null;
}
export function parseCecFrtRows(raw: Record<string, unknown>[]) {
  if (!raw.length) throw new Error("A base CEC SLA/FRT está vazia.");
  const columns = new Map<string, string>();
  for (const key of Object.keys(raw[0])) {
    const normalized = header(key);
    if (required.includes(normalized) && columns.has(normalized)) throw new Error(`Colunas repetidas na base CEC SLA/FRT: ${normalized}.`);
    columns.set(normalized, key);
  }
  const missing = required.filter((key) => !columns.has(key));
  if (missing.length) throw new Error(`Colunas ausentes na base CEC SLA/FRT: ${missing.join(", ")}.`);
  const rows: CecFrtRow[] = [], errors: string[] = [], seen = new Set<string>();
  let errorCount = 0;
  for (const [index, row] of raw.entries()) {
    const get = (key: string) => row[columns.get(key)!];
    const day = cecFrtDay(get(required[0])), wbLogin = cecFrtLogin(get(required[1])), priority = cecFrtPriority(get(required[2]));
    const over240 = counter(get(required[3])), total = counter(get(required[4])), over1440 = counter(get(required[5]));
    const reasons: string[] = [];
    if (!day) reasons.push("data de criação inválida");
    if (!/^[a-z0-9_.-]+$/.test(wbLogin)) reasons.push("e-mail/login WB inválido (use um e-mail completo ou o login)");
    if (!priority) reasons.push("prioridade deve ser Normal, P0/PO ou HM");
    if (over240 === null || total === null || over1440 === null) reasons.push("contadores devem ser inteiros não negativos, sem campos vazios");
    else if (over1440 > over240 || over240 > total) reasons.push("contadores inconsistentes: >1440 deve ser ≤ >240 e ≤ total >0");
    const key = `${day}|${wbLogin}|${priority}`;
    if (seen.has(key)) reasons.push("data + WB + prioridade repetidos; consolide a base antes de enviar");
    seen.add(key);
    if (reasons.length) { errorCount++; if (errors.length < 20) errors.push(`Linha ${index + 2}: ${reasons.join("; ")}.`); }
    else rows.push({ day: day!, wbLogin, priority: priority!, total: total!, over240: over240!, over1440: over1440! });
  }
  return { rows, errors, errorCount };
}

export type CecFrtMetric = ReturnType<typeof cecFrtMetrics>;
export type CecFrtDashboard = {
  period: { startDate: string; endDate: string }; view: "daily" | "weekly" | "monthly"; canImport: boolean;
  lastImport: { fileName: string; importedAt: string } | null;
  dataRange: { startDate: string; endDate: string } | null;
  summary: CecFrtMetric; output: number | null; cpd: number | null; agentDays: number;
  coverage: { rows: number; unmatchedRows: number; latestDay: string | null; latestCpdDay: string | null };
  trend: Array<{ period: string; output: number | null; cpd: number | null } & CecFrtMetric>;
  agents: Array<{ wbLogin: string; name: string; supervisor: string; skill: string; linked: boolean; output: number | null; cpd: number | null } & CecFrtMetric>;
  supervisors: Array<{ id: string; name: string } & CecFrtMetric>;
};
