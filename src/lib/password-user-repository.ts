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
};

let userColumnCache: Set<string> | null = null;

export async function findPasswordUserByEmail(email: string, client: QueryClient = prisma) {
  const rows = await client.$queryRaw<Array<Omit<PasswordUserRecord, "mustChangePassword" | "temporaryPassword">>>`
    SELECT
      u."id",
      u."email",
      u."name",
      u."passwordHash",
      u."status"::text AS "status",
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

  const columns = await getUserColumns(client);
  return {
    ...user,
    mustChangePassword: columns.has("mustChangePassword") ? await readBooleanColumn(user.id, "mustChangePassword", client) : false,
    temporaryPassword: columns.has("temporaryPassword") ? await readBooleanColumn(user.id, "temporaryPassword", client) : false
  } satisfies PasswordUserRecord;
}

export async function updatePasswordForUser(userId: string, passwordHash: string, client: QueryClient = prisma) {
  const now = new Date();

  await client.$executeRaw`
    UPDATE "User"
    SET
      "passwordHash" = ${passwordHash},
      "updatedAt" = ${now}
    WHERE "id" = ${userId}
  `;

  await resetOptionalPasswordColumns(userId, now, client);
}

export async function resetOptionalPasswordColumns(userId: string, now = new Date(), client: QueryClient = prisma) {
  const columns = await getUserColumns(client);

  if (columns.has("mustChangePassword")) {
    await client.$executeRaw`UPDATE "User" SET "mustChangePassword" = false WHERE "id" = ${userId}`;
  }
  if (columns.has("temporaryPassword")) {
    await client.$executeRaw`UPDATE "User" SET "temporaryPassword" = false WHERE "id" = ${userId}`;
  }
  if (columns.has("passwordChangedAt")) {
    await client.$executeRaw`UPDATE "User" SET "passwordChangedAt" = ${now} WHERE "id" = ${userId}`;
  }
  if (columns.has("lastPasswordResetAt")) {
    await client.$executeRaw`UPDATE "User" SET "lastPasswordResetAt" = ${now} WHERE "id" = ${userId}`;
  }
  if (columns.has("passwordResetById")) {
    await client.$executeRaw`UPDATE "User" SET "passwordResetById" = NULL WHERE "id" = ${userId}`;
  }
}

async function getUserColumns(client: QueryClient) {
  if (userColumnCache) return userColumnCache;

  const rows = await client.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'User'
  `;

  userColumnCache = new Set(rows.map((row) => row.column_name));
  return userColumnCache;
}

async function readBooleanColumn(userId: string, column: "mustChangePassword" | "temporaryPassword", client: QueryClient) {
  if (column === "mustChangePassword") {
    const rows = await client.$queryRaw<Array<{ value: boolean }>>`
      SELECT "mustChangePassword" AS "value" FROM "User" WHERE "id" = ${userId} LIMIT 1
    `;
    return Boolean(rows[0]?.value);
  }

  const rows = await client.$queryRaw<Array<{ value: boolean }>>`
    SELECT "temporaryPassword" AS "value" FROM "User" WHERE "id" = ${userId} LIMIT 1
  `;
  return Boolean(rows[0]?.value);
}
