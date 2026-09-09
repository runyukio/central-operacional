import { shiftCategoryName } from "@/lib/shift-display";
export type CoverageSlotState = "pending" | "covered" | "ended_deficit" | "invalid_shift";
export type SpaceCoverageRow = {
  id: string; date: string; lobId: string; lob: string; shiftId: string; shift: string;
  required: number; available: number; deficit: number; state: CoverageSlotState; endsAt: string | null;
  supervisors: Array<{ id: string; name: string }>;
  notes: Array<{ id: string; supervisorId: string; supervisor: string; actor: string; createdAt: string; text: string }>;
};
export type SpaceCoverage = { period: { startDate: string; endDate: string }; today: string; data: SpaceCoverageRow[]; pending: number; warnings: string[]; canRespond: boolean };
export function coverageSlotEnd(date: string, startsAt: string, endsAt: string): Date | null {
  const valid = (time: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
  if (!valid(startsAt) || !valid(endsAt)) return null;
  const end = new Date(`${date}T${endsAt}:00-03:00`);
  if (endsAt <= startsAt) end.setTime(+end + 86400000);
  return Number.isFinite(+end) ? end : null;
}
export function coverageSlotState(required: number, available: number, end: Date | null, now: Date): CoverageSlotState {
  if (available >= required) return "covered";
  if (!end) return "invalid_shift";
  return now >= end ? "ended_deficit" : "pending";
}
export function coverageSupervisorMatches(supervisor: { lobId: string; lob: string; shift: string }, slot: { lobId: string; lob: string; shift: string }) {
  const lobMatches = supervisor.lobId === slot.lobId || (supervisor.lob === "TNS" && ["VIDEO", "COMMENTS"].includes(slot.lob));
  return lobMatches && shiftCategoryName(supervisor.shift) === shiftCategoryName(slot.shift);
}
