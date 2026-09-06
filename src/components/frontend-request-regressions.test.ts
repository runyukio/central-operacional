import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createClientRequestGate } from "../lib/client-request-gate";

// Execute the real callback bodies with controlled transport/state, without a
// browser session, database, or modifications to operational records.
function componentSource(component: string) {
  const folder = path.join(process.cwd(), "src/components");
  const candidates = readdirSync(folder).filter((name) => name.endsWith(".tsx")).map((name) => path.join(folder, name));
  candidates.push(path.join(process.cwd(), "src/app/login/page.tsx"));
  const modulesFolder = path.join(folder, "modules");
  if (existsSync(modulesFolder)) candidates.push(...readdirSync(modulesFolder).filter((name) => name.endsWith(".tsx")).map((name) => path.join(modulesFolder, name)));
  for (const file of candidates) {
    const content = readFileSync(file, "utf8");
    if (!content.includes(`function ${component}(`)) continue;
    const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const declaration = source.statements.find((statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement) && statement.name?.text === component);
    if (declaration) return { source, declaration };
  }
  throw new Error(`Component not found: ${component}`);
}

function callback(component: string, name: string) {
  const { source, declaration } = componentSource(component);
  for (const statement of declaration.body!.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) return `(${statement.getText(source)})`;
    if (!ts.isVariableStatement(statement)) continue;
    const variable = statement.declarationList.declarations.find((item) => item.name.getText(source) === name);
    if (variable?.initializer && ts.isCallExpression(variable.initializer)) return variable.initializer.arguments[0].getText(source);
  }
  throw new Error(`Callback not found: ${component}.${name}`);
}

