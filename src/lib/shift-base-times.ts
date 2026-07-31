import { shiftCategoryName } from "@/lib/shift-display";

export const approvedShiftBaseTimes = {
  Manhã: { startsAt: "08:00", endsAt: "17:00" },
  Tarde: { startsAt: "14:00", endsAt: "23:00" },
  Noite: { startsAt: "23:00", endsAt: "08:00" },
  Folga: { startsAt: "", endsAt: "" }
} as const;

export type ApprovedShiftBaseTime = (typeof approvedShiftBaseTimes)[keyof typeof approvedShiftBaseTimes];

/**
 * Returns the operational base hours for a shift selected in the schedule or
 * in an approved shift-change request.  The category resolver also supports
 * labels such as "Manhã (08:00 - 17:00)".
 */
export function baseTimesForShift(value?: string | null): ApprovedShiftBaseTime | null {
  const category = shiftCategoryName(value);
  return category in approvedShiftBaseTimes
    ? approvedShiftBaseTimes[category as keyof typeof approvedShiftBaseTimes]
    : null;
}
