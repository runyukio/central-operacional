import { z } from "zod";

export const activitySourceTypes = ["WEB", "APP", "IDLE", "LOCKED", "PRIVATE", "UNKNOWN"] as const;
export type ActivitySourceTypeV2 = (typeof activitySourceTypes)[number];

const isoDate = z.string().datetime({ offset: true });
const boundedString = (max: number) => z.string().trim().min(1).max(max);
const optionalBoundedString = (max: number) => z.string().trim().max(max).optional().default("");

export const enrollmentRequestSchema = z.object({
  enrollmentCode: boundedString(256),
  hostname: boundedString(120),
  windowsUser: boundedString(120),
  wbLogin: optionalBoundedString(120),
  agentVersion: boundedString(40)
}).strict();

export const deploymentTicketRequestSchema = z.object({
  deploymentCode: z.string().regex(/^[A-Za-z0-9_-]{32}$/),
  hostname: boundedString(120),
  windowsUser: boundedString(120)
}).strict();

export const heartbeatPayloadSchema = z.object({
  schemaVersion: z.literal(2),
  agentVersion: boundedString(40),
  capturedAt: isoDate,
  hostname: boundedString(120),
  windowsUser: boundedString(120),
  wbLogin: optionalBoundedString(120),
  sessionState: z.enum(["ACTIVE", "IDLE", "LOCKED", "OFFLINE"]),
  idleSeconds: z.number().int().min(0).max(86_400),
  activeProcessName: optionalBoundedString(120),
  currentType: z.enum(activitySourceTypes).optional(),
  currentDomain: optionalBoundedString(253),
  detectionMethod: optionalBoundedString(80)
}).strict().superRefine((value, ctx) => {
  if (value.currentType === "WEB" && !normalizeDomain(value.currentDomain)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["currentDomain"], message: "WEB requires a valid domain." });
  }
  if (value.currentType !== "WEB" && value.currentDomain) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["currentDomain"], message: "Only WEB heartbeat may contain a domain." });
  }
});

export const activityRecordSchema = z.object({
  eventId: z.string().trim().min(16).max(80).regex(/^[a-zA-Z0-9._:-]+$/),
  sourceType: z.enum(activitySourceTypes),
  applicationName: optionalBoundedString(120),
  domain: optionalBoundedString(253),
  detectionMethod: optionalBoundedString(80),
  startedAt: isoDate,
  endedAt: isoDate,
  durationSeconds: z.number().int().min(1).max(86_400)
}).strict().superRefine((value, ctx) => {
  const start = new Date(value.startedAt);
  const end = new Date(value.endedAt);
  if (!(end > start)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endedAt"], message: "endedAt must be after startedAt." });
  }
  const computed = Math.max(1, Math.round((end.getTime() - start.getTime()) / 1_000));
  if (Math.abs(computed - value.durationSeconds) > 2) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["durationSeconds"], message: "durationSeconds does not match interval." });
  }
  if (value.sourceType === "WEB" && !normalizeDomain(value.domain)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["domain"], message: "WEB requires a valid domain." });
  }
  if (value.sourceType !== "WEB" && value.domain) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["domain"], message: "Only WEB records may contain a domain." });
  }
});

export const activityPayloadSchema = z.object({
  schemaVersion: z.literal(2),
  agentVersion: boundedString(40),
  capturedAt: isoDate,
  hostname: boundedString(120),
  windowsUser: boundedString(120),
  wbLogin: optionalBoundedString(120),
  records: z.array(activityRecordSchema).min(1).max(500)
}).strict();

export type EnrollmentRequestV2 = z.infer<typeof enrollmentRequestSchema>;
export type HeartbeatPayloadV2 = z.infer<typeof heartbeatPayloadSchema>;
export type ActivityPayloadV2 = z.infer<typeof activityPayloadSchema>;

export function normalizeDomain(value: unknown) {
  const candidate = String(value ?? "").trim().toLowerCase();
  if (!candidate) return "";
  let parsed: URL;
  try {
    parsed = new URL(candidate.includes("://") ? candidate : `https://${candidate}`);
  } catch {
    return "";
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return "";
  const host = parsed.hostname.replace(/^www\./, "").replace(/\.$/, "");
  if (!host.includes(".") || host.length > 253 || !/^[a-z0-9.-]+$/.test(host)) return "";
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return "";
  const labels = host.split(".");
  if (labels.some((label) => !label || label.length > 63 || label.startsWith("-") || label.endsWith("-"))) return "";
  return host;
}
