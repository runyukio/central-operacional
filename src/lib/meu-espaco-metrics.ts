import { calculateAbsenceRate } from "@/lib/attendance-calculation";
import type { SpaceMetric } from "@/lib/meu-espaco-contract";
import { cecFrtMetrics, emptyCecFrt, type CecFrtCounts } from "@/lib/cec-frt";
import { assessSpaceTarget, spaceTargets, type SpaceWeights } from "@/lib/meu-espaco-targets";

export function spaceLobFamily(lob: string) {
  const value = lob.trim().toUpperCase();
  if (["ADS", "PROJECT"].includes(value)) return "ADS";
  if (["VIDEO", "COMMENTS", "TNS"].includes(value)) return "TNS";
  return value;
}
export type MetricAccumulator = { output: number; materialOutput: number; materialDays: Set<string>; days: Set<string>; agentDays: Set<string>; ahtSubmit: number; duration: number; correct: number; samples: number; planned: number; absences: number;
  urActualHours: number; urShiftHours: number;
  latencyMinutesSum: number; latencySubmits: number; commentsLatencyMinutesSum: number; commentsLatencySubmits: number; cecFrt: CecFrtCounts };
export function emptySpaceMetric(): MetricAccumulator {
  return { output: 0, materialOutput: 0, materialDays: new Set(), days: new Set(), agentDays: new Set(), ahtSubmit: 0, duration: 0, correct: 0, samples: 0, planned: 0, absences: 0,
    urActualHours: 0, urShiftHours: 0, latencyMinutesSum: 0, latencySubmits: 0, commentsLatencyMinutesSum: 0, commentsLatencySubmits: 0, cecFrt: emptyCecFrt() };
}
export function spaceLatencyQueueKind(queue: { lob: string; slaTargetMinutes: number | null }) {
  if (queue.lob === "ADS" || (queue.lob === "VIDEO" && queue.slaTargetMinutes === 15)) return "primary";
  if (queue.lob === "COMMENTS") return "comments";
  return null;
}
const round = (n: number) => Math.round(n * 100) / 100;
export function finishSpaceMetric(value: MetricAccumulator, lob: string): SpaceMetric {
  const weights: SpaceWeights = {
    ur: { numerator: value.urActualHours, denominator: value.urShiftHours },
    quality: { numerator: value.correct, denominator: value.samples },
    abs: { numerator: value.absences, denominator: value.planned },
    aht: { numerator: value.duration, denominator: value.ahtSubmit },
    latency: { numerator: value.latencyMinutesSum, denominator: value.latencySubmits },
    commentsLatency: { numerator: value.commentsLatencyMinutesSum, denominator: value.commentsLatencySubmits },
    materialDaily: { numerator: value.materialOutput, denominator: value.materialDays.size },
    cpd: { numerator: value.output, denominator: value.agentDays.size },
    normalFrt: { numerator: value.cecFrt.normalTotal - value.cecFrt.normalOver, denominator: value.cecFrt.normalTotal },
    urgentFrt: { numerator: value.cecFrt.urgentTotal - value.cecFrt.urgentOver, denominator: value.cecFrt.urgentTotal }
  };
  return { weights, targets: spaceTargets(lob).map((target) => assessSpaceTarget(target, weights[target.id])), ...(lob === "CEC" ? { cecFrt: cecFrtMetrics(value.cecFrt) } : {}), production: value.days.size ? value.output : null,
    dailyTeam: value.days.size ? round(value.output / value.days.size) : null,
    dailyIndividual: value.agentDays.size ? round(value.output / value.agentDays.size) : null,
    ahtSeconds: lob !== "CEC" && value.ahtSubmit > 0 ? round(value.duration / value.ahtSubmit) : null,
    cpd: lob === "CEC" && value.agentDays.size ? round(value.output / value.agentDays.size) : null,
    latencyMinutes: lob !== "CEC" && value.latencySubmits > 0 ? round(value.latencyMinutesSum / value.latencySubmits) : null,
    commentsLatencyMinutes: lob === "TNS" && value.commentsLatencySubmits > 0 ? round(value.commentsLatencyMinutesSum / value.commentsLatencySubmits) : null,
    latencySubmits: value.latencySubmits, commentsLatencySubmits: value.commentsLatencySubmits,
    quality: value.samples ? round(value.correct / value.samples * 100) : null,
    ur: value.urShiftHours > 0 ? value.urActualHours / value.urShiftHours * 100 : null,
    abs: value.planned ? calculateAbsenceRate(value.planned, value.absences) : null,
    productionDays: value.days.size, agentDays: value.agentDays.size, qualitySamples: value.samples, planned: value.planned, absences: value.absences };
}
