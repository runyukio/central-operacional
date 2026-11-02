import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createClientRequestGate } from "./client-request-gate";
import { requireSavedSchedule, requireScheduleData, scheduleEditResponse } from "./schedule-editor-response";

const employeeId = "cmpagbb9a006fhvj50yyv8dsx";
const date = "2026-11-03";
const row = { employee: { id: employeeId, name: "Diego Gabriel da Silva Mativi", lob: "VIDEO", shift: "Tarde", supervisor: "Supervisora" }, days: ["Escalado"], plannedTimes: [{ scheduleId: "fixture-slot", startsAt: "15:00", endsAt: "00:00" }] };
const grid = { data: { scheduleGridRows: [row], dateColumns: [date] } };

test("legacy save callback accepts the new response without reading an undefined schedules object", () => {
  const saved = { id: "fixture-slot", employeeId, date: `${date}T00:00:00.000Z`, status: "FOLGA" };
  const payload = scheduleEditResponse(saved);
  const legacySummary = payload.schedules.attendanceSummary ?? payload.summary;
  assert.equal(legacySummary, null, "the response defers the real filtered summary instead of fabricating metrics");
  assert.equal(payload.attendanceSummaryDeferred, true);
  assert.equal(requireSavedSchedule(payload, { employeeId, date }), saved);
});

test("attendance summary is not required to load the editor, including No cronograma", () => {
  for (const status of ["Escalado", "No cronograma", "Folga"]) {
    const payload = { ...grid, data: { ...grid.data, scheduleGridRows: [{ ...row, days: [status] }] } };
    assert.equal(requireScheduleData<typeof row>(payload).scheduleGridRows[0].employee.id, employeeId);
  }
});

for (const payload of [undefined, null, {}, { data: null }, { data: {} }, { data: { scheduleGridRows: [null], dateColumns: [date] } }, { data: { scheduleGridRows: [{ ...row, employee: {} }], dateColumns: [date] } }]) {
  test(`incomplete API response is refused before using selected partner: ${JSON.stringify(payload)}`, () => {
    assert.throws(() => requireScheduleData(payload), /carregar|incompleta|incompletos/);
  });
}

test("save confirmation must match the unique employee ID and exact date", () => {
  for (const data of [null, {}, { id: "slot", employeeId: "other", date }, { id: "slot", employeeId, date: "2026-11-04" }]) {
    assert.throws(() => requireSavedSchedule({ data }, { employeeId, date }), /confirmar a gravação/);
  }
});

