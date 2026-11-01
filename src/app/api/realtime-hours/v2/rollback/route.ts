import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateDeviceRequest } from "@/lib/realtime-hours-v2/device-auth";
import { readRequestTextWithLimit } from "@/lib/realtime-hours-v2/request";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await readRequestTextWithLimit(request, 1024);
  if (!body.ok) return NextResponse.json({ success: false }, { status: body.status });
  const auth = await authenticateDeviceRequest(request, body.text, { allowPending: true });
  if (!auth.ok) return NextResponse.json({ success: false }, { status: auth.status });
  const success = await prisma.$transaction(async (tx) => {
    const revoked = await tx.$executeRaw(Prisma.sql`
      UPDATE "WorkstationDeviceV2" SET "status"='REVOKED', "revokedAt"=CURRENT_TIMESTAMP, "updatedAt"=CURRENT_TIMESTAMP
      WHERE "id"=${auth.device.id} AND "enrolledAt" > CURRENT_TIMESTAMP - INTERVAL '1 hour'
        AND "status" IN ('ACTIVE','PENDING')
    `);
    if (revoked !== 1) return false;
    await tx.$executeRaw(Prisma.sql`
      UPDATE "WorkstationDeviceV2" previous SET "status"='ACTIVE', "revokedAt"=NULL,
        "replacedByDeviceId"=NULL, "updatedAt"=CURRENT_TIMESTAMP
      WHERE previous."replacedByDeviceId"=${auth.device.id} AND previous."status"='DISABLED'
        AND NOT EXISTS (SELECT 1 FROM "WorkstationDeviceV2" active
          WHERE active."status"='ACTIVE' AND LOWER(active."hostname")=LOWER(previous."hostname")
            AND LOWER(active."windowsUser")=LOWER(previous."windowsUser"))
    `);
    return true;
  });
  return NextResponse.json({ success }, { status: success ? 200 : 409 });
}
