import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { billingBulkInvoiceStatus, billingBulkTargets, parseBillingStatusSelection } from "./billing-bulk-status";
import { canManageBilling } from "./billing-permissions";

const source = ts.createSourceFile("billing-service.ts", readFileSync(new URL("./billing-service.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const subject = source.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "updateFilteredBillingInvoiceStatus")!;
const compiled = ts.transpileModule(`const subject = ${subject.getText(source).replace(/^export\s+/, "")}; subject;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;

type Invoice = { id: string; employeeId: string; status: string };
class PersistenceConflict extends Error { constructor(public code: string) { super(code); } }

function scenario(options: { role?: string; model?: Invoice[]; current?: Invoice[]; failAt?: number; conflict?: string } = {}) {
  const initial = options.model ?? [
    { id: "invoice-a", employeeId: "a", status: "EM_PREVISAO" },
    { id: "invoice-b", employeeId: "b", status: "EM_PREVISAO" },
    { id: "invoice-outside", employeeId: "outside", status: "EM_PREVISAO" }
  ];
  let committed: any[] = [], audits: any[] = [], reads = 0;
  const invoke = vm.runInNewContext(compiled, {
    findActiveUser: async () => ({ id: "admin", role: options.role ?? "ADMIN" }),
    requireBillingManagement: (user: { role: string }) => canManageBilling(user) ? null : { error: "Denied", status: 403 },
    normalizeBillingMonth: (value: string) => value,
    isBillingMonthAvailable: (value: string) => value >= "2026-06",
    billingUnavailable: () => ({ error: "Unavailable", status: 400 }),
    parseBillingStatusSelection, billingBulkTargets, billingBulkInvoiceStatus,
    ensureBillingCycle: async () => ({ id: "cycle", status: "ABERTO" }),
    getBillingRates: async () => ({}),
    buildBillingInvoicesReadModel: async () => { reads++; return initial; },
    invoiceStatusLabel: (value: string) => value,
    Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" }, PrismaClientKnownRequestError: PersistenceConflict },
    AuditAction: { EDICAO: "EDICAO" },
    prisma: {
      $transaction: async (fn: (tx: unknown) => Promise<unknown>, settings: { isolationLevel: string }) => {
        assert.equal(settings.isolationLevel, "Serializable");
        if (options.conflict) throw new PersistenceConflict(options.conflict);
        const saves: any[] = [], logs: any[] = [];
        const tx = {
          saves,
          billingEmployeeInvoice: { findMany: async ({ where }: any) => (options.current ?? initial).filter((row) => row.id && where.employeeId.in.includes(row.employeeId)) },
          auditLog: { create: async (value: any) => logs.push(value.data) }
        };
        const result = await fn(tx);
        committed = saves; audits = logs;
        return result;
      }
    },
    upsertEmployeeInvoice: async (cycle: string, invoice: Invoice, extra: any, tx: any) => {
      if (options.failAt === tx.saves.length + 1) throw new Error("Write failure");
      tx.saves.push({ cycle, employeeId: invoice.employeeId, ...extra });
      return { id: invoice.id || `new-${invoice.employeeId}`, status: extra.status };
    }
  }) as (actor: unknown, input: any) => Promise<any>;
  return {
    run: (status = "FINALIZADO_CONFERENCIA", invoices: unknown = initial.slice(0, 2).map(({ employeeId, status }) => ({ employeeId, status })), month = "2026-10") => invoke({}, { referenceMonth: month, status, invoices }),
    get saved() { return committed; }, get audits() { return audits; }, get reads() { return reads; }
  };
}

test("release and close persist only the confirmed filtered partners, with individual audits", async () => {
  for (const action of ["FINALIZADO_CONFERENCIA", "FECHADO"] as const) {
    const flow = scenario();
    const result = await flow.run(action);
    assert.equal(result.data.updatedCount, 2);
    assert.equal(result.data.status, billingBulkInvoiceStatus(action));
    assert.deepEqual(flow.saved.map((row) => row.employeeId), ["a", "b"]);
    assert.ok(flow.saved.every((row) => row.status === billingBulkInvoiceStatus(action)));
    assert.ok(flow.saved.every((row) => row.clearEmployeeApproval === (action === "FINALIZADO_CONFERENCIA")));
    assert.equal(flow.audits.length, 2);
    assert.ok(flow.audits.every((row) => row.entity === "BillingEmployeeInvoice" && row.newValue.referenceMonth === "2026-10"));
  }
});

test("empty, missing, malformed or duplicate selection never falls back to the whole month", async () => {
  for (const selection of [null, [], {}, [{ employeeId: "a" }], [{ employeeId: "a", status: "EM_PREVISAO" }, { employeeId: "a", status: "EM_PREVISAO" }]]) {
    const flow = scenario();
    assert.equal((await flow.run("FECHADO", selection)).status, 400);
    assert.equal(flow.reads, 0);
    assert.equal(flow.saved.length, 0);
  }
});

test("restricted actors, invalid actions and unavailable months cannot mutate invoices", async () => {
  for (const role of ["SUPERVISOR", "COLABORADOR", "FINANCEIRO", "WFM"]) {
    const flow = scenario({ role });
    assert.equal((await flow.run()).status, 403);
    assert.equal(flow.reads, 0);
  }
  for (const action of ["EM_REVISAO", "PAGO", "", "ABERTO"]) assert.equal((await scenario().run(action)).status, 400);
  assert.equal((await scenario().run("FECHADO", [{ employeeId: "a", status: "EM_PREVISAO" }], "2026-05")).status, 400);
});

test("changed statuses, removed partners and concurrent changes abort without partial updates", async () => {
  const selection = [{ employeeId: "a", status: "EM_PREVISAO" }, { employeeId: "b", status: "EM_PREVISAO" }];
  const flows = [
    scenario({ model: [{ id: "invoice-a", employeeId: "a", status: "PAGO" }] }),
    scenario({ current: [{ id: "invoice-a", employeeId: "a", status: "EM_PREVISAO" }, { id: "invoice-b", employeeId: "b", status: "PAGO" }] }),
    scenario({ conflict: "P2034" }), scenario({ conflict: "P2002" })
  ];
  for (const flow of flows) {
    assert.equal((await flow.run("FECHADO", selection)).status, 409);
    assert.equal(flow.saved.length, 0);
    assert.equal(flow.audits.length, 0);
  }
  const failure = scenario({ failAt: 2 });
  await assert.rejects(() => failure.run("FECHADO"), /Write failure/);
  assert.equal(failure.saved.length, 0);
  assert.equal(failure.audits.length, 0);
});

test("virtual invoices are persisted and finalized invoices cannot be reopened or marked unpaid", async () => {
  const virtual = scenario({ model: [{ id: "", employeeId: "a", status: "EM_PREVISAO" }] });
  assert.equal((await virtual.run()).data.updatedCount, 1);
  for (const status of ["FECHADO", "PAGO"]) {
    const flow = scenario({ model: [{ id: "a", employeeId: "a", status }] });
    assert.equal((await flow.run()).status, 409);
    assert.equal((await flow.run("FECHADO")).status, 409);
    assert.equal(flow.saved.length, 0);
  }
});

test("confirmation selects all filtered pages and excludes invoices already completed or already released", () => {
  const page = ts.createSourceFile("billing-page.tsx", readFileSync(new URL("../components/billing-page.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler: ts.FunctionDeclaration | undefined;
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "confirmFilteredInvoiceStatus") handler = node;
    ts.forEachChild(node, visit);
  }
  visit(page);
  assert.ok(handler);
  const invoices = Array.from({ length: 30 }, (_, i) => ({ employeeId: String(i), status: i === 0 ? "PAGO" : i === 1 ? "FECHADO" : i === 2 ? "DISPONIVEL_APROVACAO" : "EM_PREVISAO" }));
  let pending: any;
  const compiledHandler = ts.transpileModule(`const handler = ${handler.getText(page)}; handler;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const open = vm.runInNewContext(compiledHandler, {
    data: { referenceMonth: "2026-10", monthLabel: "Outubro/2026", invoices },
    loading: false, saving: false, searchInput: "", search: "", billingBulkTargets,
    setPendingBulkStatus: (value: unknown) => { pending = value; }
  });
  open("FINALIZADO_CONFERENCIA");
  assert.equal(pending.invoices.length, 27);
  assert.equal(pending.filteredCount, 30);
  assert.equal(pending.invoices.at(-1).employeeId, "29");
  open("FECHADO");
  assert.equal(pending.invoices.length, 28);
  assert.ok(!page.text.includes("Marcar em revisão"));
});
