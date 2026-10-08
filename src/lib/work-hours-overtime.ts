import { createHash } from "node:crypto";
import { CAPTURE_OVERTIME_THRESHOLD_MS } from "@/lib/work-hours-capture-integration-core";

export const CAPTURE_HOURS_LIMIT = 8;
export const CAPTURE_HOURS_LIMIT_MS = CAPTURE_HOURS_LIMIT * 3_600_000;
export type OvertimeStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
export type OvertimeSource = {
  reconciliationKey: string; scheduleId: string; plannedStart: string | null; plannedEnd: string | null;
  sourceDurationMs: number; operationalMs: number; rule: string; ruleLabel: string; classification: string;
};

// The attendance status is intentionally excluded: importing presence changes it.
export function overtimeSourceFingerprint(source: OvertimeSource) {
  return createHash("sha256").update(JSON.stringify([1, source.reconciliationKey, source.scheduleId,
    source.plannedStart, source.plannedEnd, source.sourceDurationMs, source.operationalMs,
    source.rule, source.ruleLabel, source.classification])).digest("hex");
}

export function captureOvertimeOutcome(source: OvertimeSource, previous?: { sourceFingerprint: string; status: string } | null) {
  const sourceFingerprint = overtimeSourceFingerprint(source);
  const calculatedHours = source.operationalMs / 3_600_000;
  const sameSource = previous?.sourceFingerprint === sourceFingerprint && previous.status !== "CANCELLED";
  // Keep completed decisions for the identical capture when the tolerance changes.
  const reviewed = sameSource && (previous?.status === "APPROVED" || previous?.status === "REJECTED");
  // Ten minutes are tolerated; the standard payable day remains eight hours.
  const excessHours = source.operationalMs > CAPTURE_OVERTIME_THRESHOLD_MS || reviewed
    ? Math.max(0, calculatedHours - CAPTURE_HOURS_LIMIT) : 0;
  const status: OvertimeStatus = reviewed ? previous.status as "APPROVED" | "REJECTED" : excessHours > 0 ? "PENDING" : "CANCELLED";
  return { sourceFingerprint, calculatedHours, excessHours, status, sameSource,
    effectiveHours: status === "APPROVED" ? calculatedHours : Math.min(calculatedHours, CAPTURE_HOURS_LIMIT),
    validationHours: status === "PENDING" ? excessHours : 0 };
}

export function overtimeStatusLabel(status?: string | null) {
  return ({ PENDING: "Horas em validação", APPROVED: "Excedente aprovado", REJECTED: "Excedente recusado", CANCELLED: "Revisão cancelada" } as Record<string, string>)[status ?? ""] ?? "Sem revisão";
}

export function canReviewOvertime(role: string, actorProfileId: string | null | undefined, supervisorId: string | null) {
  return role === "ADMIN" || role === "WFM" || (role === "SUPERVISOR" && Boolean(actorProfileId) && actorProfileId === supervisorId);
}
