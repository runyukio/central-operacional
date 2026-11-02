import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createClientRequestGate } from "./client-request-gate";
import { prisma } from "./prisma";
import { mockPrismaDelegate } from "./prisma-test-delegate";
import { listOperationalWorkHourCaptures, listOperationalWorkHours, workHourReadData } from "./work-hours-service";

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
  return vm.runInNewContext(compiled, { URLSearchParams, Error, AbortController, capturedHoursById: { current: new Map() }, captureRequest: { current: new AbortController() }, pendingCaptureIds: { current: new Set() }, setCaptureStates: () => {}, ...context }) as (...args: any[]) => Promise<void>;
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

test("deferred hours list returns official rows and full summary without calculating capture", async (t) => {
  mockPrismaDelegate(t, "user", { findUnique: async () => ({ id: "wfm", name: "WFM", status: "ACTIVE", role: { name: "WFM" } }) });
  mockPrismaDelegate(t, "workHourRecord", { findMany: async () => [], count: async () => 0, groupBy: async () => [] });
  mockPrismaDelegate(t, "workHourAdjustmentRequest", { groupBy: async () => [] });
  mockPrismaDelegate(t, "workHourOvertimeReview", { aggregate: async () => ({ _sum: { excessHours: 0 }, _count: { _all: 0 } }) });
  t.mock.method(prisma, "$transaction", async (queries: Promise<unknown>[]) => Promise.all(queries));
  t.mock.method(workHourReadData, "capturedHours", async () => { assert.fail("capture must not block the filtered list"); });
  const result = await listOperationalWorkHours(actor, { includeCapture: false });
  assert.ok("data" in result);
  assert.equal(result.capturedHoursDeferred, true);
  assert.equal(result.summary.pendingAdjustments, 0);
});

test("capture lookup loads only requested records within the existing date and employee scope", async (t) => {
  mockPrismaDelegate(t, "user", { findUnique: async () => ({ id: "wfm", status: "ACTIVE", role: { name: "WFM" } }) });
  const record = { id: "allowed", employeeId: "agent", wbLogin: "wb", date: new Date("2026-10-01") };
  mockPrismaDelegate(t, "workHourRecord", { findMany: async (args: any) => {
    assert.deepEqual(args.where.AND[1], { id: { in: ["allowed", "outside"] } });
    assert.deepEqual(args.where.AND[0].date, { gte: new Date("2026-10-01"), lte: new Date("2026-10-31T23:59:59.999Z") });
    assert.deepEqual(args.where.AND[0].employee, { deletedAt: null });
    assert.equal(args.include, undefined);
    return [record];
  } });
  t.mock.method(workHourReadData, "capturedHours", async (requests: Parameters<typeof workHourReadData.capturedHours>[0]) => {
    assert.deepEqual(requests, [{ key: "allowed", employeeId: "agent", wbLogin: "wb", shiftDate: record.date }]);
    return new Map([["allowed", 7.5]]);
  });
  const result = await listOperationalWorkHourCaptures(actor, { recordIds: ["allowed", "outside", "allowed"], startDate: "2026-10-01", endDate: "2026-10-31" });
  assert.deepEqual(result, { data: [{ id: "allowed", capturedHours: 7.5 }] });
});

for (const viewer of [{ status: "ACTIVE", role: { name: "COLABORADOR" } }, { status: "INACTIVE", role: { name: "WFM" } }]) {
  test(`capture lookup denies ${viewer.role.name}/${viewer.status} before reading records`, async (t) => {
    mockPrismaDelegate(t, "user", { findUnique: async () => ({ id: "viewer", ...viewer }) });
    mockPrismaDelegate(t, "workHourRecord", { findMany: async () => { assert.fail("denied viewer must not read capture"); } });
    const result = await listOperationalWorkHourCaptures(actor, { recordIds: ["allowed"] });
    assert.ok("error" in result);
  });
}

