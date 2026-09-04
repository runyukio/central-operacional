import { z } from "zod";
import { resolveCapturePeriod, type CapturePeriodInput } from "@/lib/work-hours-capture-period";

// API validation stays out of the shared client-side date helpers.
export const capturePeriodShape = {
  shiftDate: z.string().optional(), startDate: z.string().optional(), endDate: z.string().optional()
};

export function validateCapturePeriod(input: CapturePeriodInput, context: z.RefinementCtx) {
  const result = resolveCapturePeriod(input);
  if ("error" in result) context.addIssue({ code: z.ZodIssueCode.custom, path: ["startDate"], message: result.error });
}
