import type { JWT } from "next-auth/jwt";
import { findPasswordUserByEmail } from "@/lib/password-user-repository";
import { refreshSessionClaims } from "@/lib/session-security";
import { demoUsers } from "@/lib/demo-auth";

export const sessionValidationData = { findUser: findPasswordUserByEmail };

export async function validateCurrentSessionToken(token: JWT): Promise<JWT> {
  if (process.env.NODE_ENV !== "production" && process.env.ALLOW_DEMO_LOGIN === "true"
    && token.demoSession === true && !token.authInvalid && !token.authVersion
    && demoUsers.some((user) => user.email === token.email && token.sub === user.email)) return token;
  const user = token.email ? await sessionValidationData.findUser(String(token.email)).catch(() => null) : null;
  return refreshSessionClaims(token, user);
}
