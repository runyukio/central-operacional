import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { POST as issueTicket } from "../../app/api/realtime-hours/v2/enrollment-ticket/route";
import { POST as enroll } from "../../app/api/realtime-hours/v2/enroll/route";

function fixture(t: TestContext, responses: unknown[][]) {
  const queries: Prisma.Sql[] = [], writes: Prisma.Sql[] = [];
  const original = Object.getOwnPropertyDescriptor(prisma, "$transaction");
  const tx = {
    $queryRaw: async (sql: Prisma.Sql) => { queries.push(sql); return responses.shift() ?? []; },
    $executeRaw: async (sql: Prisma.Sql) => { writes.push(sql); return 1; }
  };
  Object.defineProperty(prisma, "$transaction", { configurable: true, value: async (callback: (value: typeof tx) => unknown) => callback(tx) });
  t.after(() => { if (original) Object.defineProperty(prisma, "$transaction", original); else Reflect.deleteProperty(prisma, "$transaction"); });
  return { queries, writes };
}
function request(path: string, body: object) {
  return new Request(`https://example.test/api/realtime-hours/v2/${path}`, { method: "POST", body: JSON.stringify(body) });
}
const grant = () => ({ id: "grant-demo", expiresAt: new Date(Date.now() + 60 * 60_000) });
const ticketPayload = { deploymentCode: "A".repeat(32), hostname: "FLEET-PC-1", windowsUser: "test-user" };
const enrollPayload = { enrollmentCode: "B".repeat(32), hostname: "FLEET-PC-1", windowsUser: "test-user", agentVersion: "1.0.0-alpha.1" };

test("the same deployment authorization issues independent machine-bound single-use codes", async (t) => {
  const { queries, writes } = fixture(t, [[grant()], [grant()]]);
  const first = await issueTicket(request("enrollment-ticket", ticketPayload));
  const second = await issueTicket(request("enrollment-ticket", { ...ticketPayload, hostname: "FLEET-PC-2" }));
  assert.equal(first.status, 200); assert.equal(second.status, 200);
  assert.equal(first.headers.get("cache-control"), "no-store");
  const a = await first.json(), b = await second.json();
  assert.notEqual(a.enrollmentCode, b.enrollmentCode);
  assert.equal(a.maxUses, 1); assert.equal(b.maxUses, 1);
  assert.ok(new Date(a.expiresAt).getTime() <= Date.now() + 10 * 60_000);
  assert.ok(!JSON.stringify(a).includes(ticketPayload.deploymentCode));
  assert.equal(writes.length, 2);
  assert.ok(writes[0].values.includes("FLEET-PC-1"));
  assert.ok(writes[1].values.includes("FLEET-PC-2"));
  assert.ok(writes.every((sql) => sql.text.includes('"boundWindowsUser"') && sql.text.includes('"deploymentGrantId"')));
  assert.ok(queries.every((sql) => sql.text.includes('"revokedAt" IS NULL') && sql.text.includes('"expiresAt" > CURRENT_TIMESTAMP')));
  assert.ok(queries.every((sql) => !sql.text.includes('"maxUses"')), "no shared machine count limit");
});

test("invalid, expired or revoked deployment grants cannot issue a ticket", async (t) => {
  const { writes } = fixture(t, [[]]);
  const result = await issueTicket(request("enrollment-ticket", ticketPayload));
  assert.equal(result.status, 401); assert.equal(writes.length, 0);
});

test("malformed deployment grants are rejected before database access", async (t) => {
  const { queries } = fixture(t, []);
  const result = await issueTicket(request("enrollment-ticket", { ...ticketPayload, deploymentCode: "short" }));
  assert.equal(result.status, 400); assert.equal(queries.length, 0);
});

test("ticket lifetime cannot exceed the remaining deployment authorization", async (t) => {
  const expiresAt = new Date(Date.now() + 30_000);
  fixture(t, [[{ ...grant(), expiresAt }]]);
  const result = await issueTicket(request("enrollment-ticket", ticketPayload));
  assert.equal((await result.json()).expiresAt, expiresAt.toISOString());
});

test("non-expiring deployment grants still issue short-lived single-use device tickets", async (t) => {
  fixture(t, [[{ id: "grant-permanent", expiresAt: null }]]);
  const result = await issueTicket(request("enrollment-ticket", ticketPayload));
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.equal(body.maxUses, 1);
  assert.ok(new Date(body.expiresAt).getTime() > Date.now() + 9 * 60_000);
  assert.ok(new Date(body.expiresAt).getTime() <= Date.now() + 10 * 60_000);
});

function masterKey(t: TestContext) {
  const original = process.env.REALTIME_HOURS_V2_MASTER_KEY;
  process.env.REALTIME_HOURS_V2_MASTER_KEY = "test-master-key-with-at-least-thirty-two-bytes";
  t.after(() => { if (original === undefined) delete process.env.REALTIME_HOURS_V2_MASTER_KEY; else process.env.REALTIME_HOURS_V2_MASTER_KEY = original; });
}

test("enrollment consumes under a row lock and preserves the trusted deployment association", async (t) => {
  masterKey(t);
  const { queries, writes } = fixture(t, [[{ id: "code-demo", maxUses: 1, usedCount: 0, deploymentGrantId: "grant-demo" }]]);
  const result = await enroll(request("enroll", enrollPayload));
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.ok(body.deviceId); assert.ok(body.deviceSecret);
  assert.ok(writes[0].values.includes("grant-demo"));
  assert.ok(writes[1].text.includes('"usedCount" + 1'));
  const sql = queries[0];
  assert.ok(sql.text.includes('FOR UPDATE OF code'));
  assert.ok(sql.text.includes('code."usedCount" < code."maxUses"'));
  assert.ok(sql.text.includes('LOWER(code."boundHostname")'));
  assert.ok(sql.text.includes('LOWER(code."boundWindowsUser")'));
  assert.ok(sql.text.includes('deployment."revokedAt" IS NULL'));
  assert.ok(sql.text.includes('deployment."expiresAt" > CURRENT_TIMESTAMP'));
});

test("used, expired, revoked and identity-mismatched single-use codes cannot enroll", async (t) => {
  masterKey(t);
  const { writes } = fixture(t, [[]]);
  assert.equal((await enroll(request("enroll", enrollPayload))).status, 401);
  assert.equal(writes.length, 0);
});

test("legacy one-machine packages remain supported without fleet authorization", async (t) => {
  masterKey(t);
  const { writes } = fixture(t, [[{ id: "legacy-code", maxUses: 1, usedCount: 0, deploymentGrantId: null }]]);
  assert.equal((await enroll(request("enroll", enrollPayload))).status, 200);
  assert.ok(writes[0].values.includes(null));
});
