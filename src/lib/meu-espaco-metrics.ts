import { calculateAbsenceRate } from "@/lib/attendance-calculation";
import type { SpaceMetric } from "@/lib/meu-espaco-contract";

export function spaceLobFamily(lob: string) {
  const value = lob.trim().toUpperCase();
  if (["ADS", "PROJECT"].includes(value)) return "ADS";
  if (["VIDEO", "COMMENTS", "TNS"].includes(value)) return "TNS";
  return value;
}
export type MetricAccumulator = { output: number; days: Set<string>; agentDays: Set<string>; ahtSubmit: number; duration: number; correct: number; samples: number; planned: number; absences: number };
export function emptySpaceMetric(): MetricAccumulator {
  return { output: 0, days: new Set(), agentDays: new Set(), ahtSubmit: 0, duration: 0, correct: 0, samples: 0, planned: 0, absences: 0 };
}
const round = (n: number) => Math.round(n * 100) / 100;
export function finishSpaceMetric(value: MetricAccumulator, lob: string): SpaceMetric {
  return { production: value.days.size ? value.output : null,
    dailyTeam: value.days.size ? round(value.output / value.days.size) : null,
    dailyIndividual: value.agentDays.size ? round(value.output / value.agentDays.size) : null,
    ahtSeconds: lob !== "CEC" && value.ahtSubmit > 0 ? round(value.duration / value.ahtSubmit) : null,
    cpd: lob === "CEC" && value.agentDays.size ? round(value.output / value.agentDays.size) : null,
    quality: value.samples ? round(value.correct / value.samples * 100) : null,
    abs: value.planned ? calculateAbsenceRate(value.planned, value.absences) : null,
    productionDays: value.days.size, agentDays: value.agentDays.size, qualitySamples: value.samples, planned: value.planned, absences: value.absences };
}
