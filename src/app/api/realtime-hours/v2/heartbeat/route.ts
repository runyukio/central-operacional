import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { heartbeatPayloadSchema, normalizeDomain } from "@/lib/realtime-hours-v2/contract";
import { publishPresenceToCentral } from "@/lib/realtime-hours-v2/central-presence-bridge";
import { authenticateDeviceRequest } from "@/lib/realtime-hours-v2/device-auth";
import { dateWithinWindow, parseJsonText, readRequestTextWithLimit } from "@/lib/realtime-hours-v2/request";

export const dynamic = "force-dynamic";
const maxBodyBytes = 32 * 1024;

export async function POST(request: Request) {
  const bodyResult = await readRequestTextWithLimit(request, maxBodyBytes);
  if (!bodyResult.ok) return NextResponse.json({ success: false, error: bodyResult.error }, { status: bodyResult.status });

  const auth = await authenticateDeviceRequest(request, bodyResult.text, { allowPending: true });
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

  const json = parseJsonText(bodyResult.text);
  if (!json.ok) return NextResponse.json({ success: false, error: json.error }, { status: json.status });

  const parsed = heartbeatPayloadSchema.safeParse(json.value);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Payload inválido.", details: parsed.error.issues }, { status: 400 });
  }
  const value = parsed.data;
  const capturedAt = new Date(value.capturedAt);
  if (!dateWithinWindow(capturedAt, { futureMs: 5 * 60_000, pastMs: 14 * 24 * 60 * 60_000 })) {
    return NextResponse.json({ success: false, error: "capturedAt fora da janela permitida." }, { status: 400 });
  }
  const domain = value.currentType === "WEB" ? normalizeDomain(value.currentDomain) : null;
  const resolvedWbLogin = value.wbLogin || auth.device.wbLogin || null;

  await prisma.$transaction(async (tx) => {
    if (auth.device.status === "PENDING") {
      await tx.$executeRaw(Prisma.sql`
        UPDATE "WorkstationDeviceV2"
        SET "status" = 'DISABLED', "revokedAt" = COALESCE("revokedAt", CURRENT_TIMESTAMP),
            "replacedByDeviceId" = ${auth.device.id}, "updatedAt" = CURRENT_TIMESTAMP
        WHERE LOWER("hostname") = LOWER(${auth.device.hostname})
          AND LOWER("windowsUser") = LOWER(${auth.device.windowsUser})
          AND "status" = 'ACTIVE'
          AND "id" <> ${auth.device.id}
      `);
    }
    const updated = await tx.$executeRaw(Prisma.sql`
      UPDATE "WorkstationDeviceV2"
      SET "hostname" = ${value.hostname}, "windowsUser" = ${value.windowsUser},
          "wbLogin" = COALESCE(${resolvedWbLogin}, "wbLogin"), "agentVersion" = ${value.agentVersion},
          "status" = 'ACTIVE', "revokedAt" = NULL,
          "lastSeenAt" = GREATEST(COALESCE("lastSeenAt", ${capturedAt}), ${capturedAt}),
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${auth.device.id} AND "revokedAt" IS NULL AND "status" IN ('ACTIVE','PENDING')
    `);
    if (updated !== 1) throw new Error("Device revoked during heartbeat");
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "WorkstationCurrentStateV2" (
        "deviceId", "capturedAt", "sessionState", "idleSeconds", "activeProcessName",
        "sourceType", "domain", "detectionMethod", "agentVersion", "createdAt", "updatedAt"
      ) VALUES (
        ${auth.device.id}, ${capturedAt}, ${value.sessionState}, ${value.idleSeconds},
        ${value.activeProcessName || null}, ${value.currentType || null}, ${domain},
        ${value.detectionMethod || null}, ${value.agentVersion}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      ON CONFLICT ("deviceId") DO UPDATE SET
        "capturedAt" = EXCLUDED."capturedAt",
        "sessionState" = EXCLUDED."sessionState",
        "idleSeconds" = EXCLUDED."idleSeconds",
        "activeProcessName" = EXCLUDED."activeProcessName",
        "sourceType" = EXCLUDED."sourceType",
        "domain" = EXCLUDED."domain",
        "detectionMethod" = EXCLUDED."detectionMethod",
        "agentVersion" = EXCLUDED."agentVersion",
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE EXCLUDED."capturedAt" >= "WorkstationCurrentStateV2"."capturedAt"
    `);
  });

  try {
    await publishPresenceToCentral({ device: auth.device, snapshot: value });
  } catch {
    return NextResponse.json({ success: false, error: "Central presence delivery is temporarily unavailable." }, { status: 503 });
  }
  return NextResponse.json({ success: true, acceptedAt: new Date().toISOString() });
}
