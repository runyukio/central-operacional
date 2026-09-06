import { createHmac, timingSafeEqual } from "node:crypto";
import type { JWT } from "next-auth/jwt";
import type { PasswordUserRecord } from "@/lib/password-user-repository";

export function sessionAuthVersion(user: Pick<PasswordUserRecord, "id" | "passwordHash" | "updatedAt">) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET não configurado.");
  return createHmac("sha256", secret)
    .update(JSON.stringify([user.id, user.passwordHash, user.updatedAt.toISOString()]))
    .digest("hex");
}

export function refreshSessionClaims(token: JWT, user: PasswordUserRecord | null): JWT {
  if (!user || user.status !== "ACTIVE" || token.authInvalid || typeof token.authVersion !== "string") {
    return { ...token, authInvalid: true };
  }
  const expected = sessionAuthVersion(user);
  if (token.sub !== user.id || token.authVersion.length !== expected.length
    || !timingSafeEqual(Buffer.from(token.authVersion), Buffer.from(expected))) {
    return { ...token, authInvalid: true };
  }
  return { ...token, email: user.email, name: user.name, role: user.roleName,
    roleTitle: user.roleTitle, jobTitle: user.roleTitle, skill: user.skill,
    lob: user.lob ?? "", mustChangePassword: user.mustChangePassword };
}