function runFunction(expression: string, context: Record<string, unknown>): (...args: unknown[]) => Promise<void> {
  const code = ts.transpileModule(`const subject = ${expression}; subject;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return vm.runInNewContext(code, { URLSearchParams, AbortController, Error, TypeError, ...context });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}

test("newest request remains authoritative even when an aborted transport later resolves", async () => {
  const gate = createClientRequestGate();
  const first = gate.begin();
  const second = gate.begin();
  assert.equal(first.signal.aborted, true);
  assert.equal(gate.isCurrent(first), false);
  assert.equal(gate.isCurrent(second), true);
  gate.cancel();
  assert.equal(second.signal.aborted, true);
  assert.equal(gate.isCurrent(second), false);
});

test("login reports rate limiting and transport errors while always ending loading", async () => {
  for (const failure of ["AUTH_RATE_LIMITED", "network"]) {
    let loading = false, error = "", navigated = false;
    await runFunction(callback("LoginPage", "submit"), {
      loading, email: "test@example.invalid", password: "test-only",
      setLoading: (value: boolean) => { loading = value; }, setError: (value: string) => { error = value; }, setSuccess: () => {},
      signIn: async () => { if (failure === "network") throw new Error("Offline"); return { error: failure }; },
      router: { push: () => { navigated = true; }, refresh: () => {} }
    })({ preventDefault: () => {} });
    assert.equal(loading, false);
    assert.equal(navigated, false);
    assert.match(error, failure === "network" ? /Verifique sua conexão/ : /Aguarde 30 minutos/);
  }
});

test("Performance displays a fallback warning only in hourly queue or forecast views", async () => {
  const { source, declaration } = componentSource("PerformanceAutomationPage");
  const warningVariable = declaration.body!.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find((variable) => variable.name.getText(source) === "realtimeFallbackWarning");
  assert.ok(warningVariable?.initializer);
  const expression = `() => (${warningVariable.initializer.getText(source)})`;
  for (const [activeTab, queueGranularity, expected] of [
    ["queue", "hourly", "queue incomplete"],
    ["queue", "daily", undefined],
    ["queue", "monthly", undefined],
    ["forecast", "monthly", "forecast incomplete"],
    ["agents", "hourly", undefined],
    ["quality", "hourly", undefined],
    ["wfh", "hourly", undefined]
  ]) {
    const warning = await runFunction(expression, {
      activeTab, queueGranularity,
      queuePayload: { realtimeFallbackWarning: "queue incomplete" },
      forecastPayload: { realtimeFallbackWarning: "forecast incomplete" }
    })();
    assert.equal(warning, expected);
  }
  assert.equal(await runFunction(expression, {
    activeTab: "queue", queueGranularity: "hourly", queuePayload: null, forecastPayload: null
  })(), undefined);
});

test("Performance keeps successful imported data when its Real Time fallback carries a warning", async () => {
  for (const name of ["loadQueue", "loadForecast"]) {
    let shown: unknown, loading = false, message = "previous error";
    const payload = { trend: [{ submit: 42 }], realtimeFallbackWarning: "Only uncovered hours may be incomplete" };
    const showPayload = (value: unknown) => { shown = value; };
    const setLoading = (value: boolean) => { loading = value; };
    await runFunction(callback("PerformanceAutomationPage", name), {
      queueGranularity: "hourly", queueLob: "ADS", queueStartDate: "", queueEndDate: "", forecastLob: "ADS",
      fetchPerformance: async () => payload,
      setQueuePayload: showPayload, setForecastPayload: showPayload,
      setLoadingQueue: setLoading, setLoadingForecast: setLoading,
      setMessage: (value: string) => { message = value; }
    })();
    assert.equal(shown, payload);
    assert.equal(loading, false);
    assert.equal(message, "");
  }
});

test("Billing ignores an old month's response and an old request's loading finalizer", async () => {
  const loadRequests = createClientRequestGate();
  const requests = new Map<string, ReturnType<typeof deferred<{ ok: boolean; json: () => Promise<unknown> }>>>();
  let shown: unknown;
  let loading = false;
  const loadMonth = (referenceMonth: string) => runFunction(callback("BillingPage", "load"), {
    loadRequests, referenceMonth, activeTab: "lob", employeeId: "", search: "",
    employeeStatus: "Todos", invoiceStatus: "Todos", roleTitle: "Todos", skill: "Todos", lob: "Todos", supervisorId: "Todos", shiftId: "Todos", billingRule: "Todos", adjustmentType: "Todos",
    setLoading: (value: boolean) => { loading = value; }, setError: () => {}, setPayload: (value: unknown) => { shown = value; },
    fetch: () => { const request = deferred<{ ok: boolean; json: () => Promise<unknown> }>(); requests.set(referenceMonth, request); return request.promise; }
  })();
  const january = loadMonth("2026-01");
  const september = loadMonth("2026-09");
  requests.get("2026-01")!.resolve({ ok: true, json: async () => ({ month: "2026-01" }) });
  await january;
  assert.equal(shown, undefined);
  assert.equal(loading, true);
  requests.get("2026-09")!.resolve({ ok: true, json: async () => ({ month: "2026-09" }) });
  await september;
  assert.deepEqual(shown, { month: "2026-09" });
  assert.equal(loading, false);
});

test("Financeiro ends loading, reports a network failure, and supports a successful retry", async () => {
  let loading = false, error = "";
  let shown: unknown;
  let fail = true;
  const fetchData = runFunction(callback("FinanceiroPage", "fetchData"), {
    loadRequests: createClientRequestGate(), invoiceCycleMonth: "2026-09", costCenter: "Todos", source: "Todos", search: "",
    setLoading: (value: boolean) => { loading = value; }, setError: (value: string) => { error = value; }, setPayload: (value: unknown) => { shown = value; },
    fetch: async () => { if (fail) throw new TypeError("Failed to fetch"); return { ok: true, json: async () => ({ data: { records: [] } }) }; }
  });
  await fetchData();
  assert.equal(loading, false);
  assert.equal(error, "Failed to fetch");
  assert.equal(shown, null);
  fail = false;
  await fetchData();
  assert.equal(error, "");
  assert.equal(loading, false);
  assert.deepEqual(shown, { data: { records: [] } });
});

test("Horas Operacionais clears the displayed filters and sends those same filters", async () => {
  const { source, declaration } = componentSource("WorkHoursPage");
  let handler: ts.Expression | undefined;
  function walk(node: ts.Node) {
    if (ts.isJsxAttribute(node) && node.name.getText(source) === "onClick" && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression?.getText(source).includes("setFilters(resetFilters)")) handler = node.initializer.expression;
    ts.forEachChild(node, walk);
  }
  walk(declaration);
  assert.ok(handler);
  const old = { startDate: "2026-01-01", endDate: "2026-01-31", employeeId: "employee-A", lob: "ADS", supervisor: "Alice", shift: "Todos", collaborator: "WB0001", employeeStatus: "Todos", status: "Todos" };
  let displayed: typeof old = old;
  let requested = "";
  const load = runFunction(callback("WorkHoursPage", "loadWorkHours"), {
    hoursRequests: createClientRequestGate(),
    filters: old, pagination: { page: 2, limit: 50 },
    setLoading: () => {}, setMessage: () => {}, setRows: () => {}, setSummary: () => {}, setPagination: () => {},
    apiJson: async (url: string) => { requested = url; return { data: [], summary: {}, pagination: {} }; }
  });
  await runFunction(handler.getText(source), {
    currentOperationalMonthRange: () => ({ startDate: "2026-09-01", endDate: "2026-09-30" }),
    setFilters: (value: typeof old) => { displayed = value; }, loadWorkHours: load
  })();
  const query = new URL(requested, "https://local.test").searchParams;
  assert.equal(query.get("startDate"), displayed.startDate);
  assert.equal(query.get("endDate"), displayed.endDate);
  assert.equal(query.get("page"), "1");
  for (const key of ["lob", "employeeId", "supervisor", "collaborator"]) assert.equal(query.has(key), false);
});

test("Central records a summary error instead of treating a failed request as an empty result", async () => {
  let error = "", loading = false;
  let summary: unknown = { planned: 42 };
  await runFunction(callback("OperationalCommandCenter", "loadCommandCenterSummary"), {
    summaryRequests: createClientRequestGate(), dateRange: { startDate: "2026-09-01", endDate: "2026-09-30" },
    selectedCommandLob: "Todos", selectedCommandSupervisor: "Todos", selectedCommandRoleTitle: "Todos", selectedCommandShift: "Todos", selectedCommandSkill: "Todos",
    setLoadingSummary: (value: boolean) => { loading = value; }, setSummaryError: (value: string) => { error = value; }, setAttendanceSummary: (value: unknown) => { summary = value; },
    apiJson: async () => { throw new Error("Service unavailable"); }
  })();
  assert.equal(loading, false);
  assert.equal(error, "Service unavailable");
  assert.equal(summary, null);
  assert.match(componentSource("OperationalCommandCenter").declaration.getText(), /Indicadores indisponíveis/);
});

test("Central coalesces concurrent presence refreshes and permits the next refresh", async () => {
  let calls = 0;
  const pending = deferred<unknown>();
  const refresh = runFunction(callback("OperationalCommandCenter", "loadOperationalPresence"), {
    presenceRequestRef: { current: null }, presenceAbortRef: { current: null },
    setLoadingOperationalPresence: () => {}, setOperationalPresenceError: () => {}, setOperationalPresence: () => {},
    apiJson: () => { calls++; return pending.promise; }
  });
  const first = refresh(true), second = refresh(true);
  assert.equal(calls, 1);
  pending.resolve({ rows: [] });
  await Promise.all([first, second]);
  await refresh();
  assert.equal(calls, 2);
});

test("Central pauses visual polling while hidden, refreshes on return, and cleans up", async () => {
  const { source, declaration } = componentSource("OperationalCommandCenter");
  let effect: ts.Expression | undefined;
  for (const statement of declaration.body!.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression) || statement.expression.expression.getText(source) !== "useEffect") continue;
    const candidate = statement.expression.arguments[0];
    if (candidate.getText(source).includes("setInterval")) effect = candidate;
  }
  assert.ok(effect);
  let refreshes = 0, cleared = false;
  let tick!: () => void, onVisibility!: () => void;
  const document = { hidden: true, addEventListener: (_: string, fn: () => void) => { onVisibility = fn; }, removeEventListener: (_: string, fn: () => void) => { assert.equal(fn, onVisibility); } };
  const controller = new AbortController();
  const cleanup = runFunction(effect.getText(source), {
    document, window: { setInterval: (fn: () => void) => { tick = fn; return 1; }, clearInterval: () => { cleared = true; } },
    loadOperationalPresence: () => { refreshes++; }, presenceAbortRef: { current: controller }, presenceRequestRef: { current: null }
  }) as unknown as () => () => void;
  const dispose = cleanup();
  tick();
  assert.equal(refreshes, 0);
  document.hidden = false;
  onVisibility();
  assert.equal(refreshes, 1);
  tick();
  assert.equal(refreshes, 2);
  dispose();
  assert.equal(cleared, true);
  assert.equal(controller.signal.aborted, true);
});
