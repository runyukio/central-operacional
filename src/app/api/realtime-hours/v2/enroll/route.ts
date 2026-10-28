import { createHash, randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { deriveDeviceSecret } from "@/lib/realtime-hours-v2/auth";
import { enrollmentRequestSchema } from "@/lib/realtime-hours-v2/contract";
import { parseJsonText, readRequestTextWithLimit } from "@/lib/realtime-hours-v2/request";

export const dynamic = "force-dynamic";
const maxBodyBytes = 16 * 1024;

type EnrollmentRow = {
  id: string;
  maxUses: number;
  usedCount: number;
};

export async function POST(request: Request) {
  const bodyResult = await readRequestTextWithLimit(request, maxBodyBytes);
  if (!bodyResult.ok) return NextResponse.json({ success: false, error: bodyResult.error }, { status: bodyResult.status });
  const json = parseJsonText(bodyResult.text);
  if (!json.ok) return NextResponse.json({ success: false, error: json.error }, { status: json.status });

  const parsed = enrollmentRequestSchema.safeParse(json.value);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Payload inválido.", details: parsed.error.issues }, { status: 400 });
  }

  const masterKey = process.env.REALTIME_HOURS_V2_MASTER_KEY ?? "";
  if (Buffer.byteLength(masterKey, "utf8") < 32) {
    return NextResponse.json({ success: false, error: "Enrollment indisponível." }, { status: 500 });
  }

  const codeHash = createHash("sha256").update(parsed.data.enrollmentCode, "utf8").digest("hex");
  const deviceId = randomUUID();
  const secretVersion = 1;

  const enrolled = await prisma.$transaction(async (tx) => {
    const [code] = await tx.$queryRaw<EnrollmentRow[]>(Prisma.sql`
      SELECT "id", "maxUses", "usedCount"
      FROM "WorkstationEnrollmentCodeV2"
      WHERE "codeHash" = ${codeHash}
        AND "revokedAt" IS NULL
        AND "expiresAt" > CURRENT_TIMESTAMP
        AND "usedCount" < "maxUses"
      FOR UPDATE
      LIMIT 1
    `);
    if (!code) return false;

    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "WorkstationDeviceV2" (
        "id", "hostname", "windowsUser", "wbLogin", "status", "secretVersion",
        "agentVersion", "enrolledAt", "lastSeenAt", "createdAt", "updatedAt"
      ) VALUES (
        ${deviceId}, ${parsed.data.hostname}, ${parsed.data.windowsUser}, ${parsed.data.wbLogin || null},
        'PENDING', ${secretVersion}, ${parsed.data.agentVersion}, CURRENT_TIMESTAMP,
        NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `);
    await tx.$executeRaw(Prisma.sql`
      UPDATE "WorkstationEnrollmentCodeV2"
      SET "usedCount" = "usedCount" + 1, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${code.id}
    `);
    return true;
  });

  if (!enrolled) {
    return NextResponse.json({ success: false, error: "Código de enrollment inválido, expirado ou esgotado." }, { status: 401 });
  }

  const secret = deriveDeviceSecret(masterKey, deviceId, secretVersion).toString("base64url");
  return NextResponse.json({ success: true, deviceId, deviceSecret: secret, secretVersion });
}
