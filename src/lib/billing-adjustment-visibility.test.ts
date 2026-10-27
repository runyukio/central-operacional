import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { canManageBilling } from "./billing-permissions";
import { normalizeComparableJobTitle } from "./job-title-normalization";

const source = ts.createSourceFile("billing-service.ts", readFileSync(new URL("./billing-service.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
function loadFunctions(names: string[], context: Record<string, unknown>) {
  const declarations = names.map((name) => {
    const node = source.statements.find((item): item is ts.FunctionDeclaration => ts.isFunctionDeclaration(item) && item.name?.text === name);
    assert.ok(node, name);
    return node.getText(source).replace(/^export\s+/, "");
  });
  return vm.runInNewContext(ts.transpileModule(`${declarations.join("\n")}\n({${names.join(",")}});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText, context);
}

// Exercise actual service functions without database, storage or Omie IO.
function visibilityScenario(role: string | null = "ADMIN", exists = true) {
  const row = { id: "adjustment", hiddenAt: null as Date | null, amount: 2500, type: "Correção", deletedAt: null };
  const writes: any[] = [], audits: any[] = [];
  let transactions = 0;
  const tx = {
    billingAdjustment: {
      findFirst: async ({ where }: any) => { assert.equal(where.deletedAt, null); return exists ? { ...row } : null; },
      findMany: async ({ where }: any) => {
        assert.equal("hiddenAt" in where, false, "a lista deve permitir consultar os ocultos");
        return [{ ...row }];
      },
      update: async ({ data }: any) => { writes.push(data); Object.assign(row, data); return row; }
    },
    auditLog: { create: async ({ data }: any) => { audits.push(data); return data; } }
  };
  const { setBillingAdjustmentVisibility: run, listCycleAdjustments: list } = loadFunctions([
    "setBillingAdjustmentVisibility", "requireBillingManagement", "billingPermissionIdentity", "listCycleAdjustments", "mapAdjustment"
  ], {
    findActiveUser: async () => role ? { id: "actor", role: { name: role } } : null,
    canManageBilling, AuditAction: { EDICAO: "EDICAO" },
    formatDateTime: () => "27/10/2026 11:53",
    prisma: { billingAdjustment: tx.billingAdjustment, $transaction: async (fn: (value: unknown) => Promise<unknown>) => { transactions++; return fn(tx); } }
  });
  return { row, writes, audits, list: () => list("cycle"), transactions: () => transactions, run: (hidden: unknown, id = row.id) => run({ email: "admin@example.com" }, { id, hidden }) };
}

test("oculta e reexibe com auditoria, alterando somente a visibilidade", async () => {
  const state = visibilityScenario();
  assert.equal((await state.run(true)).data.hidden, true);
  assert.ok(state.row.hiddenAt);
  assert.deepEqual(Object.keys(state.writes[0]), ["hiddenAt"]);
  assert.equal(state.row.amount, 2500);
  assert.equal((await state.list())[0].hidden, true, "nova leitura mantém a linha oculta");
  assert.equal(state.row.deletedAt, null);
  assert.equal(state.audits[0].actorId, "actor");
  assert.equal(state.audits[0].previousValue.hidden, false);
  assert.equal(state.audits[0].newValue.hidden, true);
  await state.run(true);
  assert.equal(state.writes.length, 1, "repetir ocultação não altera nem audita de novo");
  assert.equal((await state.run(false)).data.hidden, false);
  assert.equal(state.row.hiddenAt, null);
  assert.equal((await state.list())[0].hidden, false);
  assert.equal(state.audits[1].newValue.hidden, false);
  assert.equal(state.row.amount, 2500);
});

test("exige gestão de Billing e rejeita IDs ausentes e visibilidade inválida", async () => {
  for (const role of [null, "COLABORADOR", "SUPERVISOR", "FINANCEIRO", "WFM"]) {
    const state = visibilityScenario(role);
    assert.equal((await state.run(true)).status, role ? 403 : 401);
    assert.equal(state.transactions(), 0);
  }
  const state = visibilityScenario();
  for (const invalid of ["true", "false", 0, 1, null, undefined]) {
    assert.equal((await state.run(invalid)).status, 400);
  }
  assert.equal((await state.run(true, " ")).status, 400);
  assert.equal(state.transactions(), 0);
  const missing = visibilityScenario("ADMIN", false);
  assert.equal((await missing.run(true)).status, 404);
  assert.equal(missing.writes.length, 0);
});

test("ajuste de R$ 2.500 permanece no cálculo individual e consolidado quando oculto", async () => {
  const date = new Date("2026-10-01T12:00:00Z");
  const employee = { id: "employee", fullName: "Ana Paula", wbLogin: "wb_anapaula", lobId: "lob" };
  const adjustment = { id: "adjustment", employeeId: employee.id, type: "Correção", amount: 2500, hiddenAt: null as Date | null };
  const record = { employeeId: employee.id, date, effectiveHours: 8, status: "OK" };
  const context = {
    prisma: {
      workHourRecord: { findMany: async () => [record] }, schedule: { findMany: async () => [] },
      employeeSensitiveData: { findMany: async () => [] },
      billingEmployeeInvoice: { findUnique: async () => null, findMany: async () => [] },
      billingAdjustment: { findMany: async ({ where }: any) => {
        assert.equal(where.deletedAt, null);
        assert.equal("hiddenAt" in where, false, "ocultação não deve filtrar o cálculo");
        return [adjustment];
      } }
    },
    listBillingEmployees: async () => [employee], logPerformance: () => {},
    monthPeriod: () => ({ start: date, end: date }), isMonthlyAdvanceReferenceMonthAvailable: () => false,
    BILLABLE_WORK_HOUR_STATUSES: ["OK"], PROJECTABLE_SCHEDULE_STATUSES: new Set(["PRESENTE"]),
    resolveHourlyRate: () => ({ hourlyRate: 10 }), normalizeComparableJobTitle,
    roundMoney: (value: number) => Math.round(value * 100) / 100,
    dateKey: () => "2026-10-01", dateInput: () => "2026-10-01", cleanShiftName: (value: string) => value,
    defaultInvoiceStatusForCycle: () => "ABERTO", invoiceStatusLabel: (value: string) => value, mapBillingFiscalInvoice: () => null
  };
  const { calculateEmployeeInvoice, buildBillingInvoicesReadModel } = loadFunctions([
    "calculateEmployeeInvoice", "buildBillingInvoicesReadModel", "buildAdjustmentBreakdown", "groupBy"
  ], context);
  for (const hiddenAt of [null, date]) {
    adjustment.hiddenAt = hiddenAt;
    const individual = await calculateEmployeeInvoice(employee, "2026-10", {}, "cycle");
    const [consolidated] = await buildBillingInvoicesReadModel("2026-10", {}, { id: "cycle", status: "ABERTO" }, {}, { includeHourDetails: false });
    for (const invoice of [individual, consolidated]) {
      assert.equal(invoice.grossAmount, 80);
      assert.equal(invoice.correctionAmount, 2500);
      assert.equal(invoice.finalAmount, 2580);
    }
  }
});
