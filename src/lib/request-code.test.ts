import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { nextRequestCode } from "./request-code";

test("request allocation acquires shared transaction lock before reading numeric maximum", async () => {
  const calls: string[] = [];
  const tx = { $queryRaw: async (query: { sql?: string } | TemplateStringsArray) => {
    const sql = Array.isArray(query) ? query.join("?") : (query as { sql: string }).sql;
    calls.push(sql);
    return calls.length === 1 ? [{}] : [{ nextNumber: "10001" }];
  } } as unknown as Prisma.TransactionClient;
  assert.equal(await nextRequestCode(tx), "REQ-10001");
  assert.match(calls[0], /pg_advisory_xact_lock/);
  assert.match(calls[1], /MAX\(SUBSTRING/);
  assert.doesNotMatch(calls[1], /LIMIT|deletedAt/);
});

test("request allocation preserves arbitrary precision and rejects a missing allocation", async () => {
  const tx = { $queryRaw: async () => [{ nextNumber: "90071992547409930" }] } as unknown as Prisma.TransactionClient;
  assert.equal(await nextRequestCode(tx), "REQ-90071992547409930");
  const empty = { $queryRaw: async () => [] } as unknown as Prisma.TransactionClient;
  await assert.rejects(nextRequestCode(empty), /gerar o código/);
});
