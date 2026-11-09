import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { BILLING_REFERENCE_MONTH_CONFIG_KEY, DEFAULT_BILLING_REFERENCE_MONTH } from "./billing-reference-month";
import { getDefaultBillingReferenceMonth, resolveBillingReferenceMonth } from "./billing-reference-month-service";
import { getBillingDashboard, getEmployeeBillingPreview, getMyBillingInvoice } from "./billing-service";
import { updateSystemSettings } from "./settings-service";
import { prisma } from "./prisma";

type Row = Record<string, any>;
const actor = { name: "Admin", email: "admin@example.test", role: "ADMIN" as const };

// In-memory persistence boundary; exercise the real settings and billing services.
function fixture(t: TestContext, initial?: unknown) {
  let saved: unknown = initial;
  const audits: Row[] = [];
  const cycleMonths: string[] = [];
  const user: Row = { id: "admin", status: "ACTIVE", deletedAt: null, role: { name: "ADMIN" }, employeeProfile: { id: "employee", contractType: "PJ" } };
  for (const model of ["user", "systemConfig", "auditLog", "billingCycle", "employeeProfile", "billingRateConfig"] as const) {
    const original = prisma[model];
    (prisma as any)[model] = {};
    t.after(() => { (prisma as any)[model] = original; });
  }
  (prisma.user as any).findUnique = async () => user;
  (prisma.systemConfig as any).findUnique = async ({ where }: Row) => {
    assert.equal(where.key, BILLING_REFERENCE_MONTH_CONFIG_KEY);
    return saved === undefined ? null : { key: where.key, value: saved };
  };
  (prisma.systemConfig as any).upsert = async ({ create, update }: Row) => {
    assert.equal(create.key, BILLING_REFERENCE_MONTH_CONFIG_KEY);
    saved = update.value;
    return { ...create, value: saved };
  };
  (prisma.auditLog as any).create = async ({ data }: Row) => { audits.push(data); return data; };
  t.mock.method(prisma, "$transaction", async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma));
  (prisma.billingCycle as any).findUnique = async ({ where }: Row) => {
    cycleMonths.push(where.referenceMonth);
    throw new Error("stop before invoice calculation");
  };
  (prisma.employeeProfile as any).findFirst = async () => ({ id: "employee", roleTitle: "Agente", contractType: "PJ", operationalStatus: "Ativo" });
  (prisma.billingRateConfig as any).findMany = async () => [];
  return { user, audits, cycleMonths, setConfig: (value: unknown) => { saved = value; }, get saved() { return saved; } };
}

test("new installations open November 2026; invalid stored defaults fall back safely", async (t) => {
  const f = fixture(t);
  assert.equal(DEFAULT_BILLING_REFERENCE_MONTH, "2026-11");
  for (const value of [undefined, null, "", {}, "2026-00", "2026-13", "2026-05", "2026-1"]) {
    f.setConfig(value);
    assert.equal(await getDefaultBillingReferenceMonth(), "2026-11");
  }
});

test("an admin can persist a new default with an audit; invoice and profile use it on the next read", async (t) => {
  const f = fixture(t);
  for (const month of ["2026-12", "2027-01"]) {
    const result = await updateSystemSettings(actor, { type: "billingReferenceMonth", value: month });
    assert.ok("success" in result && result.success);
    assert.equal(f.saved, month);
    assert.equal(await getDefaultBillingReferenceMonth(), month);
    assert.equal(await resolveBillingReferenceMonth(), month);
    await assert.rejects(getEmployeeBillingPreview("employee"), /stop before invoice calculation/);
    await assert.rejects(getMyBillingInvoice(actor), /stop before invoice calculation/);
    await assert.rejects(getBillingDashboard(actor), /stop before invoice calculation/);
    assert.deepEqual(f.cycleMonths.slice(-3), [month, month, month]);
  }
  assert.equal(f.audits.length, 2);
  assert.ok(f.audits.every((audit) => audit.actorId === "admin" && audit.entityId === BILLING_REFERENCE_MONTH_CONFIG_KEY));
});

test("historical selections take priority without consulting the default", async (t) => {
  const f = fixture(t, "2026-11");
  t.mock.method(prisma.systemConfig, "findUnique", async () => { throw new Error("default should not be read"); });
  for (const month of ["2026-06", "2026-10"]) {
    assert.equal(await resolveBillingReferenceMonth(month), month);
    await assert.rejects(getEmployeeBillingPreview("employee", month), /stop before invoice calculation/);
    await assert.rejects(getMyBillingInvoice(actor, month), /stop before invoice calculation/);
    await assert.rejects(getBillingDashboard(actor, { referenceMonth: month }), /stop before invoice calculation/);
    assert.deepEqual(f.cycleMonths.slice(-3), [month, month, month]);
  }
});

test("invalid settings do not change the default or create audit entries", async (t) => {
  const f = fixture(t, "2026-11");
  for (const value of [undefined, "", "2026-00", "2026-13", "2026-05", "2026-1", "2026-11-01"]) {
    const result = await updateSystemSettings(actor, { type: "billingReferenceMonth", value });
    assert.ok("error" in result);
    assert.equal(f.saved, "2026-11");
  }
  assert.equal(f.audits.length, 0);
});

test("non-admin and inactive accounts cannot change the operational invoice month", async (t) => {
  const f = fixture(t, "2026-11");
  for (const role of ["COLABORADOR", "SUPERVISOR", "FINANCEIRO", "GESTOR"]) {
    f.user.role = { name: role };
    assert.ok("error" in await updateSystemSettings(actor, { type: "billingReferenceMonth", value: "2026-12" }));
  }
  f.user.role = { name: "ADMIN" };
  f.user.status = "INACTIVE";
  assert.ok("error" in await updateSystemSettings(actor, { type: "billingReferenceMonth", value: "2026-12" }));
  assert.equal(f.saved, "2026-11");
  assert.equal(f.audits.length, 0);
});
