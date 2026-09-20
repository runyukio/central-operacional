import assert from "node:assert/strict";
import test from "node:test";
import { mockPrismaDelegate } from "./prisma-test-delegate";
import { authorizeAdsCapacity, readAdsCapacityPlan } from "./ads-capacity-service";
import { canAccessAdsCapacity } from "./ads-capacity-permissions";
import { canAccessAdsStaffCoverage, canAccessPerformance } from "./permissions";
import { readAdsCapacitySchedules } from "./staff-coverage-service";

test("planning access is exactly the intersection of existing ADS and Performance permissions", () => {
  for (const role of ["ADMIN", "WFM", "GESTOR", "SUPERVISOR", "POC", "RTA", "COLABORADOR", "CLIENT", "RH", "FINANCEIRO", "GLOBAL"]) {
    const user = { role, status: "ACTIVE" };
    assert.equal(canAccessAdsCapacity(user), canAccessAdsStaffCoverage(user) && canAccessPerformance(user), role);
    assert.equal(canAccessAdsCapacity({ ...user, status: "INACTIVE" }), false);
  }
});
test("server ignores claimed admin role and denies before reading operational data", async (t) => {
  mockPrismaDelegate(t, "user", { findUnique: async () => ({ status: "ACTIVE", role: { name: "COLABORADOR" } }) });
  const actor = { email: "test@example.com", role: "ADMIN" as const, name: "Test" };
  await assert.rejects(() => authorizeAdsCapacity(actor), { status: 403 });
  await assert.rejects(() => readAdsCapacityPlan(actor, {}), { status: 403 });
});
test("server rejects inactive/missing users and validates period before data reads", async (t) => {
  let user: unknown = null;
  mockPrismaDelegate(t, "user", { findUnique: async () => user });
  const actor = { email: "test@example.com", role: "ADMIN" as const, name: "Test" };
  await assert.rejects(() => authorizeAdsCapacity(actor), { status: 403 });
  user = { status: "INACTIVE", role: { name: "ADMIN" } };
  await assert.rejects(() => authorizeAdsCapacity(actor), { status: 403 });
  user = { status: "ACTIVE", role: { name: "ADMIN" } };
  await assert.rejects(() => readAdsCapacityPlan(actor, { startDate: "2026-09-20", endDate: "2026-12-01" }, new Date("2026-09-20T12:00:00Z")), { status: 400 });
});
test("read-only adapter preserves swaps, sales, nesting, overrides and excludes full absences/staff/PROJECT/inactive", async (t) => {
  const employee = { id: "a", fullName: "A", wbLogin: "wb_a", roleTitle: "Agente", skill: "Material", operationalStatus: "Online", workStartTime: "08:00", workEndTime: "17:00", lob: { id: "ADS", name: "ADS" }, shift: { id: "s", name: "Manhã", startsAt: "08:00", endsAt: "17:00" }, supervisor: null };
  const base = { date: new Date("2026-09-20T00:00:00Z"), shift: employee.shift, startsAt: "10:00", endsAt: "14:00", lobId: null, employee };
  const kept = ["ESCALADO", "PRESENTE", "TROCA_APROVADA", "VENDA_FOLGA_APROVADA", "NESTING"];
  const excluded = ["FALTA", "FALTA_JUSTIFICADA", "FALTA_INJUSTIFICADA", "AFASTADO", "FOLGA", "FOLGA_APROVADA", "TREINAMENTO"];
  const rows = [...kept, ...excluded].map((status) => ({ ...base, id: status, status }));
  rows.push(...["Supervisor", "PROJECT", "Desligado", "Afastado", "Nesting"].map((kind) => ({ ...base, id: kind, status: "ESCALADO", employee: { ...employee, roleTitle: kind === "Supervisor" ? kind : "Agente", lob: { id: "ADS", name: kind === "PROJECT" ? kind : "ADS" }, operationalStatus: ["Desligado", "Afastado", "Nesting"].includes(kind) ? kind : "Online" } })));
  const db = mockPrismaDelegate(t, "schedule", { findMany: async (args) => { assert.equal(args.where.deletedAt, null); assert.equal(args.where.employee.deletedAt, null); return rows; } });
  const result = await readAdsCapacitySchedules({ startDate: base.date, endDate: base.date });
  assert.deepEqual(result.map((r) => r.id), [...kept, "Nesting"]);
  assert.equal(result[0].start, Date.parse("2026-09-20T10:00:00Z"));
  assert.equal(result[0].end, Date.parse("2026-09-20T14:00:00Z"));
  assert.equal(db.findMany.mock.callCount(), 1);
});

test("historical ADS work follows the slot while future ADS capacity also requires the current ADS roster", async (t) => {
  const shift = { id: "morning", name: "Manhã", startsAt: "08:00", endsAt: "17:00" };
  const employee = { id: "agent", fullName: "Agent", wbLogin: "wb_agent", roleTitle: "Agente", skill: "Material Queues", operationalStatus: "Ativo", lob: { id: "cec", name: "CEC" }, shift, supervisor: null };
  const base = { employee, shift, date: new Date("2026-09-23"), startsAt: "08:00", endsAt: "17:00", status: "ESCALADO" };
  const rows = [
    { ...base, id: "ads-slot-cec-registry", lobId: "ads" },
    { ...base, id: "cec-slot-ads-registry", lobId: "cec", employee: { ...employee, lob: { id: "ads", name: "ADS" } } },
    { ...base, id: "unknown-slot", lobId: "unknown", employee: { ...employee, lob: { id: "ads", name: "ADS" } } },
    { ...base, id: "ads-slot-ads-registry", lobId: "ads", employee: { ...employee, lob: { id: "ads", name: "ADS" } } },
    { ...base, id: "legacy-slot-ads-registry", lobId: null, employee: { ...employee, lob: { id: "ads", name: " ads " } } },
    { ...base, id: "legacy-slot-cec-registry", lobId: null },
    { ...base, id: "cec-slot-cec-registry", lobId: "cec" }
  ];
  const savedRows = structuredClone(rows);
  const scheduleReads = mockPrismaDelegate(t, "schedule", { findMany: async () => rows });
  const lobReads = mockPrismaDelegate(t, "lob", { findMany: async () => [{ id: "ads", name: "ADS" }, { id: "cec", name: "CEC" }] });
  const period = { startDate: base.date, endDate: base.date };
  const historical = await readAdsCapacitySchedules(period);
  assert.deepEqual(historical.map((row) => row.id), ["ads-slot-cec-registry", "ads-slot-ads-registry", "legacy-slot-ads-registry"]);
  const future = await readAdsCapacitySchedules(period, { currentAdsOnly: true });
  assert.deepEqual(future.map((row) => row.id), ["ads-slot-ads-registry", "legacy-slot-ads-registry"]);
  assert.deepEqual(await readAdsCapacitySchedules(period), historical, "future filtering must not change historical reads");
  assert.deepEqual(rows, savedRows, "neither registry nor saved slots are modified");
  assert.equal(scheduleReads.findMany.mock.callCount(), 3, "one schedule query per read");
  assert.equal(lobReads.findMany.mock.callCount(), 3, "one batched LOB lookup per read, not per slot");
});
