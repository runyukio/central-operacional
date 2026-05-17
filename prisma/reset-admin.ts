import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";

const prisma = new PrismaClient();

const adminEmail = "admin@central.com";
const adminPassword = "Central@123";
const adminName = "Admin Central";

async function main() {
  const now = new Date();
  const passwordHash = await bcrypt.hash(adminPassword, 10);

  const adminRole = await prisma.role.upsert({
    where: { name: "ADMIN" },
    update: { label: "Administrador" },
    create: {
      name: "ADMIN",
      label: "Administrador",
      description: "Acesso administrativo total ao sistema"
    }
  });

  const adminId = await upsertAdminUser(adminRole.id, passwordHash, now);

  await resetOptionalPasswordColumns(adminId, now);

  const permissions = await prisma.permission.findMany({
    select: { id: true }
  });

  for (const permission of permissions) {
    await prisma.userPermission.upsert({
      where: {
        userId_permissionId: {
          userId: adminId,
          permissionId: permission.id
        }
      },
      update: { granted: true },
      create: {
        userId: adminId,
        permissionId: permission.id,
        granted: true
      }
    });
  }

  console.log("Admin resetado com sucesso");
}

async function upsertAdminUser(roleId: string, passwordHash: string, now: Date) {
  const existingUsers = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "User"
    WHERE "email" = ${adminEmail}
    LIMIT 1
  `;
  const existingUser = existingUsers[0];

  if (existingUser) {
    await prisma.$executeRaw`
      UPDATE "User"
      SET
        "name" = ${adminName},
        "passwordHash" = ${passwordHash},
        "roleId" = ${roleId},
        "status" = ${"ACTIVE"}::"UserStatus",
        "deletedAt" = NULL,
        "updatedAt" = ${now}
      WHERE "id" = ${existingUser.id}
    `;
    return existingUser.id;
  }

  const id = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO "User" (
      "id",
      "email",
      "name",
      "passwordHash",
      "roleId",
      "status",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${id},
      ${adminEmail},
      ${adminName},
      ${passwordHash},
      ${roleId},
      ${"ACTIVE"}::"UserStatus",
      ${now},
      ${now}
    )
  `;
  return id;
}

async function resetOptionalPasswordColumns(userId: string, now: Date) {
  const existingColumns = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'User'
      AND column_name IN (
        'mustChangePassword',
        'temporaryPassword',
        'passwordChangedAt',
        'lastPasswordResetAt',
        'passwordResetById'
      )
  `;
  const columns = new Set(existingColumns.map((column) => column.column_name));

  if (columns.has("mustChangePassword")) {
    await prisma.$executeRaw`UPDATE "User" SET "mustChangePassword" = false WHERE "id" = ${userId}`;
  }
  if (columns.has("temporaryPassword")) {
    await prisma.$executeRaw`UPDATE "User" SET "temporaryPassword" = false WHERE "id" = ${userId}`;
  }
  if (columns.has("passwordChangedAt")) {
    await prisma.$executeRaw`UPDATE "User" SET "passwordChangedAt" = ${now} WHERE "id" = ${userId}`;
  }
  if (columns.has("lastPasswordResetAt")) {
    await prisma.$executeRaw`UPDATE "User" SET "lastPasswordResetAt" = ${now} WHERE "id" = ${userId}`;
  }
  if (columns.has("passwordResetById")) {
    await prisma.$executeRaw`UPDATE "User" SET "passwordResetById" = NULL WHERE "id" = ${userId}`;
  }
}

main()
  .catch((error) => {
    console.error("Erro ao resetar admin:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
