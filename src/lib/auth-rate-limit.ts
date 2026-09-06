import { createHmac } from "node:crypto";
import { prisma } from "@/lib/prisma";

export type RateState = { attempts: number; windowStartedAt: Date; blockedUntil: Date | null; expiresAt: Date };
const WINDOW_MS = 15 * 60_000;
const BLOCK_MS = 30 * 60_000;
const EXPIRES_MS = 24 * 60 * 60_000;

export class AuthenticationRateLimitError extends Error {
  constructor() { super("AUTH_RATE_LIMITED"); }
}

export function authRateKey(value: string) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret && process.env.NODE_ENV === "production") throw new Error("NEXTAUTH_SECRET não configurado.");
  return createHmac("sha256", secret || "local-password-recovery").update(value).digest("hex");
}

// One statement locks the conflicting row and computes the new state from its
// latest committed value. No read/compute/write race across function instances.
export async function consumeAuthRateLimit(keyHash: string, limit: number, now = new Date()) {
  const cutoff = new Date(now.getTime() - WINDOW_MS);
  const blockUntil = new Date(now.getTime() + BLOCK_MS);
  const expiresAt = new Date(now.getTime() + EXPIRES_MS);
  const rows = await prisma.$queryRaw<RateState[]>`
    INSERT INTO "PasswordRecoveryRateLimit"
      ("keyHash", "attempts", "windowStartedAt", "blockedUntil", "expiresAt", "updatedAt")
    VALUES (${keyHash}, 1, ${now}, NULL, ${expiresAt}, ${now})
    ON CONFLICT ("keyHash") DO UPDATE SET
      "attempts" = CASE
        WHEN "PasswordRecoveryRateLimit"."blockedUntil" > ${now} THEN "PasswordRecoveryRateLimit"."attempts"
        WHEN "PasswordRecoveryRateLimit"."windowStartedAt" <= ${cutoff} THEN 1
        ELSE "PasswordRecoveryRateLimit"."attempts" + 1 END,
      "windowStartedAt" = CASE
        WHEN "PasswordRecoveryRateLimit"."blockedUntil" > ${now} THEN "PasswordRecoveryRateLimit"."windowStartedAt"
        WHEN "PasswordRecoveryRateLimit"."windowStartedAt" <= ${cutoff} THEN ${now}
        ELSE "PasswordRecoveryRateLimit"."windowStartedAt" END,
      "blockedUntil" = CASE
        WHEN "PasswordRecoveryRateLimit"."blockedUntil" > ${now} THEN "PasswordRecoveryRateLimit"."blockedUntil"
        WHEN "PasswordRecoveryRateLimit"."windowStartedAt" <= ${cutoff} THEN NULL
        WHEN "PasswordRecoveryRateLimit"."attempts" + 1 > ${limit} THEN ${blockUntil}
        ELSE NULL END,
      "expiresAt" = ${expiresAt}, "updatedAt" = ${now}
    RETURNING "attempts", "windowStartedAt", "blockedUntil", "expiresAt"
  `;
  const state = rows[0];
  if (!state) throw new Error("Não foi possível verificar o limite de tentativas.");
  return { ...state, allowed: !state.blockedUntil || state.blockedUntil <= now,
    retryAfter: state.blockedUntil ? Math.max(0, Math.ceil((state.blockedUntil.getTime() - now.getTime()) / 1000)) : 0 };
}

export async function consumePasswordAttempts(purpose: "login" | "change", email: string, ipAddress?: string | null) {
  const now = new Date();
  const account = await consumeAuthRateLimit(authRateKey(`${purpose}:account:${email.trim().toLowerCase()}`), 10, now);
  // Shared offices can have hundreds of legitimate users on the same egress IP.
  const ip = await consumeAuthRateLimit(authRateKey(`${purpose}:ip:${ipAddress || "unknown"}`), 500, now);
  return { allowed: account.allowed && ip.allowed, retryAfter: Math.max(account.retryAfter, ip.retryAfter) };
}

export function clientIpFromHeaders(headers: Headers | Record<string, string | string[] | undefined> | undefined) {
  const read = (name: string) => {
    const value = headers instanceof Headers ? headers.get(name) : headers?.[name];
    return Array.isArray(value) ? value[0] : value;
  };
  // On Vercel this header is overwritten by the trusted edge. Never prefer a
  // client-provided forwarding header over it in production.
  const ip = process.env.VERCEL === "1" ? read("x-vercel-forwarded-for")
    : read("x-forwarded-for") || read("x-real-ip");
  return String(ip || "unknown").split(",")[0].trim().slice(0, 128);
}
