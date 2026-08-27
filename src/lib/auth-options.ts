import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";

import { demoUsers } from "@/lib/demo-auth";
import { recordErrorLog } from "@/lib/mock-db";
import { findPasswordUserByEmail } from "@/lib/password-user-repository";
import { verifySupabasePassword } from "@/lib/supabase-auth";

const allowDemoLogin = process.env.ALLOW_DEMO_LOGIN === "true";

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
      async authorize(credentials) {
        const email = credentials?.email?.toLowerCase().trim();
        const password = credentials?.password ?? "";

        if (!email || !password) {
          return null;
        }

        const supabaseUser = await verifySupabasePassword(email, password).catch((error) => {
          recordErrorLog({
            userEmail: email,
            code: "SUPABASE_AUTH_ERROR",
            message: error instanceof Error ? error.message : "Erro ao autenticar no Supabase Auth",
            action: "LOGIN",
            severity: "ERROR"
          });
          return null;
        });

        try {
          const user = await findPasswordUserByEmail(email);

          if (user && user.status === "ACTIVE") {
            const passwordMatches = supabaseUser ? true : await bcrypt.compare(password, user.passwordHash);
            if (passwordMatches) {
              return {
                id: supabaseUser?.id ?? user.id,
                email: user.email,
                name: user.name,
                role: user.roleName,
                roleTitle: user.roleTitle,
                jobTitle: user.roleTitle,
                skill: user.skill,
                lob: user.lob,
                mustChangePassword: user.mustChangePassword
              } as never;
            }
          }
        } catch (error) {
          recordErrorLog({
            userEmail: email,
            code: "LOGIN_DATABASE_ERROR",
            message: error instanceof Error ? error.message : "Erro de banco no login",
            action: "LOGIN",
            severity: "ERROR"
          });
        }

        if (supabaseUser && !allowDemoLogin) {
          recordErrorLog({
            userEmail: email,
            code: "LOGIN_USER_NOT_RELEASED",
            message: "Usuário autenticado no Supabase, mas sem perfil ativo aprovado na Central Operacional.",
            action: "LOGIN",
            severity: "WARNING"
          });
          return null;
        }

        const fallback = demoUsers.find((demoUser) => demoUser.email === email);
        if (allowDemoLogin && fallback && password === "Central@123") {
          return {
            id: fallback.email,
            email: fallback.email,
            name: fallback.name,
            role: fallback.role
          } as never;
        }

        return null;
      }
    })
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as { role?: string }).role;
        token.roleTitle = (user as { roleTitle?: string | null }).roleTitle ?? null;
        token.jobTitle = (user as { jobTitle?: string | null }).jobTitle ?? null;
        token.skill = (user as { skill?: string | null }).skill ?? null;
        token.lob = (user as { lob?: string | null }).lob ?? "";
        token.mustChangePassword = Boolean((user as { mustChangePassword?: boolean }).mustChangePassword);
      }
      if (!user && token.email && typeof token.lob !== "string") {
        const current = await findPasswordUserByEmail(String(token.email)).catch(() => null);
        token.lob = current?.lob ?? "";
      }
      return token;
    },
    async session({ session, token }) {
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
