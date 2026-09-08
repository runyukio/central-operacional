import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { canManageBilling } from "./billing-permissions";
import { resolveBillingManualClosureWithoutFiscalInvoiceReason } from "./billing-fiscal-invoice";

function declaration(file: string, name: string) {
  const source = ts.createSourceFile(file, readFileSync(new URL(file, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, file.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const node = source.statements.find((item): item is ts.FunctionDeclaration => ts.isFunctionDeclaration(item) && item.name?.text === name);
  assert.ok(node, name); return { source, node };
}
const service = declaration("./billing-service.ts", "setEmployeeBillingInvoiceFinalized");
const compiled = ts.transpileModule(`const subject = ${service.node.getText(service.source).replace(/^export\s+/, "")}; subject;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;

// Exercise the real closure control flow with isolated persistence/calculation doubles.
// No real database, invoice upload, or Omie request can be made by these tests.
function scenario(wbLogin: string, role = "ADMIN") {
  const audits: any[] = [], saves: any[] = [];
  const employee = { id: "employee-from-db", wbLogin, operationalStatus: "Ativo" };
  const calculate = async (_employee: unknown, referenceMonth: string) => ({ employeeId: employee.id, referenceMonth, finalAmount: 1000, totalConsideredMinutes: 480 });
  const invoke = vm.runInNewContext(compiled, {
    findActiveUser: async () => ({ id: "actor", role }),
    requireBillingManagement: (user: { role: string }) => canManageBilling(user) ? null : { status: 403, error: "Denied" },
    normalizeBillingMonth: (value: string) => value, isBillingMonthAvailable: () => true,
    isBillableEmployee: () => true, ensureBillingCycle: async (month: string) => ({ id: `cycle-${month}`, status: "ABERTO" }),
    getBillingRates: async () => ({}), calculateEmployeeInvoice: calculate,
    resolveBillingManualClosureWithoutFiscalInvoiceReason,
    prisma: { employeeProfile: { findFirst: async () => employee }, billingEmployeeInvoice: { findUnique: async () => null },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ auditLog: { create: async (args: unknown) => audits.push(args) } }) },
    upsertEmployeeInvoice: async (cycle: string, invoice: unknown, options: unknown) => { saves.push({ cycle, invoice, options }); return { id: "saved", status: "FECHADO", finalAmount: 1000, totalConsideredMinutes: 480 }; },
    invoiceStatusLabel: (status: string) => status, AuditAction: { EDICAO: "EDICAO" },
    calculateBillingFiscalExpectedAmount: () => 1000, hasReusableBillingFiscalExtraction: () => false,
    BILLING_INVOICE_PAID_STATUS: "PAGO", Number, Date
  }) as (actor: unknown, input: { referenceMonth: string; employeeId: string; finalized: boolean }) => Promise<any>;
  return { audits, saves, run: (referenceMonth: string) => invoke({}, { referenceMonth, employeeId: employee.id, finalized: true }) };
}
test("manual closure allows only authorized August invoices and retains a scoped audit without Omie", async () => {
  for (const wb of ["wb_diorgenes", "wb_stephaniet"]) {
    const allowed = scenario(wb), result = await allowed.run("2026-08");
    assert.equal(result.data.status, "FECHADO"); assert.equal(result.data.omie.status, "NOT_SENT");
    assert.equal(allowed.saves.length, 1); assert.equal(allowed.saves[0].cycle, "cycle-2026-08");
    assert.equal(allowed.audits.length, 1);
    const audit = allowed.audits[0].data.newValue;
    assert.equal(audit.referenceMonth, "2026-08"); assert.equal(audit.fiscalInvoiceExemptionReason, "WB_MONTH_EXCEPTION");
    assert.equal(audit.fiscalInvoiceRequired, false); assert.equal(audit.omieSendRequired, false);
    for (const month of ["2026-07", "2026-09", "2027-08"]) {
      const denied = scenario(wb), result = await denied.run(month);
      assert.equal(result.status, 400); assert.match(result.error, /Anexe a nota fiscal/);
      assert.equal(denied.saves.length, 0); assert.equal(denied.audits.length, 0);
    }
  }
  const other = scenario("wb_outro"); assert.equal((await other.run("2026-08")).status, 400); assert.equal(other.saves.length, 0);
});
test("partner exception does not grant billing administration permissions", async () => {
  for (const role of ["COLABORADOR", "SUPERVISOR", "FINANCEIRO", "WFM"]) {
    const denied = scenario("wb_diorgenes", role);
    assert.equal((await denied.run("2026-08")).status, 403); assert.equal(denied.saves.length, 0);
  }
});
test("Billing detail uses the selected month to bypass the NF modal only for the point exception", () => {
  const component = declaration("../components/billing-page.tsx", "EmployeeBillingDetail");
  const variable = component.node.body!.statements.filter(ts.isVariableStatement).flatMap((s) => [...s.declarationList.declarations]).find((v) => v.name.getText(component.source) === "finalizesWithoutFiscalInvoice");
  assert.ok(variable?.initializer);
  const evaluate = new Function("invoice", "referenceMonth", "resolveBillingManualClosureWithoutFiscalInvoiceReason", `return (${variable.initializer.getText(component.source)});`);
  for (const wbLogin of ["wb_diorgenes", "wb_stephaniet", "wb_outro"]) for (const month of ["2026-08", "2026-09", "2027-08"]) {
    assert.equal(evaluate({ wbLogin, employeeStatus: "Ativo", finalAmount: 1000 }, month, resolveBillingManualClosureWithoutFiscalInvoiceReason), wbLogin !== "wb_outro" && month === "2026-08");
  }
});
