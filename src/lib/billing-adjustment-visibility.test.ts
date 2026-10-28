import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
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

test("listas excluem o ajuste oculto no servidor e preservam os demais", async () => {
  const rows = [
    { id: "hidden", amount: 2500, hiddenAt: new Date(), employeeId: "ana" },
    { id: "same-value", amount: 2500, hiddenAt: null, employeeId: "ana" },
    { id: "other", amount: 100, hiddenAt: null, employeeId: "other" }
  ];
  const queries: any[] = [];
  const { listCycleAdjustments, listEmployeeBillingAdjustmentDetails } = loadFunctions([
    "listCycleAdjustments", "listEmployeeBillingAdjustmentDetails", "mapAdjustment"
  ], {
    prisma: { billingAdjustment: { findMany: async ({ where }: any) => {
      queries.push(where);
      assert.equal(where.deletedAt, null);
      assert.equal(where.hiddenAt, null);
      return rows.filter((row) => row.hiddenAt === where.hiddenAt);
    } } },
    formatDateTime: () => "28/10/2026"
  });
  for (const list of [
    () => listCycleAdjustments("cycle"),
    () => listCycleAdjustments("cycle", new Set(["ana"])),
    () => listEmployeeBillingAdjustmentDetails("cycle", "ana", "lob")
  ]) {
    const result = await list();
    assert.deepEqual(Array.from(result, (row: any) => row.id), ["same-value", "other"]);
    assert.equal(rows[0].amount, 2500);
  }
  assert.equal(queries[1].OR[0].employeeId.in[0], "ana", "preserva a restrição do time");
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
