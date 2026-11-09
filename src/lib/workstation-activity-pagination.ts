import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";

export type ActivityTimelineCursor = { at: string; hostname: string; id: string; scope: string };

export function activityTimelineCursorScope(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function encodeActivityTimelineCursor(value: ActivityTimelineCursor) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function decodeActivityTimelineCursor(value: string | null | undefined, scope: string): ActivityTimelineCursor | null {
  if (!value) return null;
  if (value.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Cursor inválido.");
  let parsed: ActivityTimelineCursor;
  try { parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")); }
  catch { throw new Error("Cursor inválido."); }
  if (!parsed || parsed.scope !== scope || typeof parsed.at !== "string" || !Number.isFinite(Date.parse(parsed.at))
    || typeof parsed.hostname !== "string" || parsed.hostname.length > 120
    || typeof parsed.id !== "string" || !parsed.id || parsed.id.length > 200) throw new Error("Cursor inválido para esta consulta.");
  return parsed;
}

/** Merge the complete, ordered intervals before limiting pages. A running end
 * handles nested/overlapping checkpoints, matching the existing JS merger. */
export function activityTimelinePageSql(pageSize: number, cursor: ActivityTimelineCursor | null) {
  const after = cursor ? Prisma.sql`WHERE ("sourceStartedAt", "hostname", "id") >
    (${new Date(cursor.at)}::timestamp, ${cursor.hostname}::text, ${cursor.id}::text)` : Prisma.empty;
  return Prisma.sql`, timeline_ordered AS (
    SELECT *, jsonb_build_array("agentKey", "sourceType", COALESCE("applicationName", ''), COALESCE("domain", '')) AS "contextKey",
      LAG(jsonb_build_array("agentKey", "sourceType", COALESCE("applicationName", ''), COALESCE("domain", '')))
        OVER (ORDER BY "sourceStartedAt", "hostname", "id") AS "previousContext"
    FROM filtered_activity
  ), timeline_contexts AS (
    SELECT *, SUM(CASE WHEN "previousContext" IS DISTINCT FROM "contextKey" THEN 1 ELSE 0 END)
      OVER (ORDER BY "sourceStartedAt", "hostname", "id" ROWS UNBOUNDED PRECEDING) AS "contextGroup"
    FROM timeline_ordered
  ), timeline_ends AS (
    SELECT *, MAX("endedAt") OVER (PARTITION BY "contextGroup" ORDER BY "sourceStartedAt", "hostname", "id"
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS "previousEnd"
    FROM timeline_contexts
  ), timeline_grouped AS (
    SELECT *, SUM(CASE WHEN "previousEnd" IS NULL OR "startedAt" > "previousEnd" + INTERVAL '15 seconds' THEN 1 ELSE 0 END)
      OVER (ORDER BY "sourceStartedAt", "hostname", "id" ROWS UNBOUNDED PRECEDING) AS "mergeGroup"
    FROM timeline_ends
  ), timeline_merged AS (
    SELECT DISTINCT ON ("mergeGroup") "sourceStartedAt", "hostname", "id",
      (to_jsonb(grouped) - 'contextKey' - 'previousContext' - 'contextGroup' - 'previousEnd' - 'mergeGroup')
      || jsonb_build_object('endedAt', MAX("endedAt") OVER (PARTITION BY "mergeGroup"),
        'capturedAt', MAX("capturedAt") OVER (PARTITION BY "mergeGroup"),
        'mergedSourceRecords', COUNT(*) OVER (PARTITION BY "mergeGroup")) AS payload
    FROM timeline_grouped grouped
    ORDER BY "mergeGroup", "sourceStartedAt", "hostname", "id"
  ), timeline AS (
    SELECT * FROM timeline_merged ${after}
    ORDER BY "sourceStartedAt", "hostname", "id" LIMIT ${pageSize + 1}
  )`;
}
