import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createClientRequestGate } from "../../lib/client-request-gate";

// Exercise the actual component callbacks with out-of-order responses and no
// production session or database writes.
const file = path.join(process.cwd(), "src/components/modules/schedules-page.tsx");
const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = source.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "SchedulesPage")!;

function callback(name: string, context: Record<string, unknown>) {
  const declaration = component.body!.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === name)!;
  assert.ok(declaration, `Missing ${name}`);
  const js = ts.transpileModule(`const subject = (${declaration.getText(source)}); subject;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  return vm.runInNewContext(js, { URLSearchParams, ...context }) as (...args: any[]) => Promise<void>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const filters = { collaborator: "", employeeId: "", lob: "Todos", supervisor: "Todos", shift: "Todos", status: "Todos", skill: "Todos", roleTitle: "", wbLogins: "" };
const range = { startDate: "2026-11-01", endDate: "2026-11-30" };

function gridContext() {
  const rows: unknown[] = [];
  const analysis: string[] = [];
  return {
    rows,
    analysis,
    scheduleReadGate: { current: createClientRequestGate() },
    summaryReadGate: { current: createClientRequestGate() },
    pendingReadGate: { current: createClientRequestGate() },
    scheduleAnalysisKeyRef: { current: JSON.stringify([range.startDate, range.endDate, filters]) },
    scheduleViewRef: { current: { page: 1, filters, range } },
    schedulePeriod: { month: 11, year: 2026 },
    schedulePagination: { page: 1, limit: 75 },
    scheduleFilters: filters,
    scheduleDateRange: range,
    attendanceMessage: "",
    scheduleBatchValues: () => [],
    setScheduleActorRole: () => {},
    setScheduleRows: (value: unknown) => { rows.push(value); },
    normalizeScheduleMetrics: () => ({ quantity: 0 }),
    setScheduleMetrics: () => {},
    setSchedulePagination: () => {},
    setScheduleDateColumns: () => {},
    setAttendanceForm: () => {},
    setScheduleEditForm: () => {},
    setAttendanceSummary: () => {},
    setAttendanceMessage: () => {},
    refreshScheduleSummary: () => { analysis.push("summary"); },
    refreshAttendanceForSchedulePeriod: () => { analysis.push("pending"); }
  };
}

test("a superseded schedule read cannot overwrite the latest period or start stale summary reads", async () => {
  const first = deferred<any>(), second = deferred<any>();
  const requests: RequestInit[] = [];
  const context = gridContext();
  const read = callback("refreshSchedules", {
    ...context,
    apiJson: async (_url: string, options: RequestInit) => {
      requests.push(options);
      return requests.length === 1 ? first.promise : second.promise;
    }
  });
  const oldRead = read(1), currentRead = read(2);
  assert.equal(requests[0].signal?.aborted, true);
  const latestRows = [{ employee: { id: "current" } }];
  second.resolve({ data: { scheduleGridRows: latestRows } });
  await currentRead;
  first.resolve({ data: { scheduleGridRows: [{ employee: { id: "old" } }] } });
  await oldRead;
  assert.deepEqual(context.rows, [latestRows]);
  assert.deepEqual(context.analysis, ["summary", "pending"]);
});

test("changing grid pages does not reload unchanged period-wide attendance analysis", async () => {
  const context = gridContext();
  const read = callback("refreshSchedules", {
    ...context,
    apiJson: async () => ({ data: { scheduleGridRows: [] } })
  });
  await read(2, filters, range, false);
  assert.equal(context.rows.length, 1);
  assert.deepEqual(context.analysis, []);
});

test("paging during a filter change still loads the new period analysis", async () => {
  const context = gridContext();
  const read = callback("refreshSchedules", {
    ...context,
    apiJson: async () => ({ data: { scheduleGridRows: [] } })
  });
  await read(2, { ...filters, lob: "CEC" }, range, false);
  assert.deepEqual(context.analysis, ["summary", "pending"]);
});

test("late attendance summaries cannot replace the current filtered summary", async () => {
  const first = deferred<any>(), second = deferred<any>();
  const summaries: unknown[] = [], requests: RequestInit[] = [];
  const read = callback("refreshScheduleSummary", {
    summaryReadGate: { current: createClientRequestGate() },
    scheduleFilters: filters,
    scheduleDateRange: range,
    scheduleBatchValues: () => [],
    setAttendanceSummary: (summary: unknown) => { summaries.push(summary); },
    apiJson: async (_url: string, options: RequestInit) => {
      requests.push(options);
      return requests.length === 1 ? first.promise : second.promise;
    }
  });
  const oldRead = read(), newRead = read(range, { ...filters, lob: "CEC" });
  assert.equal(requests[0].signal?.aborted, true);
  second.resolve({ summary: { lob: "CEC" } });
  await newRead;
  first.resolve({ summary: { lob: "all" } });
  await oldRead;
  assert.deepEqual(summaries, [{ lob: "CEC" }]);
});

test("a committed schedule save closes immediately and refreshes the grid without requiring a global summary payload", async () => {
  let closed = false, saving = false, refreshed = false;
  const messages: string[] = [];
  const save = callback("saveScheduleEdit", {
    scheduleEditForm: { employeeId: "agent", date: "2026-11-02", status: "Escalado", shift: "Manhã", startsAt: "08:00", endsAt: "17:00", observation: "" },
    justificationDraft: {},
    scheduleViewRef: { current: { page: 1, filters, range } },
    statusNeedsTime: () => true,
    statusNeedsReason: () => false,
    requiresAbsenceNotice: () => false,
    setAttendanceMessage: (message: string) => { messages.push(message); },
    setSavingSchedule: (value: boolean) => { saving = value; },
    apiJson: async () => ({ data: { id: "saved-slot" } }),
    closeScheduleEditor: () => { closed = true; },
    refreshSchedules: () => { refreshed = true; return new Promise(() => {}); }
  });
  await save();
  assert.equal(closed, true);
  assert.equal(saving, false);
  assert.equal(refreshed, true);
  assert.match(messages[0], /Cronograma atualizado/);
});

test("a slow schedule save refreshes the latest requested period and filters after navigating away", async () => {
  const response = deferred<any>();
  const view = { current: { page: 1, filters, range } };
  const latestFilters = { ...filters, lob: "CEC" };
  const latestRange = { startDate: "2026-12-01", endDate: "2026-12-31" };
  let refreshed = false;
  const save = callback("saveScheduleEdit", {
    scheduleEditForm: { employeeId: "agent", date: "2026-11-02", status: "Escalado", shift: "Manhã", startsAt: "08:00", endsAt: "17:00", observation: "" },
    justificationDraft: {},
    scheduleViewRef: view,
    statusNeedsTime: () => true,
    statusNeedsReason: () => false,
    requiresAbsenceNotice: () => false,
    setAttendanceMessage: () => {},
    setSavingSchedule: () => {},
    apiJson: () => response.promise,
    closeScheduleEditor: () => {},
    refreshSchedules: (page: number, appliedFilters: typeof filters, period: typeof range) => {
      refreshed = true;
      assert.equal(page, 3);
      assert.equal(appliedFilters, latestFilters);
      assert.equal(period, latestRange);
    }
  });
  const pending = save();
  view.current = { page: 3, filters: latestFilters, range: latestRange };
  response.resolve({ data: { id: "committed" } });
  await pending;
  assert.equal(refreshed, true);
});
