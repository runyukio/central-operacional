import { createHash } from "crypto";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { deriveDeviceSecret, verifySignedRequest } from "@/lib/realtime-hours-v2/auth";

type DeviceAuthRow = {
  id: string;
  hostname: string;
  windowsUser: string;
  status: string;
  secretVersion: number;
  revokedAt: Date | null;
  employeeId: string | null;
  wbLogin: string | null;
  centralDeliveryAllowed: boolean;
};

type DeviceAuthOptions = {
  allowPending?: boolean;
};

export async function authenticateDeviceRequest(request: Request, body: string, options: DeviceAuthOptions = {}) {
  const deviceId = request.headers.get("x-rh-device-id")?.trim() ?? "";
  const timestamp = request.headers.get("x-rh-timestamp")?.trim() ?? "";
  const nonce = request.headers.get("x-rh-nonce")?.trim() ?? "";
  const bodyHash = request.headers.get("x-rh-body-sha256")?.trim() ?? "";
  const signature = request.headers.get("x-rh-signature")?.trim() ?? "";

  if (!deviceId || !timestamp || !nonce || !bodyHash || !signature) {
    return { ok: false as const, status: 401, error: "Assinatura do dispositivo ausente." };
  }

  const [device] = await prisma.$queryRaw<DeviceAuthRow[]>(Prisma.sql`
    SELECT device."id", device."hostname", device."windowsUser", device."status", device."secretVersion",
      device."revokedAt", device."employeeId", device."wbLogin",
      COALESCE(deployment."centralDeliveryAllowed", FALSE) AS "centralDeliveryAllowed"
    FROM "WorkstationDeviceV2" device
    LEFT JOIN "WorkstationDeploymentGrantV2" deployment ON deployment."id" = device."deploymentGrantId"
    WHERE device."id" = ${deviceId}
    LIMIT 1
  `);
  const statusAllowed = device?.status === "ACTIVE" || (options.allowPending && device?.status === "PENDING");
  if (!device || !statusAllowed || device.revokedAt) {
    return { ok: false as const, status: 401, error: "Dispositivo não autorizado." };
  }

  const masterKey = process.env.REALTIME_HOURS_V2_MASTER_KEY ?? "";
  let secret: Buffer;
  try {
    secret = deriveDeviceSecret(masterKey, device.id, device.secretVersion);
  } catch (error) {
    console.error("[realtime-hours-v2] master key inválida", error);
    return { ok: false as const, status: 500, error: "Autenticação do dispositivo indisponível." };
  }

  const url = new URL(request.url);
  const verification = verifySignedRequest({
    method: request.method,
    pathname: url.pathname,
    body,
    timestamp,
    nonce,
    bodyHash,
    signature
  }, secret);
  if (!verification.ok) {
    return { ok: false as const, status: 401, error: "Assinatura do dispositivo inválida." };
  }

  const nonceHash = createHash("sha256").update(nonce.toLowerCase(), "utf8").digest("hex");
  const expiresAt = new Date(Date.now() + 10 * 60_000);
  const inserted = await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "WorkstationRequestNonceV2" ("deviceId", "nonceHash", "expiresAt", "createdAt")
    VALUES (${device.id}, ${nonceHash}, ${expiresAt}, CURRENT_TIMESTAMP)
    ON CONFLICT ("deviceId", "nonceHash") DO NOTHING
  `);
  if (inserted !== 1) {
    return { ok: false as const, status: 409, error: "Requisição duplicada ou repetida." };
  }

  return { ok: true as const, device };
}
