import assert from "node:assert/strict";
import test from "node:test";
import { mockPrismaDelegate } from "./prisma-test-delegate";
import { authorizeAdsBacklogGlide, readAdsBacklogGlide } from "./ads-backlog-glide-service";
import { canAccessAdsCapacity } from "./ads-capacity-permissions";
import { canAccessRealTimeQueues } from "./permissions";

const actor = { email: "planning@example.com", name: "Test", role: "ADMIN" as const };
test("backlog access requires current database ADS planning and queue permissions, ignoring a claimed admin session", async (t) => {
  let role = "COLABORADOR", status = "ACTIVE", exists = true;
  mockPrismaDelegate(t, "user", { findUnique: async (args) => { assert.equal(args.where.deletedAt, null); return exists ? { status, role: { name: role } } : null; } });
  for (const value of ["ADMIN", "WFM", "GESTOR", "SUPERVISOR", "POC", "RTA", "COLABORADOR", "CLIENT", "RH", "FINANCEIRO", "GLOBAL"]) {
    role = value;
    const allowed = canAccessAdsCapacity({ role, status }) && canAccessRealTimeQueues({ role, status });
    if (allowed) assert.equal((await authorizeAdsBacklogGlide(actor)).role, role);
    else await assert.rejects(() => authorizeAdsBacklogGlide(actor), { status: 403 });
  }
  role = "ADMIN"; status = "INACTIVE";
  await assert.rejects(() => readAdsBacklogGlide(actor), { status: 403 });
  status = "ACTIVE"; exists = false;
  await assert.rejects(() => readAdsBacklogGlide(actor), { status: 403 });
});

test("unsupported horizons fail before operational reads and do not expose a client forecast or ABS override", async (t) => {
  mockPrismaDelegate(t, "user", { findUnique: async () => ({ status: "ACTIVE", role: { name: "ADMIN" } }) });
  const operational = mockPrismaDelegate(t, "schedule", { findMany: async () => { throw new Error("Should not read schedules"); } });
  for (const horizonDays of ["", "0", "-1", "31", "abc", "7.5"]) await assert.rejects(() => readAdsBacklogGlide(actor, { horizonDays }), { status: 400 });
  assert.equal(operational.findMany.mock.callCount(), 0);
});

test("authorization precedes horizon validation and an inactive or downgraded database user cannot retain old-session access", async (t) => {
  let currentRole = "QUALIDADE", status = "ACTIVE";
  const users = mockPrismaDelegate(t, "user", { findUnique: async () => ({ status, role: { name: currentRole } }) });
  const operational = mockPrismaDelegate(t, "schedule", { findMany: async () => { throw new Error("Unauthorized operational read"); } });
  assert.equal(canAccessRealTimeQueues({ role: currentRole, status }), false);
  await assert.rejects(() => readAdsBacklogGlide(actor, { horizonDays: "31" }), { status: 403 }, "authorization wins over invalid horizon");
  currentRole = "ADMIN"; status = "INACTIVE";
  await assert.rejects(() => readAdsBacklogGlide(actor, { horizonDays: "31" }), { status: 403 });
  status = "ACTIVE";
  await assert.rejects(() => readAdsBacklogGlide(actor, { horizonDays: "31" }), { status: 400 }, "only an authorized database user reaches horizon validation");
  currentRole = "GESTOR";
  const current = await authorizeAdsBacklogGlide(actor);
  assert.equal(current.role, "GESTOR", "the checked database role replaces the old ADMIN role for downstream reads");
  assert.equal(current.email, actor.email);
  assert.equal(current.name, actor.name);
  assert.notEqual(current, actor);
  assert.equal(actor.role, "ADMIN", "the caller's session object remains untouched");
  currentRole = "ADMIN";
  assert.equal((await authorizeAdsBacklogGlide({ ...actor, role: "COLABORADOR" })).role, "ADMIN", "current database permissions also govern an old low-privilege session");
  assert.equal(operational.findMany.mock.callCount(), 0);
  assert.equal(users.findUnique.mock.callCount(), 5);
});
