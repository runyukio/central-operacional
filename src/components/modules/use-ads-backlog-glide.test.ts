import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createClientRequestGate } from "../../lib/client-request-gate";

// Exercise the actual effect with controlled visibility, transport and timers.
// No browser session or operational data is needed for these lifecycle checks.
const file = readFileSync(new URL("./use-ads-backlog-glide.ts", import.meta.url), "utf8");
const source = ts.createSourceFile("use-ads-backlog-glide.ts", file, ts.ScriptTarget.Latest, true);
let effect = "";
function findEffect(node: ts.Node) {
  if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect") effect = node.arguments[0].getText(source);
  ts.forEachChild(node, findEffect);
}
findEffect(source);
const code = ts.transpileModule(`const effect = ${effect}; effect;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}
type ReadState = { url: string; data: unknown; receivedAt: number; loading: boolean; error: string };
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function harness(initialVisibility = "visible") {
  let state: ReadState = { url: "", data: null, receivedAt: 0, loading: true, error: "" };
  let callback: (() => void) | undefined;
  let nextTimer = 0;
  const timers = new Map<number, { callback: () => void; delay: number }>();
  const requests: Array<ReturnType<typeof deferred> & { url: string; signal: AbortSignal }> = [];
  const document = {
    visibilityState: initialVisibility,
    addEventListener: (_event: string, listener: () => void) => { callback = listener; },
    removeEventListener: (_event: string, listener: () => void) => { if (callback === listener) callback = undefined; },
  };
  const gate = createClientRequestGate();
  const start = (url = "/glide?horizonDays=14") => vm.runInNewContext(code, {
    document, gate, url, Error, GLIDE_REFRESH_MS: 3600000,
    setClock: () => {},
    setRead: (value: ReadState | ((current: ReadState) => ReadState)) => { state = typeof value === "function" ? value(state) : value; },
    apiJson: (requestUrl: string, options: { signal: AbortSignal }) => { const request = { ...deferred(), url: requestUrl, signal: options.signal }; requests.push(request); return request.promise; },
    setTimeout: (task: () => void, delay: number) => { const id = ++nextTimer; timers.set(id, { callback: task, delay }); return id; },
    clearTimeout: (id: number) => { timers.delete(id); },
    setInterval: () => 100, clearInterval: () => {},
  })() as () => void;
  return {
    start, requests, timers,
    get state() { return state; },
    visibility(value: "visible" | "hidden") { document.visibilityState = value; callback?.(); },
    tick() { const first = timers.entries().next().value; assert.ok(first); const [id, timer] = first; timers.delete(id); timer.callback(); },
  };
}

test("hourly reads pause when hidden, abort in-flight work and refresh when the tab returns", async () => {
  const h = harness();
  const cleanup = h.start();
  assert.equal(h.requests.length, 1);
  h.requests[0].resolve({ marker: "first" }); await flush();
  assert.equal(h.timers.size, 1);
  assert.equal([...h.timers.values()][0].delay, 3600000);
  h.tick(); assert.equal(h.requests.length, 2);
  h.visibility("hidden");
  assert.equal(h.requests[1].signal.aborted, true);
  h.requests[1].resolve({ marker: "obsolete" }); await flush();
  assert.equal((h.state.data as { marker: string }).marker, "first");
  assert.equal(h.timers.size, 0);
  h.visibility("visible"); assert.equal(h.requests.length, 3);
  h.requests[2].resolve({ marker: "current" }); await flush();
  assert.equal((h.state.data as { marker: string }).marker, "current");
  cleanup(); assert.equal(h.timers.size, 0);
});

test("changing horizon cannot publish a late response from the prior request", async () => {
  const h = harness();
  const previousCleanup = h.start("/glide?horizonDays=14");
  previousCleanup();
  const cleanup = h.start("/glide?horizonDays=7");
  h.requests[1].resolve({ marker: "7 days" }); await flush();
  h.requests[0].resolve({ marker: "14 days" }); await flush();
  assert.equal(h.requests[0].signal.aborted, true);
  assert.equal(h.state.url, "/glide?horizonDays=7");
  assert.equal((h.state.data as { marker: string }).marker, "7 days");
  cleanup();
});

test("a hidden mount makes no read, and a refresh failure retains reference data with an error", async () => {
  const h = harness("hidden");
  const cleanup = h.start();
  assert.equal(h.requests.length, 0);
  h.visibility("visible");
  h.requests[0].resolve({ marker: "last success" }); await flush();
  h.tick();
  h.requests[1].reject(new Error("Offline")); await flush();
  assert.equal((h.state.data as { marker: string }).marker, "last success");
  assert.equal(h.state.loading, false);
  assert.equal(h.state.error, "Offline");
  cleanup();
});
