type PerformanceMetadata = Record<string, string | number | boolean | null | undefined>;

const DEFAULT_THRESHOLD_MS = Number(process.env.PERF_LOG_THRESHOLD_MS ?? 750);
const PERFORMANCE_DEBUG = process.env.PERFORMANCE_DEBUG === "true";

export function logPerformanceMetric(label: string, startedAt: number, metadata: PerformanceMetadata = {}, thresholdMs = DEFAULT_THRESHOLD_MS) {
  const durationMs = Date.now() - startedAt;
  if (!PERFORMANCE_DEBUG && durationMs < thresholdMs) return;
  console.info("[performance]", {
    label,
    durationMs,
    ...metadata
  });
}
