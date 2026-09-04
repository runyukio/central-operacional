import type { CaptureDivergenceAction } from "@/lib/work-hours-capture-integration-core";

export type CaptureReviewRow = { id: string; revision: string; lob: string; supervisor: string; shift: string };
export type CaptureReviewFilters = { lob: string; supervisor: string; shift: string };
// Registration warnings are informational; they must never enter attendance decisions.
export type CaptureRegistrationWarning = CaptureReviewFilters & {
  id: string; employeeId: string; employeeName: string; wbLogin: string;
  date: string; slot: string; reason: string; code: "MISSING_GO_LIVE" | "INVALID_GO_LIVE";
};
export type CaptureReviewChoices = Record<string, { action: CaptureDivergenceAction; revision: string }>;
export const EMPTY_CAPTURE_REVIEW_FILTERS: CaptureReviewFilters = { lob: "", supervisor: "", shift: "" };

export function filterCaptureReviewRows<T extends CaptureReviewFilters>(rows: T[], filters: CaptureReviewFilters) {
  return rows.filter((row) => (!filters.lob || row.lob === filters.lob)
    && (!filters.supervisor || row.supervisor === filters.supervisor)
    && (!filters.shift || row.shift === filters.shift));
}

export function captureReviewOptions(rows: CaptureReviewFilters[], key: keyof CaptureReviewFilters) {
  return Array.from(new Set(rows.map((row) => row[key]).filter(Boolean))).sort((a, b) => a.localeCompare(b, "pt-BR"));
}

// Always build from the complete selected period, never from the visible slice.
export function captureReviewDecisions(rows: CaptureReviewRow[], choices: CaptureReviewChoices) {
  return rows.flatMap((row) => choices[row.id] ? [{ id: row.id, ...choices[row.id] }] : []);
}
