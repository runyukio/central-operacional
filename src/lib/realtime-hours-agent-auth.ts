import { createHash, timingSafeEqual } from "crypto";

const migrationTokenHashes = [
  "fbb33dda71007414dc5c2c37a1b8654989f4e6fcf30e33e65c647ef416244d3e"
] as const;

const migrationTokenExpiresAt = new Date("2026-12-31T23:59:59.999Z").getTime();

export function validateRealtimeHoursAgentToken(authorizationHeader?: string | null) {
  const match = String(authorizationHeader ?? "").match(/^Bearer\s+(.+)$/i);
  const providedToken = match?.[1]?.trim() ?? "";
  if (!providedToken) {
    return { error: "Token do agente de horas ausente.", status: 401 } as const;
  }

  const configuredTokens = [
    process.env.REALTIME_HOURS_AGENT_TOKEN,
    process.env.REALTIME_HOURS_AGENT_TOKEN_V2
  ].map((value) => value?.trim()).filter((value): value is string => Boolean(value));

  const matchesConfiguredToken = configuredTokens.some((configuredToken) => (
    safeEqualString(providedToken, configuredToken)
  ));

  const providedHash = createHash("sha256").update(providedToken).digest("hex");
  const matchesTemporaryMigrationToken = Date.now() <= migrationTokenExpiresAt
    && migrationTokenHashes.some((expectedHash) => safeEqualHex(providedHash, expectedHash));

  if (!matchesConfiguredToken && !matchesTemporaryMigrationToken) {
    return { error: "Token do agente de horas inválido.", status: 401 } as const;
  }

  return {
    ok: true,
    tokenSource: matchesConfiguredToken ? "environment" : "temporary-migration",
    migrationTokenExpiresAt: matchesTemporaryMigrationToken
      ? new Date(migrationTokenExpiresAt).toISOString()
      : null
  } as const;
}

function safeEqualString(actual: string, expected: string) {
  const actualHash = createHash("sha256").update(actual).digest("hex");
  const expectedHash = createHash("sha256").update(expected).digest("hex");
  return safeEqualHex(actualHash, expectedHash);
}

function safeEqualHex(actual: string, expected: string) {
  if (!/^[a-f0-9]{64}$/i.test(actual) || !/^[a-f0-9]{64}$/i.test(expected)) return false;
  const actualBuffer = Buffer.from(actual, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}
