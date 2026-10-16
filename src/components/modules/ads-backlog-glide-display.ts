import type { AdsBacklogGlideResponse } from "@/lib/ads-backlog-glide-service";

export const GLIDE_REFRESH_MS = 60 * 60 * 1000;
export const GLIDE_STALE_MINUTES = 90;
type GlideFreshness = Pick<AdsBacklogGlideResponse, "state"> & { sources: Pick<AdsBacklogGlideResponse["sources"], "snapshotAgeMinutes" | "cycleAgeMinutes"> };
type GlideClearance = GlideFreshness & Pick<AdsBacklogGlideResponse, "clearanceAt">;

/** Operational wall-clock timestamps already encode Brasil time; do not subtract three hours again. */
export function glideTimestamp(value: number | string | null | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (!value) return null;
  const match = value.match(/^(\d{4})[-/](\d{2})[-/](\d{2})[T_\s-]+(\d{2})[:-](\d{2})(?::(\d{2})(?:\.\d{1,3})?)?Z?$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second = "00"] = match;
  const timestamp = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  const iso = new Date(timestamp).toISOString();
  return iso.slice(0, 19) === `${year}-${month}-${day}T${hour}:${minute}:${second}` ? timestamp : null;
}

export function glideClock(value: number | string | null | undefined, includeDate = true) {
  const timestamp = glideTimestamp(value);
  if (timestamp === null) return "Sem dados";
  const iso = new Date(timestamp).toISOString();
  return `${includeDate ? `${iso.slice(8, 10)}/${iso.slice(5, 7)} · ` : ""}${iso.slice(11, 16)}`;
}

export function glideIsStale(data: GlideFreshness, elapsedMs = 0) {
  if (data.state === "stale") return true;
  const ages = [data.sources.snapshotAgeMinutes, data.sources.cycleAgeMinutes];
  return ages.some(age => age !== null && age + Math.max(0, elapsedMs) / 60000 > GLIDE_STALE_MINUTES);
}

/** An old successful result may remain inspectable after a failed refresh, but never supplies a current ETA. */
export function glideClearanceLabel(data: GlideClearance, elapsedMs = 0, refreshError = false) {
  if (refreshError) return "Atualização pendente";
  if (glideIsStale(data, elapsedMs)) return "Aguardando dados atuais";
  if (data.state === "incomplete") return "Sem projeção completa";
  if (data.state === "no-clearance" || data.clearanceAt === null) return "Não limpa no horizonte";
  return glideClock(data.clearanceAt);
}