test("background approval refresh retains capture and loads only newly visible records without waiting", async () => {
  const gate = createClientRequestGate();
  const cache = { current: new Map([["reviewed", 7.5]]) };
  let rows: any[] = [], loading = true, captureIds: string[] = [];
  await pageFunction("loadWorkHours", {
    hoursRequests: gate, pagination: { page: 1, limit: 50 }, filters: {}, appliedHoursView: { current: {} }, capturedHoursById: cache,
    setLoading: (value: boolean) => { loading = value; }, setMessage: () => {}, setRows: (value: any[]) => { rows = value; },
    setSummary: () => {}, setPagination: () => {},
    apiJson: async (url: string) => { assert.ok(url.includes("includeCapture=false")); return { data: [{ id: "reviewed", capturedHours: 0 }, { id: "new", capturedHours: 0 }], summary: {}, pagination: {} }; },
    loadCapturedHours: (ids: string[]) => { captureIds = ids; return new Promise(() => {}); }
  })(1, { startDate: "2026-10-01", endDate: "2026-10-31" }, true);
  assert.equal(loading, false);
  assert.equal(rows[0].capturedHours, 7.5);
  assert.deepEqual(Array.from(captureIds), ["new"]);
});

test("a capture response from an old filter cannot overwrite the new view", async () => {
  const gate = createClientRequestGate(), request = gate.begin();
  const captureRequest = { current: request };
  const response = deferred<{ data: Array<{ id: string; capturedHours: number }> }>();
  const pending = pageFunction("loadCapturedHours", {
    hoursRequests: gate, captureRequest, apiJson: async () => response.promise,
    setRows: () => { assert.fail("old response must not replace rows"); },
    setCaptureStates: () => { assert.fail("old response must not replace loading states"); }
  })(["old"], { startDate: "2026-10-01", endDate: "2026-10-31" }, request);
  gate.begin();
  captureRequest.current = new AbortController();
  response.resolve({ data: [{ id: "old", capturedHours: 8 }] });
  await pending;
});

test("approval refresh keeps the existing capture request running instead of repeating it", async () => {
  const controller = new AbortController();
  await pageFunction("loadWorkHours", {
    hoursRequests: createClientRequestGate(), captureRequest: { current: controller }, pendingCaptureIds: { current: new Set(["reviewed"]) },
    pagination: { page: 1, limit: 50 }, filters: {}, appliedHoursView: { current: {} },
    setLoading: () => {}, setMessage: () => {}, setRows: () => {}, setSummary: () => {}, setPagination: () => {},
    apiJson: async () => ({ data: [{ id: "reviewed", capturedHours: 0 }], summary: {}, pagination: {} }),
    loadCapturedHours: () => { assert.fail("must retain the capture already in flight"); }
  })(1, { startDate: "2026-10-01", endDate: "2026-10-31" }, true);
  assert.equal(controller.signal.aborted, false);
});

test("capture lookup refuses an unbounded batch", async (t) => {
  mockPrismaDelegate(t, "user", { findUnique: async () => ({ id: "wfm", status: "ACTIVE", role: { name: "WFM" } }) });
  mockPrismaDelegate(t, "workHourRecord", { findMany: async () => { assert.fail("unbounded lookup must not read records"); } });
  const result = await listOperationalWorkHourCaptures(actor, { recordIds: Array.from({ length: 101 }, (_, i) => String(i)) });
  assert.ok("error" in result);
});

test("deferred capture avoids combining many dates and people in one raw-history query", async (t) => {
  mockPrismaDelegate(t, "user", { findUnique: async () => ({ id: "wfm", status: "ACTIVE", role: { name: "WFM" } }) });
  const records = Array.from({ length: 51 }, (_, i) => ({ id: String(i), employeeId: `agent-${i}`, wbLogin: `wb-${i}`, date: new Date(i < 40 ? "2026-10-01" : "2026-10-02") }));
  mockPrismaDelegate(t, "workHourRecord", { findMany: async () => records });
  const capture = t.mock.method(workHourReadData, "capturedHours", async (requests: Parameters<typeof workHourReadData.capturedHours>[0]) => {
    assert.ok(requests.length <= 20);
    assert.equal(new Set(requests.map((item) => item.shiftDate.toISOString())).size, 1);
    return new Map(requests.map((item) => [item.key, 7.5]));
  });
  const result = await listOperationalWorkHourCaptures(actor, { recordIds: records.map((record) => record.id) });
  assert.ok("data" in result);
  assert.equal(result.data.length, 51);
  assert.equal(capture.mock.callCount(), 3);
});
