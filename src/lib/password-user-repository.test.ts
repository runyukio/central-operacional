import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { migrateLegacyPasswordForUser, updatePasswordForUser } from "./password-user-repository";

function queryClient(changed: number, inspect: (sql: string, parameters: unknown[]) => void) {
  return { $executeRaw: async (sql: TemplateStringsArray, ...parameters: unknown[]) => {
    inspect(sql.join("?"), parameters); return changed;
  } } as unknown as Pick<PrismaClient, "$queryRaw" | "$executeRaw">;
}

const legacy = { id: "synthetic-user", passwordHash: "synthetic-old-hash", updatedAt: new Date("2026-09-06T12:00:00Z") };

test("legacy migration is conditional on verified credential version and preserves temporary-password rules", async () => {
  const client = queryClient(1, (sql, parameters) => {
    assert.match(sql, /"passwordHash" = \? AND "updatedAt" = \?/);
    assert.match(sql, /"passwordChangedAt" IS NULL AND "lastPasswordResetAt" IS NULL/);
    assert.match(sql, /"status" = 'ACTIVE' AND "deletedAt" IS NULL/);
    assert.equal(sql.includes("mustChangePassword"), false);
    assert.equal(sql.includes("temporaryPassword"), false);
    assert.equal(parameters.includes(legacy.passwordHash), true);
    assert.equal(parameters.includes(legacy.updatedAt), true);
  });
  assert.equal(await migrateLegacyPasswordForUser(legacy, "synthetic-new-hash", client), true);
  assert.equal(await migrateLegacyPasswordForUser(legacy, "synthetic-new-hash", queryClient(0, () => {})), false);
});

test("password changes fail closed when account version or status changes concurrently", async () => {
  const client = queryClient(0, (sql, parameters) => {
    assert.match(sql, /"status" = 'ACTIVE' AND "deletedAt" IS NULL/);
    assert.match(sql, /"updatedAt" = \?/);
    assert.equal(parameters.includes(legacy.updatedAt), true);
  });
  await assert.rejects(updatePasswordForUser(legacy.id, "synthetic-new-hash", client, legacy.updatedAt), /conta foi alterada/);
  await updatePasswordForUser(legacy.id, "synthetic-new-hash", queryClient(1, () => {}), legacy.updatedAt);
});
