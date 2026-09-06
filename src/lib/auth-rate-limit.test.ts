import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "./prisma";
import { clientIpFromHeaders, consumeAuthRateLimit, consumePasswordAttempts } from "./auth-rate-limit";

const originalQuery = prisma.$queryRaw;
const originalVercel = process.env.VERCEL;
test.afterEach(() => {
  prisma.$queryRaw = originalQuery;
  if (originalVercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = originalVercel;
});

test("rate counter is updated by one atomic SQL upsert and blocks before credential checks", async () => {
  let calls = 0;
  const now = new Date("2026-09-06T12:00:00Z");
  prisma.$queryRaw = (async (strings: TemplateStringsArray) => {
    calls++;
    const sql = strings.join("?");
    assert.match(sql, /INSERT INTO "PasswordRecoveryRateLimit"/);
    assert.match(sql, /ON CONFLICT \("keyHash"\) DO UPDATE/);
    assert.match(sql, /"PasswordRecoveryRateLimit"\."attempts" \+ 1/);
    assert.match(sql, /RETURNING/);
    return [{ attempts: 11, windowStartedAt: now, blockedUntil: new Date(now.getTime() + 1800_000), expiresAt: now }];
  }) as typeof prisma.$queryRaw;
  const result = await consumeAuthRateLimit("opaque-key", 10, now);
  assert.equal(calls, 1);
  assert.equal(result.allowed, false);
  assert.equal(result.retryAfter, 1800);
});

test("login and change use separate account/IP keys and generous shared-IP budget", async () => {
  const values: unknown[][] = [];
  prisma.$queryRaw = (async (_strings: TemplateStringsArray, ...args: unknown[]) => {
    values.push(args);
    return [{ attempts: 1, windowStartedAt: new Date(), blockedUntil: null, expiresAt: new Date() }];
  }) as typeof prisma.$queryRaw;
  assert.equal((await consumePasswordAttempts("login", "User@Example.com", "203.0.113.1")).allowed, true);
  assert.equal((await consumePasswordAttempts("change", "User@Example.com", "203.0.113.1")).allowed, true);
  assert.equal(values.length, 4);
  assert.equal(new Set(values.map((args) => args[0])).size, 4);
  assert.ok(values[0].includes(10));
  assert.ok(values[1].includes(500));
  assert.equal(JSON.stringify(values).includes("User@Example.com"), false);
});

test("Vercel rate limits trust edge IP, not a caller-controlled forwarding header", () => {
  process.env.VERCEL = "1";
  assert.equal(clientIpFromHeaders(new Headers({ "x-vercel-forwarded-for": "203.0.113.8", "x-forwarded-for": "1.2.3.4" })), "203.0.113.8");
  assert.equal(clientIpFromHeaders(new Headers({ "x-forwarded-for": "1.2.3.4" })), "unknown");
});
