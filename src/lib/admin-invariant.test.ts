import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { assertActiveAdminRemains } from "./admin-invariant";

test("last administrator is protected from another editor and concurrent removals are serialized", async () => {
  const calls: string[] = [];
  let others = 0;
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray) => { calls.push("lock"); assert.match(strings.join(""), /pg_advisory_xact_lock\(732104, 1\)::text/); },
    user: {
      findUnique: async () => { calls.push("read"); return { id: "admin", roleId: "admin-role", role: { name: "ADMIN" }, status: "ACTIVE", deletedAt: null }; },
      count: async () => others
    }
  } as unknown as Prisma.TransactionClient;
  for (const change of [{ status: "INACTIVE" }, { status: "BLOCKED" }, { roleId: "collaborator-role" }, { deletedAt: new Date() }]) {
    await assert.rejects(assertActiveAdminRemains(tx, "admin", change), /último ADMIN/);
  }
  assert.deepEqual(calls.slice(0, 2), ["lock", "read"]);
  others = 1;
  await assert.doesNotReject(assertActiveAdminRemains(tx, "admin", { status: "INACTIVE" }));
  others = 0;
  await assert.doesNotReject(assertActiveAdminRemains(tx, "admin", { roleId: "admin-role", status: "ACTIVE" }));
});

test("editing a non-admin retains the lock without requiring another administrator", async () => {
  const calls: string[] = [];
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray) => {
      assert.match(strings.join(""), /pg_advisory_xact_lock\(732104, 1\)::text/);
      calls.push("lock");
      return [{ lock: "" }];
    },
    user: {
      findUnique: async () => { calls.push("read"); return { role: { name: "COLABORADOR" }, status: "ACTIVE", deletedAt: null }; },
      count: async () => { throw new Error("Non-admin edit must not count administrators"); }
    }
  } as unknown as Prisma.TransactionClient;
  await assert.doesNotReject(assertActiveAdminRemains(tx, "partner-user", { status: "ACTIVE" }));
  assert.deepEqual(calls, ["lock", "read"]);
});

test("a failed admin protection lock stops before reading or modifying users", async () => {
  let reads = 0;
  const tx = {
    $queryRaw: async () => { throw new Error("lock unavailable"); },
    user: { findUnique: async () => { reads += 1; } }
  } as unknown as Prisma.TransactionClient;
  await assert.rejects(assertActiveAdminRemains(tx, "admin", { status: "INACTIVE" }), /lock unavailable/);
  assert.equal(reads, 0);
});
