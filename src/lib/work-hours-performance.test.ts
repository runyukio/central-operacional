import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createClientRequestGate } from "./client-request-gate";
import { prisma } from "./prisma";
import { mockPrismaDelegate } from "./prisma-test-delegate";
import { listOperationalWorkHours, workHourReadData } from "./work-hours-service";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const actor = { email: "performance@example.test", name: "WFM", role: "WFM" as const };

test("hours list overlaps its summary with page and capture reads, and computes captures only for the bounded visible page", async (t) => {
  const date = new Date("2026-10-01T00:00:00Z");
  const record = {
    id: "visible", employeeId: "agent", wbLogin: "wb", date,
    status: "OK", actualHours: 8, effectiveHours: 8, differenceMinutes: 0,
    createdAt: date, updatedAt: date, schedule: { status: "ESCALADO", startsAt: "08:00", endsAt: "17:00" },
    employee: { fullName: "Agent", lob: { name: "ADS" }, shift: { name: "Manhã" } }, adjustments: []
  };
  const page = deferred<typeof record[]>();
  const summary = deferred<[]>();
  const summaryStarted = deferred<void>();
  const capturesStarted = deferred<void>();
  const user = mockPrismaDelegate(t, "user", { findUnique: async () => ({ id: "wfm", name: "WFM", status: "ACTIVE", role: { name: "WFM" } }) });
  mockPrismaDelegate(t, "workHourRecord", {
    findMany: async (query: any) => {
      assert.equal(query.take, 50);
      assert.equal(query.skip, 50);
      assert.equal(query.where.employee.lob.name, "ADS");
      return page.promise;
    },
    count: async () => 201,
    groupBy: async () => { summaryStarted.resolve(); return summary.promise; }
  });
  mockPrismaDelegate(t, "workHourAdjustmentRequest", { groupBy: async () => [] });
  mockPrismaDelegate(t, "workHourOvertimeReview", { aggregate: async () => ({ _sum: { excessHours: 0 }, _count: { _all: 0 } }) });
  t.mock.method(prisma, "$transaction", async (queries: Promise<unknown>[]) => Promise.all(queries));
  t.mock.method(workHourReadData, "capturedHours", async (requests: Parameters<typeof workHourReadData.capturedHours>[0]) => {
    assert.deepEqual(requests, [{ key: "visible", employeeId: "agent", wbLogin: "wb", shiftDate: date }]);
    capturesStarted.resolve();
    return new Map([["visible", 7.5]]);
  });
  const pending = listOperationalWorkHours(actor, { startDate: "2026-10-01", endDate: "2026-10-31", lob: "ADS", page: 2 });
  await summaryStarted.promise;
  // The summary starts without waiting for the visible page, and captures do
  // not wait for the summary to finish once that page arrives.
  page.resolve([record]);
  await capturesStarted.promise;
  summary.resolve([]);
  const result = await pending;
  assert.ok("data" in result && result.data);
  assert.equal(result.data[0].capturedHours, 7.5);
  assert.equal(result.pagination.total, 201);
  assert.equal(result.pagination.page, 2);
  const projection = user.findUnique.mock.calls[0].arguments[0].select;
  assert.deepEqual(projection.employeeProfile, { select: { id: true } });
  assert.equal(projection.passwordHash, undefined);
});

