import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { BILLING_STAFF_RATE_DEFAULTS, resolveEmployeeBillingStaffRateKey, resolveEmployeeBillingStaffRateRule } from "./billing-rate-rules";
import { isAgentJobTitle, normalizeComparableJobTitle } from "./job-title-normalization";
import { cleanShiftName } from "./shift-display";

const source = ts.createSourceFile("billing-service.ts", readFileSync(new URL("./billing-service.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const names = new Set(["resolveHourlyRate", "getBillingRates", "isBillableEmployee", "isTrainingTerminationStatus", "isBillingEligibleContract", "isSpecialBillingSkill", "isPocSkill", "isAssistantSkill", "officialShiftBucket", "applyPocAgentRateModifier", "roundMoney", "calculateEmployeeInvoice", "buildAdjustmentBreakdown"]);
const functions = source.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && Boolean(node.name && names.has(node.name.text)));
assert.equal(functions.length, names.size);
const defaults = source.statements.filter(ts.isVariableStatement).flatMap(node => [...node.declarationList.declarations]).find(node => node.name.getText(source) === "DEFAULT_RATE_CONFIGS");
assert.ok(defaults?.initializer);
const compiled = ts.transpileModule(`const DEFAULT_RATE_CONFIGS = ${defaults.initializer.getText(source)};
${functions.map(node => node.getText(source)).join("\n")}
({ resolveHourlyRate, getBillingRates, isBillableEmployee, calculateEmployeeInvoice, DEFAULT_RATE_CONFIGS });`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

// Run the real billing selection and configuration functions without database or Omie IO.
function billing(configs: Array<{ key: string; value: number }> = []) {
  return vm.runInNewContext(compiled, {
    BILLING_STAFF_RATE_DEFAULTS, resolveEmployeeBillingStaffRateKey, resolveEmployeeBillingStaffRateRule,
    isAgentJobTitle, normalizeComparableJobTitle, cleanShiftName,
    POC_AGENT_HOURLY_RATE_MULTIPLIER: 1.15,
    prisma: {
      billingRateConfig: { findMany: async () => configs },
      workHourRecord: { findMany: async () => Array.from({ length: 28 }, (_, index) => ({ date: new Date(Date.UTC(2026, 9, index + 1)), effectiveHours: index === 27 ? 4 : 8 })) },
      schedule: { findMany: async () => [] }
    },
    monthPeriod: () => ({ start: new Date("2026-10-01"), end: new Date("2026-10-31") }),
    BILLABLE_WORK_HOUR_STATUSES: ["OK"], PROJECTABLE_SCHEDULE_STATUSES: new Set(["PRESENTE"]),
    isMonthlyAdvanceReferenceMonthAvailable: () => false,
    dateKey: (date: Date) => date.toISOString().slice(0, 10),
    dateInput: (date: Date) => date.toISOString().slice(0, 10),
    defaultInvoiceStatusForCycle: () => "EM_PREVISAO", invoiceStatusLabel: (value: string) => value,
    mapBillingFiscalInvoice: () => null
  });
}

test("Gerente PJ becomes billable and uses its exact rate regardless of operational skill", async () => {
  const subject = billing();
  const rates = await subject.getBillingRates();
  for (const shift of ["Manhã", "Tarde", "Noite"]) {
    for (const skill of ["Manager", "Material Queues", "Bilingual", "RA", "Assistant", "RTA", ""]) {
      const employee = { roleTitle: "Gerente", skill, contractType: "PJ", operationalStatus: "Ativo", shift: { name: shift } };
      assert.equal(subject.isBillableEmployee(employee), true);
      const rate = subject.resolveHourlyRate(employee, rates);
      assert.equal(rate.hourlyRate, 102.27272727);
      assert.match(rate.billingRule, /^CARGO_manager_/);
      assert.equal(rate.billingRateSource, "Cargo/Função Gerente");
    }
  }
  assert.equal(subject.isBillableEmployee({ roleTitle: "Gerente", skill: "Manager", contractType: "CLT" }), false);
  assert.equal(subject.isBillableEmployee({ roleTitle: "Outro", skill: "Manager", contractType: "PJ" }), false);
});

test("the real invoice calculator charges 220 approved hours at the manager rate as R$ 22,500.00", async () => {
  const subject = billing();
  const employee = { id: "manager", fullName: "Gerente", roleTitle: "Gerente", skill: "Manager", contractType: "PJ", shift: { name: "Manhã" } };
  const invoice = await subject.calculateEmployeeInvoice(employee, "2026-10", await subject.getBillingRates(), null);
  assert.equal(invoice.hourlyRate, 102.27272727);
  assert.equal(invoice.approvedMinutes, 13200);
  assert.equal(invoice.projectedMinutes, 0);
  assert.equal(invoice.grossAmount, 22500);
  assert.equal(invoice.finalAmount, 22500);
  assert.equal(invoice.billingRule, "CARGO_manager_MANHA");
});

test("Gerente configuration is editable per shift with eight decimal places", async () => {
  const subject = billing([{ key: "STAFF_MANAGER_DAY_RATE", value: 103.12345678 }, { key: "STAFF_MANAGER_NIGHT_RATE", value: 104.12345678 }]);
  const rates = await subject.getBillingRates();
  assert.equal(subject.resolveHourlyRate({ roleTitle: "Gerente", shift: { name: "Manhã" } }, rates).hourlyRate, 103.12345678);
  assert.equal(subject.resolveHourlyRate({ roleTitle: "Gerente", shift: { name: "Noite" } }, rates).hourlyRate, 104.12345678);
  const configs = subject.DEFAULT_RATE_CONFIGS.filter((config: { skillKey?: string }) => config.skillKey === "manager");
  assert.equal(configs.length, 2);
  assert.ok(configs.every((config: { group: string; displayName: string; value: number }) => config.group === "STAFF" && config.displayName === "Gerente" && config.value === 102.27272727));
});

test("existing agent, bilingual, RA and staff rules retain their rates", async () => {
  const subject = billing();
  const rates = await subject.getBillingRates();
  for (const [roleTitle, skill, expected] of [["Agente", "Material Queues", 11.36], ["Agente", "Bilingual", 62.5], ["Agente", "RA", 14.2], ["Outro", "RTA", 17.05], ["Financeiro", "", 34.09090909]] as const) {
    const result = subject.resolveHourlyRate({ roleTitle, skill, shift: { name: "Manhã" } }, rates);
    assert.equal(result.hourlyRate, expected);
  }
  assert.equal(subject.resolveHourlyRate({ roleTitle: "Gerente", skill: "Manager", shift: null }, rates).hourlyRate, 0);
});
