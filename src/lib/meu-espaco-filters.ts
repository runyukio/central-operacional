import { createHash } from "node:crypto";
import { MeuEspacoError } from "@/lib/meu-espaco-access";
import type { PendingKind, SpacePeriod } from "@/lib/meu-espaco-contract";

export function spaceToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function spaceDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new MeuEspacoError("Informe uma data válida.");
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(+parsed) || parsed.toISOString().slice(0, 10) !== value) throw new MeuEspacoError("Informe uma data válida.");
  return parsed;
}
export function spacePeriod(query: URLSearchParams, pending = false, today = spaceToday()): SpacePeriod {
  const startDate = query.get("startDate") || (pending ? "1900-01-01" : `${today.slice(0, 7)}-01`);
  const endDate = query.get("endDate") || today;
  const start = spaceDate(startDate), end = spaceDate(endDate);
  if (start > end || endDate > today) throw new MeuEspacoError("Selecione um período válido, até hoje.");
  if (!pending && (+end - +start) / 86_400_000 > 365) throw new MeuEspacoError("Consulte até 366 dias por vez.");
  return { startDate, endDate };
}
export function spacePendingFilters(query: URLSearchParams) {
  const kind = query.get("kind") || "all", state = query.get("state") || "pending";
  if (!["all", "absence", "hours"].includes(kind) || !["pending", "answered"].includes(state)) throw new MeuEspacoError("Filtro de pendências inválido.");
  return { ...spacePeriod(query, true), kind, state, search: (query.get("search") || "").trim().slice(0, 120), lob: (query.get("lob") || "").trim().slice(0, 80) };
}
export type PendingCursor = { date: string; kind: PendingKind; id: string; fingerprint: string };
export function pendingFingerprint(scope: string, filters: ReturnType<typeof spacePendingFilters>) {
  return createHash("sha256").update(JSON.stringify([scope, filters])).digest("hex").slice(0, 24);
}
export function encodeSpaceCursor(value: PendingCursor) { return Buffer.from(JSON.stringify(value)).toString("base64url"); }
export function decodeSpaceCursor(value: string | null, fingerprint: string): PendingCursor | null {
  if (!value) return null;
  try {
    if (value.length > 1500) throw new Error();
    const row = JSON.parse(Buffer.from(value, "base64url").toString());
    spaceDate(row.date);
    if (!["absence", "hours"].includes(row.kind) || typeof row.id !== "string" || !row.id || row.id.length > 160 || row.fingerprint !== fingerprint) throw new Error();
    return row;
  } catch { throw new MeuEspacoError("A paginação não corresponde aos filtros. Atualize a lista."); }
}
