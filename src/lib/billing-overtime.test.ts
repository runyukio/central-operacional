import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { captureOvertimeOutcome, type OvertimeSource } from "./work-hours-overtime";

const file = new URL("./billing-service.ts", import.meta.url);
const sourceFile = ts.createSourceFile("billing-service.ts", readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
const declaration = sourceFile.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "calculateEmployeeInvoice");
assert.ok(declaration);
const compiled = ts.transpileModule(`const subject = ${declaration.getText(sourceFile)}; subject;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;

// The real invoice calculator, isolated from database and Omie IO. The same day's
// schedule must never add projected hours on top of its capped/approved record.
test("invoice considera 8h enquanto pendente/recusado e 9h depois da aprovação, sem duplicar projeção", async () => {
  const date = new Date("2026-10-01"), origin: OvertimeSource = {
    reconciliationKey: "agent:2026-10-01:slot", scheduleId: "slot", plannedStart: "08:00", plannedEnd: "17:00",
    sourceDurationMs: 8.5 * 3_600_000, operationalMs: 9 * 3_600_000,
    rule: "STANDARD", ruleLabel: "Captura + 0:30", classification: "ADS"
  };
  const pending = captureOvertimeOutcome(origin);
  for (const state of ["PENDING", "REJECTED", "APPROVED"]) {
    const outcome = captureOvertimeOutcome(origin, { ...pending, status: state });
    const record = { date, actualHours: 9, effectiveHours: outcome.effectiveHours, status: "OK" };
    const calculate = vm.runInNewContext(compiled, {
      prisma: { workHourRecord: { findMany: async (args: any) => { assert.equal(args.select.effectiveHours, true); return [record]; } },
        schedule: { findMany: async () => [{ date, status: "PRESENTE", shift: { name: "Manhã" } }] } },
      monthPeriod: () => ({ start: date, end: new Date("2026-10-31") }), isMonthlyAdvanceReferenceMonthAvailable: () => false,
      BILLABLE_WORK_HOUR_STATUSES: ["OK", "DIVERGENT"], PROJECTABLE_SCHEDULE_STATUSES: new Set(["PRESENTE"]),
      resolveHourlyRate: () => ({ hourlyRate: 10 }), dateKey: (day: Date) => day.toISOString().slice(0, 10),
      dateInput: (day: Date) => day.toISOString().slice(0, 10), cleanShiftName: (name: string) => name,
      roundMoney: (value: number) => Math.round(value * 100) / 100,
      isScheduleWithinEmployeeBillingWindow: () => true,
      buildAdjustmentBreakdown: () => ({ manualAdvanceAmount: 0, campaignAmount: 0, bonusAmount: 0, discountAmount: 0, correctionAmount: 0, otherAdjustmentAmount: 0, types: [] }),
      defaultInvoiceStatusForCycle: () => "ABERTO", invoiceStatusLabel: (value: string) => value, mapBillingFiscalInvoice: () => null
    });
    const invoice = await calculate({ id: "agent", fullName: "Agent", wbLogin: "wb_agent", lob: { name: "ADS" }, shift: { name: "Manhã" } }, "2026-10", {}, null);
    assert.equal(invoice.approvedMinutes, state === "APPROVED" ? 540 : 480);
    assert.equal(invoice.projectedMinutes, 0); assert.equal(invoice.projectedDays, 0);
    assert.equal(invoice.grossAmount, state === "APPROVED" ? 90 : 80);
    assert.equal(invoice.finalAmount, invoice.grossAmount); assert.equal(invoice.hourDetails.length, 1);
  }
});
