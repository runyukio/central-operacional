import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { activityPayloadSchema, normalizeDomain } from "@/lib/realtime-hours-v2/contract";
import { authenticateDeviceRequest } from "@/lib/realtime-hours-v2/device-auth";
import { dateWithinWindow, parseJsonText, readRequestTextWithLimit } from "@/lib/realtime-hours-v2/request";

export const dynamic = "force-dynamic";
const maxBodyBytes = 512 * 1024;

export async function POST(request: Request) {
  const bodyResult = await readRequestTextWithLimit(request, maxBodyBytes);
  if (!bodyResult.ok) return NextResponse.json({ success: false, error: bodyResult.error }, { status: bodyResult.status });

  const auth = await authenticateDeviceRequest(request, bodyResult.text);
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

  const json = parseJsonText(bodyResult.text);
  if (!json.ok) return NextResponse.json({ success: false, error: json.error }, { status: json.status });

  const parsed = activityPayloadSchema.safeParse(json.value);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Payload inválido.", details: parsed.error.issues }, { status: 400 });
  }
  if (!dateWithinWindow(parsed.data.capturedAt, { futureMs: 5 * 60_000, pastMs: 14 * 24 * 60 * 60_000 })) {
    return NextResponse.json({ success: false, error: "capturedAt fora da janela permitida." }, { status: 400 });
  }
  const invalidInterval = parsed.data.records.find((record) => (
    !dateWithinWindow(record.startedAt, { futureMs: 5 * 60_000, pastMs: 14 * 24 * 60 * 60_000 })
    || !dateWithinWindow(record.endedAt, { futureMs: 5 * 60_000, pastMs: 14 * 24 * 60 * 60_000 })
  ));
  if (invalidInterval) {
    return NextResponse.json({ success: false, error: "Intervalo fora da janela permitida." }, { status: 400 });
  }

  const resolvedWbLogin = parsed.data.wbLogin || auth.device.wbLogin || null;
  const records = parsed.data.records.map((record) => ({
    ...record,
    id: randomUUID(),
    domain: record.sourceType === "WEB" ? normalizeDomain(record.domain) : null,
    startedAt: new Date(record.startedAt),
    endedAt: new Date(record.endedAt)
  }));
  const values = records.map((record) => Prisma.sql`(
    ${record.id}, ${record.eventId}, ${auth.device.id}, ${auth.device.employeeId}, ${resolvedWbLogin},
    ${record.sourceType}, ${record.applicationName || null}, ${record.domain},
    ${record.detectionMethod || null}, ${record.startedAt}, ${record.endedAt},
    ${record.durationSeconds}, ${parsed.data.agentVersion}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  )`);
  const capturedAt = new Date(parsed.data.capturedAt);

  const affected = await prisma.$transaction(async (tx) => {
    const count = await tx.$executeRaw(Prisma.sql`
      INSERT INTO "WorkstationActivitySegmentV2" (
        "id", "eventId", "deviceId", "employeeId", "wbLogin", "sourceType", "applicationName", "domain",
        "detectionMethod", "startedAt", "endedAt", "durationSeconds", "agentVersion", "createdAt", "updatedAt"
      ) VALUES ${Prisma.join(values)}
      ON CONFLICT ("deviceId", "eventId") DO UPDATE SET
        "endedAt" = GREATEST("WorkstationActivitySegmentV2"."endedAt", EXCLUDED."endedAt"),
        "durationSeconds" = GREATEST("WorkstationActivitySegmentV2"."durationSeconds", EXCLUDED."durationSeconds"),
        "employeeId" = COALESCE(EXCLUDED."employeeId", "WorkstationActivitySegmentV2"."employeeId"),
        "wbLogin" = COALESCE(EXCLUDED."wbLogin", "WorkstationActivitySegmentV2"."wbLogin"),
        "domain" = COALESCE(EXCLUDED."domain", "WorkstationActivitySegmentV2"."domain"),
        "applicationName" = COALESCE(EXCLUDED."applicationName", "WorkstationActivitySegmentV2"."applicationName"),
        "detectionMethod" = COALESCE(EXCLUDED."detectionMethod", "WorkstationActivitySegmentV2"."detectionMethod"),
        "agentVersion" = EXCLUDED."agentVersion",
        "updatedAt" = CURRENT_TIMESTAMP
    `);
    await tx.$executeRaw(Prisma.sql`
      UPDATE "WorkstationDeviceV2"
      SET "hostname" = ${parsed.data.hostname}, "windowsUser" = ${parsed.data.windowsUser},
          "wbLogin" = COALESCE(${resolvedWbLogin}, "wbLogin"), "agentVersion" = ${parsed.data.agentVersion},
          "lastSeenAt" = GREATEST(COALESCE("lastSeenAt", ${capturedAt}), ${capturedAt}),
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${auth.device.id}
    `);
    return count;
  });

  return NextResponse.json({ success: true, recordsProcessed: records.length, rowsAffected: affected });
}