function pageFunction(name: string, context: Record<string, unknown>) {
  const file = new URL("../components/modules/schedules-page.tsx", import.meta.url);
  const source = ts.createSourceFile("schedules-page.tsx", readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = source.statements.find((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === "SchedulesPage")!;
  const declaration = component.body!.statements.find((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === name)!;
  const compiled = ts.transpileModule(`(${declaration.getText(source)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return vm.runInNewContext(compiled, { URLSearchParams, Error, requireScheduleData, requireSavedSchedule, ...context }) as (...args: any[]) => Promise<void>;
}
function editorContext(patch: Record<string, unknown> = {}) {
  return { savingSchedule: false, editorReadGate: { current: createClientRequestGate() }, loadedEditorKey: { current: "" }, setLoadingScheduleEditor: () => {}, setScheduleEditorError: () => {}, setScheduleEditForm: () => {}, setShowEditSchedule: () => {}, setScheduleEmployees: () => {}, ...patch };
}

test("editor requests the unique ID and day, with summary explicitly skipped", async () => {
  const loaded = { current: "" };
  let applied = false;
  await pageFunction("loadScheduleEditor", editorContext({
    loadedEditorKey: loaded,
    apiJson: async (url: string) => {
      const params = new URL(url, "https://example.test").searchParams;
      assert.equal(params.get("employeeId"), employeeId);
      assert.equal(params.get("startDate"), date);
      assert.equal(params.get("endDate"), date);
      assert.equal(params.get("skipSummary"), "true");
      return grid;
    },
    applyScheduleEditorData: (value: typeof row, index: number, selectedDate: string) => {
      assert.equal(value.employee.id, employeeId); assert.equal(index, 0); assert.equal(selectedDate, date); applied = true;
    }
  }))(employeeId, date);
  assert.equal(applied, true);
  assert.equal(loaded.current, `${employeeId}:${date}`);
});

test("a late partner response cannot overwrite the partner selected next", async () => {
  let resolveFirst!: (value: unknown) => void;
  const first = new Promise((resolve) => { resolveFirst = resolve; });
  const applied: string[] = [];
  let calls = 0;
  const load = pageFunction("loadScheduleEditor", editorContext({
    apiJson: async () => ++calls === 1 ? first : { data: { scheduleGridRows: [{ ...row, employee: { ...row.employee, id: "other" } }], dateColumns: [date] } },
    applyScheduleEditorData: (value: typeof row) => applied.push(value.employee.id)
  }));
  const pending = load(employeeId, date);
  await load("other", date);
  resolveFirst(grid);
  await pending;
  assert.deepEqual(applied, ["other"]);
});

test("an empty day loads the partner by unique ID and initializes a clean no-schedule cell", async () => {
  let calls = 0;
  await pageFunction("loadScheduleEditor", editorContext({
    apiJson: async (url: string) => {
      if (++calls === 1) return { data: { scheduleGridRows: [], dateColumns: [date] } };
      assert.equal(url, `/api/employees/${employeeId}`);
      return { data: row.employee };
    },
    applyScheduleEditorData: (value: typeof row) => { assert.equal(value.employee.id, employeeId); assert.deepEqual(Array.from(value.days), ["Sem cronograma"]); }
  }))(employeeId, date);
  assert.equal(calls, 2);
});

test("partner not found and API errors leave editor unloaded with a controlled message", async () => {
  for (const response of [null, { data: { scheduleGridRows: [], dateColumns: [date] } }]) {
    const loaded = { current: "previous" };
    let error = "";
    await pageFunction("loadScheduleEditor", editorContext({ loadedEditorKey: loaded,
      apiJson: async (url: string) => { if (url.includes("/employees/")) throw Object.assign(new Error("not found"), { status: 404 }); return response; },
      setScheduleEditorError: (value: string) => { error = value; },
      applyScheduleEditorData: () => { assert.fail("incomplete response must not open the form"); }
    }))(employeeId, date);
    assert.equal(loaded.current, "");
    assert.match(error, /Parceiro não encontrado|Não foi possível carregar/);
  }
});

test("saving while required editor data is loading sends no mutation", async () => {
  let message = "";
  await pageFunction("saveScheduleEdit", { savingSchedule: false, loadingScheduleEditor: true, setAttendanceMessage: (value: string) => { message = value; }, apiJson: async () => { assert.fail("must not save while loading"); } })();
  assert.match(message, /Aguarde o carregamento/);
});

test("an empty save reply keeps the editor open and requires checking persistence", async () => {
  let message = "", saving = false;
  await pageFunction("saveScheduleEdit", {
    savingSchedule: false, loadingScheduleEditor: false, loadedEditorKey: { current: `${employeeId}:${date}` },
    scheduleEditForm: { employeeId, date, status: "Folga" }, justificationDraft: {},
    statusNeedsTime: () => false, statusNeedsReason: () => false, requiresAbsenceNotice: () => false,
    setSavingSchedule: (value: boolean) => { saving = value; }, setAttendanceMessage: (value: string) => { message = value; },
    apiJson: async () => ({}), closeScheduleEditor: () => { assert.fail("must not report an unconfirmed write as successful"); },
    refreshSchedules: () => { assert.fail("must not replace the editor before confirming the response"); }
  })();
  assert.equal(saving, false);
  assert.match(message, /confirmar a gravação/);
});
