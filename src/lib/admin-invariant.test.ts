import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { assertActiveAdminRemains } from "./admin-invariant";

test("last administrator is protected from another editor and concurrent removals are serialized", async () => {
  const calls: string[] = [];
  let others = 0;
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray) => { calls.push("lock"); assert.match(strings.join(""), /pg_advisory_xact_lock\(732104, 1\)/); },
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
