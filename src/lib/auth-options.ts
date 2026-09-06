import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";

import { demoUsers } from "@/lib/demo-auth";
import { recordErrorLog } from "@/lib/mock-db";
import { findPasswordUserByEmail, migrateLegacyPasswordForUser } from "@/lib/password-user-repository";
import { hasLocalPasswordAuthority, verifyAccountPassword } from "@/lib/password-credentials";
import { AuthenticationRateLimitError, clientIpFromHeaders, consumePasswordAttempts } from "@/lib/auth-rate-limit";
import { sessionAuthVersion } from "@/lib/session-security";
import { validateCurrentSessionToken } from "@/lib/session-validation";

const allowDemoLogin = process.env.NODE_ENV !== "production" && process.env.ALLOW_DEMO_LOGIN === "true";

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt"
  },
  pages: {
    signIn: "/login"
  },
  providers: [
    CredentialsProvider({
      name: "Central Operacional",
      credentials: {
        email: { label: "E-mail", type: "email" },
        password: { label: "Senha", type: "password" }
      },
      async authorize(credentials, request) {
        const email = credentials?.email?.toLowerCase().trim();
        const password = credentials?.password ?? "";

        if (!email || email.length > 254 || !password || password.length > 4096) {
          return null;
        }

        try {
          const rate = await consumePasswordAttempts("login", email, clientIpFromHeaders(request.headers));
          if (!rate.allowed) throw new AuthenticationRateLimitError();
          let user = await findPasswordUserByEmail(email);

          if (user && user.status === "ACTIVE") {
            const passwordMatches = await verifyAccountPassword(user, password);
            if (passwordMatches) {
              if (!hasLocalPasswordAuthority(user)) {
                // Migrate the successfully verified legacy credential once.
                if (!await migrateLegacyPasswordForUser(user, await bcrypt.hash(password, 10))) return null;
                user = await findPasswordUserByEmail(email);
                if (!user || user.status !== "ACTIVE" || !await bcrypt.compare(password, user.passwordHash)) return null;
              }
              return {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.roleName,
                roleTitle: user.roleTitle,
                jobTitle: user.roleTitle,
                skill: user.skill,
                lob: user.lob,
                mustChangePassword: user.mustChangePassword,
                authVersion: sessionAuthVersion(user)
              } as never;
            }
          }
        } catch (error) {
          if (error instanceof AuthenticationRateLimitError) throw error;
          recordErrorLog({
            userEmail: email,
            code: "LOGIN_DATABASE_ERROR",
            message: error instanceof Error ? error.message : "Erro de banco no login",
            action: "LOGIN",
            severity: "ERROR"
          });
        }

        const fallback = demoUsers.find((demoUser) => demoUser.email === email);
        if (allowDemoLogin && fallback && password === "Central@123") {
          return {
            id: fallback.email,
            email: fallback.email,
            name: fallback.name,
            role: fallback.role,
            demoSession: true
          } as never;
        }

        return null;
      }
    })
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.authVersion = (user as { authVersion?: string }).authVersion;
        token.demoSession = (user as { demoSession?: boolean }).demoSession === true;
        token.role = (user as { role?: string }).role;
        token.roleTitle = (user as { roleTitle?: string | null }).roleTitle ?? null;
        token.jobTitle = (user as { jobTitle?: string | null }).jobTitle ?? null;
        token.skill = (user as { skill?: string | null }).skill ?? null;
        token.lob = (user as { lob?: string | null }).lob ?? "";
        token.mustChangePassword = Boolean((user as { mustChangePassword?: boolean }).mustChangePassword);
      }
      return validateCurrentSessionToken(token);
    },
    async session({ session, token }) {
      if (token.authInvalid) return { ...session, user: undefined };
      if (session.user) {
        session.user.id = token.sub ?? "";
        session.user.role = String(token.role ?? "COLABORADOR");
        session.user.roleTitle = typeof token.roleTitle === "string" ? token.roleTitle : null;
        session.user.jobTitle = typeof token.jobTitle === "string" ? token.jobTitle : null;
        session.user.skill = typeof token.skill === "string" ? token.skill : null;
        session.user.lob = typeof token.lob === "string" && token.lob ? token.lob : null;
        session.user.mustChangePassword = Boolean(token.mustChangePassword);
      }
      return session;
    }
  }
};
