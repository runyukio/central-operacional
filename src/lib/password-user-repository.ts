import type { PrismaClient } from "@prisma/client";

import { prisma } from "@/lib/prisma";

type QueryClient = Pick<PrismaClient, "$queryRaw" | "$executeRaw">;

export type PasswordUserRecord = {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  status: string;
  roleName: string;
  roleTitle: string | null;
  skill: string | null;
  lob: string | null;
  mustChangePassword: boolean;
  temporaryPassword: boolean;
  updatedAt: Date;
  passwordChangedAt: Date | null;
  lastPasswordResetAt: Date | null;
};

export async function findPasswordUserByEmail(email: string, client: QueryClient = prisma) {
  const rows = await client.$queryRaw<Array<PasswordUserRecord>>`
    SELECT
      u."id",
      u."email",
      u."name",
      u."passwordHash",
      u."status"::text AS "status",
      u."updatedAt",
      u."passwordChangedAt",
      u."lastPasswordResetAt",
      u."mustChangePassword",
      u."temporaryPassword",
      r."name" AS "roleName",
      ep."roleTitle",
      ep."skill",
      l."name" AS "lob"
    FROM "User" u
    INNER JOIN "Role" r ON r."id" = u."roleId"
    LEFT JOIN "EmployeeProfile" ep ON ep."userId" = u."id" AND ep."deletedAt" IS NULL
    LEFT JOIN "Lob" l ON l."id" = ep."lobId"
    WHERE lower(u."email") = ${email.toLowerCase()}
      AND u."deletedAt" IS NULL
    LIMIT 1
  `;

  const user = rows[0];
  if (!user) return null;

  return user;
}

export async function migrateLegacyPasswordForUser(user: Pick<PasswordUserRecord, "id" | "passwordHash" | "updatedAt">, passwordHash: string, client: QueryClient = prisma) {
  const now = new Date();
  // Compare the exact version that was authenticated. A concurrent reset must
  // win over a legacy login, and temporary-password requirements stay intact.
  const changed = await client.$executeRaw`
    UPDATE "User" SET "passwordHash" = ${passwordHash}, "updatedAt" = ${now}, "passwordChangedAt" = ${now}
    WHERE "id" = ${user.id} AND "passwordHash" = ${user.passwordHash} AND "updatedAt" = ${user.updatedAt}
      AND "passwordChangedAt" IS NULL AND "lastPasswordResetAt" IS NULL
      AND "status" = 'ACTIVE' AND "deletedAt" IS NULL
  `;
  return changed === 1;
}

export async function updatePasswordForUser(userId: string, passwordHash: string, client: QueryClient = prisma, expectedUpdatedAt?: Date) {
  const now = new Date();

  const changed = await client.$executeRaw`
    UPDATE "User"
    SET
      "passwordHash" = ${passwordHash},
      "updatedAt" = ${now},
      "mustChangePassword" = false,
      "temporaryPassword" = false,
      "passwordChangedAt" = ${now},
      "lastPasswordResetAt" = ${now},
      "passwordResetById" = NULL
    WHERE "id" = ${userId}
      AND "status" = 'ACTIVE' AND "deletedAt" IS NULL
      AND (${expectedUpdatedAt ?? null}::timestamp IS NULL OR "updatedAt" = ${expectedUpdatedAt ?? null})
  `;
  if (changed !== 1) throw new Error("Sua conta foi alterada durante a solicitação. Entre novamente e tente outra vez.");
}

export async function resetOptionalPasswordColumns(userId: string, now = new Date(), client: QueryClient = prisma) {
  await client.$executeRaw`
    UPDATE "User" SET "mustChangePassword" = false, "temporaryPassword" = false,
      "passwordChangedAt" = ${now}, "lastPasswordResetAt" = ${now},
      "passwordResetById" = NULL, "updatedAt" = ${now}
    WHERE "id" = ${userId}
  `;
}