function pageFunction(name: string, context: Record<string, unknown>) {
  const file = new URL("../components/modules/work-hours-page.tsx", import.meta.url);
  const source = ts.createSourceFile("work-hours-page.tsx", readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = source.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "WorkHoursPage")!;
  const declaration = component.body!.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === name)!;
  const compiled = ts.transpileModule(`(${declaration.getText(source)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return vm.runInNewContext(compiled, { URLSearchParams, Error, ...context }) as (...args: any[]) => Promise<void>;
}

test("committed review updates its row and releases saving before the background period refresh completes", async () => {
  const refresh = deferred<void>();
  let saving = false, open = true, message = "", refreshes = 0;
  let rows = [{ id: "reviewed", effectiveHours: 7, capturedHours: 6.5 }, { id: "other", effectiveHours: 8, capturedHours: 8 }];
  const filters = { pendingOnly: true };
  const latestFilters = { pendingOnly: false, collaborator: "other agent" };
  const appliedHoursView = { current: { page: 2, filters: filters as Record<string, unknown> } };
  const decision = deferred<{ data: { record: { id: string; effectiveHours: number; capturedHours: number } } }>();
  const review = pageFunction("reviewAdjustment", {
    selectedRow: { id: "reviewed", adjustmentId: "adjustment" }, savingAdjustment: false,
    adjustmentAction: "approve", adjustmentForm: {}, pagination: { page: 2 }, filters, appliedHoursView,
    setSavingAdjustment: (value: boolean) => { saving = value; },
    setShowReview: (value: boolean) => { open = value; },
    setMessage: (value: string) => { message = value; },
    setRows: (update: (current: typeof rows) => typeof rows) => { rows = update(rows); },
    apiJson: async (url: string, options: any) => {
      assert.equal(url, "/api/work-hours/adjustments");
      assert.equal(options.method, "PATCH");
      return decision.promise;
    },
    loadWorkHours: (page: number, appliedFilters: unknown, background: boolean) => {
      refreshes++;
      assert.equal(page, 3);
      assert.equal(appliedFilters, latestFilters);
      assert.equal(background, true);
      return refresh.promise;
    }
  });
  const pending = review();
  // A filter/page can be applied while the server is processing the decision.
  // Its completed mutation must refresh the current view, not the old closure.
  appliedHoursView.current = { page: 3, filters: latestFilters };
  decision.resolve({ data: { record: { id: "reviewed", effectiveHours: 8, capturedHours: 0 } } });
  await pending;
  assert.equal(saving, false);
  assert.equal(open, false);
  assert.match(message, /Ajuste aprovado/);
  assert.equal(rows[0].effectiveHours, 8);
  assert.equal(rows[0].capturedHours, 6.5);
  assert.equal(rows[1].effectiveHours, 8);
  assert.equal(refreshes, 1);
  refresh.resolve();
});

test("a rejected review request keeps its dialog and rows, and never starts a background read", async () => {
  let saving = false, message = "";
  await pageFunction("reviewAdjustment", {
    selectedRow: { adjustmentId: "adjustment" }, savingAdjustment: false,
    adjustmentAction: "approve", adjustmentForm: {},
    setSavingAdjustment: (value: boolean) => { saving = value; }, setMessage: (value: string) => { message = value; },
    setRows: () => { assert.fail("must not patch uncommitted data"); },
    setShowReview: () => { assert.fail("must keep the decision dialog"); },
    apiJson: async () => { throw new Error("Este ajuste já foi processado."); },
    loadWorkHours: () => { assert.fail("must not refresh a failed mutation"); }
  })();
  assert.equal(saving, false);
  assert.equal(message, "Este ajuste já foi processado.");
});

test("an already pending review does not send a second decision", async () => {
  await pageFunction("reviewAdjustment", {
    selectedRow: { adjustmentId: "adjustment" }, savingAdjustment: true,
    apiJson: () => { assert.fail("must not duplicate a pending decision"); },
    setSavingAdjustment: () => { assert.fail("must retain the pending request state"); }
  })();
});

test("failed background refresh retains committed rows and summary and explains that the change was saved", async () => {
  let loading = false, message = "Ajuste aprovado";
  await pageFunction("loadWorkHours", {
    hoursRequests: createClientRequestGate(), filters: {}, pagination: { page: 1, limit: 50 },
    appliedHoursView: { current: { page: 1, filters: {} } },
    setLoading: (value: boolean) => { loading = value; }, setMessage: (value: string) => { message = value; },
    setRows: () => { assert.fail("must retain the committed visible rows"); },
    setSummary: () => { assert.fail("must retain the current summary"); },
    setPagination: () => { assert.fail("must retain current pagination"); },
    apiJson: async () => { throw new Error("Offline"); }
  })(1, {}, true);
  assert.equal(loading, false);
  assert.match(message, /A alteração foi salva/);
  assert.match(message, /Offline/);
});
