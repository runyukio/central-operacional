import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deploymentTicketRequestSchema } from "@/lib/realtime-hours-v2/contract";
import { parseJsonText, readRequestTextWithLimit } from "@/lib/realtime-hours-v2/request";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await readRequestTextWithLimit(request, 16 * 1024);
  if (!body.ok) return NextResponse.json({ success: false, error: body.error }, { status: body.status });
  const json = parseJsonText(body.text);
  if (!json.ok) return NextResponse.json({ success: false, error: json.error }, { status: json.status });
  const parsed = deploymentTicketRequestSchema.safeParse(json.value);
  if (!parsed.success) return NextResponse.json({ success: false, error: "Payload inválido." }, { status: 400 });

  const { deploymentCode, hostname, windowsUser } = parsed.data;
  const grantHash = createHash("sha256").update(deploymentCode, "utf8").digest("hex");
  const enrollmentCode = randomBytes(24).toString("base64url");
  const codeHash = createHash("sha256").update(enrollmentCode, "utf8").digest("hex");
  const issued = await prisma.$transaction(async (tx) => {
    const [grant] = await tx.$queryRaw<Array<{ id: string; expiresAt: Date | null }>>(Prisma.sql`
      SELECT "id", "expiresAt" FROM "WorkstationDeploymentGrantV2"
      WHERE "codeHash" = ${grantHash} AND "revokedAt" IS NULL
        AND ("expiresAt" IS NULL OR "expiresAt" > CURRENT_TIMESTAMP)
      FOR SHARE
    `);
    if (!grant) return null;
    const expiresAt = new Date(Math.min(Date.now() + 10 * 60_000, grant.expiresAt?.getTime() ?? Infinity));
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "WorkstationEnrollmentCodeV2" (
        "id", "codeHash", "expiresAt", "maxUses", "usedCount", "deploymentGrantId", "boundHostname", "boundWindowsUser"
      ) VALUES (${randomUUID()}, ${codeHash}, ${expiresAt}, 1, 0, ${grant.id}, ${hostname}, ${windowsUser})
    `);
    return { expiresAt };
  });
  if (!issued) return NextResponse.json({ success: false, error: "Autorização do pacote inválida, expirada ou revogada." }, { status: 401 });
  return NextResponse.json({ success: true, enrollmentCode, expiresAt: issued.expiresAt.toISOString(), maxUses: 1 }, { headers: { "Cache-Control": "no-store" } });
}
