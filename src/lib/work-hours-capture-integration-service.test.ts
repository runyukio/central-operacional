import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { prisma } from "./prisma";
import { answerWorkHourAdherenceJustification, applyCaptureWorkHourDivergenceDecisions, captureWorkHoursData, commitCaptureWorkHoursImport, exportWorkHourAdherenceJustifications, listCaptureWorkHourDivergences, listWorkHourAdherenceJustifications, previewCaptureWorkHoursImport } from "./work-hours-capture-integration-service";
import { deleteWorkHourRecord } from "./work-hours-service";
import { cancelAdherenceForDeletedWorkHours } from "./work-hours-adherence-cleanup";
import { buildXlsxResponse } from "./xlsx-export";
import * as XLSX from "xlsx";

const day = "2026-09-03";
const date = new Date(`${day}T00:00:00.000Z`);
const hour = 3_600_000;
const actor = { email: "test@example.test", name: "Test WFM", role: "WFM" as const };
const clone = <T>(value: T): T => structuredClone(value);
type Row = Record<string, any>;

function employee(id = "agent", patch: Row = {}): Row {
  return { id, wbLogin: `wb_${id}`, fullName: id, roleTitle: "Agente", operationalStatus: "Ativo", goLiveDate: new Date("2026-08-01"),
    deletedAt: null, lob: { name: "ADS" }, lobId: "ads", team: null, user: null, skill: null, skillAssignments: [],
    shiftId: "night", shift: { id: "night", name: "Noite", startsAt: "23:00", endsAt: "08:00" }, supervisorId: null, supervisor: null, ...patch };
}
function slot(employeeId = "agent", status = "ESCALADO"): Row {
  return { id: `slot-${employeeId}`, employeeId, date, startsAt: "23:00", endsAt: "08:00", status,
    shiftId: "night", lobId: "ads", supervisorId: null, deletedAt: null, source: "test", observation: null };
}
function divergence(employeeId = "agent", captured = hour, patch: Row = {}): Row {
  return { id: `div-${employeeId}`, employeeId, scheduleId: `slot-${employeeId}`, date, slotKey: `slot-${employeeId}`,
    reconciliationKey: `${employeeId}:${day}:slot-${employeeId}`, wbLogin: `wb_${employeeId}`, lob: "ADS", classification: "ADS",
    status: "PENDING", scheduleStatus: "ESCALADO", plannedStart: "23:00", plannedEnd: "08:00", sourceDurationMs: captured,
    proposedHours: captured / hour + 0.5, reasons: ["SHORT_CAPTURE"], suggestedActions: [], resolutionAction: null, updatedAt: new Date("2026-09-03T10:00:00Z"), ...patch };
}

// Transactional in-memory Prisma boundary: no production connection or data writes.
// Business code, eligibility, decisions and audit construction are the real service.
function fixture(t: TestContext, seed: Record<string, Row[]> = {}) {
  const names = ["employeeProfile", "schedule", "workHourRecord", "workHourCaptureDivergence", "workHourCaptureImportRun",
    "workHourAdherenceJustification", "attendanceRecord", "attendanceHistory", "scheduleChangeHistory", "workHourHistory",
    "workHourAdjustmentRequest", "notification", "auditLog", "user"];
  let state: Record<string, Row[]> = Object.fromEntries(names.map((name) => [name, clone(seed[name] ?? [])]));
  state.user = [{ id: "wfm", email: actor.email, role: { name: "WFM" }, status: "ACTIVE", deletedAt: null }];
  const calls: Array<{ model: string; op: string; args: any }> = [];
  let serial = 0;
  const hydrate = (model: string, row: Row) => {
    const result = clone(row);
    if (["workHourCaptureDivergence", "workHourAdherenceJustification"].includes(model)) {
      result.employee = clone(state.employeeProfile.find((item) => item.id === row.employeeId));
      result.schedule = clone(state.schedule.find((item) => item.id === row.scheduleId) ?? null);
    }
    return result;
  };
  function matches(row: Row, where: Row = {}): boolean {
    return Object.entries(where).every(([key, expected]) => {
      if (key === "OR") return expected.some((condition: Row) => matches(row, condition));
      if (key === "AND") return (Array.isArray(expected) ? expected : [expected]).every((condition: Row) => matches(row, condition));
      if (key === "employeeId_date") return matches(row, expected);
      const value = row[key];
      if (expected instanceof Date) return value instanceof Date && +value === +expected;
      if (expected && typeof expected === "object") {
        if ("in" in expected) return expected.in.includes(value);
        if ("notIn" in expected) return !expected.notIn.includes(value);
        if ("not" in expected) return value !== expected.not;
        if ("gte" in expected || "lte" in expected) return (!expected.gte || value >= expected.gte) && (!expected.lte || value <= expected.lte);
        return matches(value ?? {}, expected);
      }
      return value === expected;
    });
  }
  const delegates: Row = {};
  for (const model of names) {
    delegates[model] = {};
    for (const op of ["findFirst", "findUnique", "findMany", "create", "upsert", "update", "updateMany", "delete"] as const) {
      const impl = async (args: any = {}) => {
        calls.push({ model, op, args: clone(args) });
        const found = state[model].filter((row) => matches(hydrate(model, row), args.where));
        if (op === "findMany") return found.map((row) => hydrate(model, row));
        if (op === "findUnique" || op === "findFirst") return found[0] ? hydrate(model, found[0]) : null;
        if (op === "delete") { state[model] = state[model].filter((row) => row !== found[0]); return found[0]; }
        if (op === "updateMany") { found.forEach((row) => Object.assign(row, clone(args.data))); return { count: found.length }; }
        if (op === "update" && !found.length) throw new Error(`Missing ${model}`);
        const existing = op !== "create" ? found[0] : null;
        const data = op === "upsert" ? existing ? args.update : args.create : args.data;
        const saved = existing ?? { id: `${model}-${++serial}`, status: "PENDING" };
        Object.assign(saved, clone(data), { updatedAt: new Date(Date.now() + ++serial) });
        if (!existing) state[model].push(saved);
        return hydrate(model, saved);
      };
      delegates[model][op] = impl;
    }
    // Prisma delegates are dynamic proxies (method descriptors have no value).
    // Replace the delegate for this test and restore it afterwards.
    const original = (prisma as any)[model];
    (prisma as any)[model] = delegates[model];
    t.after(() => { (prisma as any)[model] = original; });
  }
  t.mock.method(prisma, "$transaction", (async (fn: (tx: any) => any, options: any) => {
    assert.equal(options.isolationLevel, "Serializable");
    const before = clone(state);
    try { return await fn(delegates); } catch (error) { state = before; throw error; }
  }) as any);
  const timeline = { date: day, rows: [] as Row[] };
  t.mock.method(captureWorkHoursData, "timelineRange", (async (options: any) => {
    calls.push({ model: "capture", op: "timeline", args: clone(options) });
    return [clone(timeline)];
  }) as any);
  return { get state() { return state; }, calls, timeline,
    capture(id = "agent", hours = 1, data = day) { timeline.rows.push({ employeeId: id, wbLogin: `wb_${id}`, slotId: `slot-${id}`, data, activeMs: hours * hour }); },
    decision(id: string, action: any) { return { id, action, revision: state.workHourCaptureDivergence.find((row) => row.id === id)!.updatedAt.toISOString() }; }
  };
}
const mutations = (calls: Row[]) => calls.filter((call) => !["findMany", "findFirst", "findUnique", "timeline"].includes(call.op));

function adherence(id = "adherence", employeeId = "agent", patch: Row = {}): Row {
  return { id, employeeId, date, scheduleId: `slot-${employeeId}`, supervisorId: null,
    reconciliationKey: `${employeeId}:${day}:slot-${employeeId}`, wbLogin: `wb_${employeeId}`, lob: "ADS", classification: "ADS",
    plannedStart: "23:00", plannedEnd: "08:00", sourceDurationMs: 6 * hour, status: "PENDING",
    justification: null, answeredById: null, answeredAt: null, ...patch };
}

test("excluir horas cancela justificativas e alertas do mesmo parceiro/data, preservando outros dias e a auditoria", async (t) => {
  const nextDate = new Date("2026-09-04T00:00:00Z");
  const f = fixture(t, {
    employeeProfile: [employee(), employee("other")], schedule: [slot()],
    workHourRecord: [{ id: "hours", employeeId: "agent", date, effectiveHours: 6.5 }, { id: "tomorrow", employeeId: "agent", date: nextDate }],
    workHourAdherenceJustification: [adherence(), adherence("answered", "agent", { reconciliationKey: `agent:${day}:previous-slot`, status: "JUSTIFIED", justification: "Motivo original", answeredById: "wfm", answeredAt: new Date() }),
      adherence("other-day", "agent", { date: nextDate }), adherence("other-agent", "other")],
    notification: ["adherence", "answered", "other-day", "other-agent"].map((entityId) => ({ id: `notice-${entityId}`, entity: "WorkHourAdherenceJustification", entityId, isRead: false, readAt: null }))
  });
  const schedules = clone(f.state.schedule);
  const result = await deleteWorkHourRecord(actor, { workHourRecordId: "hours" });
  assert.equal("success" in result && result.success, true);
  assert.deepEqual(f.state.workHourRecord.map((r) => r.id), ["tomorrow"]);
  assert.deepEqual(f.state.workHourAdherenceJustification.map((r) => r.status), ["CANCELLED", "CANCELLED", "PENDING", "PENDING"]);
  assert.equal(f.state.workHourAdherenceJustification[1].justification, null);
  assert.deepEqual(f.state.notification.map((r) => r.isRead), [true, true, false, false]);
  assert.deepEqual(f.state.schedule, schedules);
  assert.equal(f.state.auditLog.find((r) => r.entityId === "answered")!.previousValue.justification, "Motivo original");
  assert.ok("error" in await answerWorkHourAdherenceJustification(actor, { id: "adherence", justification: "Tela antiga" }));
});

test("sem horas, pendências antigas não aparecem nem aceitam novas respostas", async (t) => {
  const f = fixture(t, { employeeProfile: [employee()], workHourAdherenceJustification: [adherence()] });
  assert.deepEqual(await listWorkHourAdherenceJustifications(actor, { startDate: day, endDate: day }), { data: [] });
  const result = await answerWorkHourAdherenceJustification(actor, { id: "adherence", justification: "Motivo de uma tela antiga" });
  assert.ok("error" in result);
  assert.equal(mutations(f.calls).length, 0);
});

test("falha na exclusão reverte a limpeza de aderência, notificações e auditoria", async (t) => {
  const f = fixture(t, { workHourAdherenceJustification: [adherence()],
    notification: [{ id: "n", entity: "WorkHourAdherenceJustification", entityId: "adherence", isRead: false, readAt: null }] });
  const before = clone(f.state);
  await assert.rejects(prisma.$transaction(async (tx) => {
    await cancelAdherenceForDeletedWorkHours(tx, { employeeId: "agent", date, actorId: "wfm", reason: "Teste" });
    throw new Error("Delete failed");
  }, { isolationLevel: "Serializable" }), /Delete failed/);
  assert.deepEqual(f.state, before);
});

test("reimportar horas excluídas recria a pendência sem reutilizar a resposta anterior", async (t) => {
  const f = fixture(t, { employeeProfile: [employee()], schedule: [slot()] });
  f.capture("agent", 6);
  await commitCaptureWorkHoursImport(actor, { shiftDate: day });
  const id = f.state.workHourAdherenceJustification[0].id;
  await answerWorkHourAdherenceJustification(actor, { id, justification: "Resposta original" });
  await deleteWorkHourRecord(actor, { workHourRecordId: f.state.workHourRecord[0].id });
  await commitCaptureWorkHoursImport(actor, { shiftDate: day });
  assert.equal(f.state.workHourAdherenceJustification.length, 1);
  assert.equal(f.state.workHourAdherenceJustification[0].status, "PENDING");
  assert.equal(f.state.workHourAdherenceJustification[0].justification, null);
});

test("exporta XLSX válido com pendentes e justificadas, sem órfãos ou registros fora do período", async (t) => {
  const f = fixture(t, { employeeProfile: [employee(), employee("b"), employee("orphan")],
    workHourRecord: [{ id: "hours", employeeId: "agent", date }, { id: "hours-b", employeeId: "b", date }],
    workHourAdherenceJustification: [adherence(), adherence("answered", "b", { status: "JUSTIFIED", justification: "=Motivo informado", answeredAt: new Date("2026-09-03T14:00:00Z"), answeredBy: { name: "Supervisor" } }),
      adherence("orphan", "orphan"), adherence("old", "agent", { date: new Date("2026-09-02T00:00:00Z") })] });
  const result = await exportWorkHourAdherenceJustifications(actor, { startDate: day, endDate: day, lob: "ADS", shift: "Noite" });
  assert.ok("headers" in result);
  if (!("headers" in result)) return;
  assert.equal(result.rows.length, 2);
  const response = buildXlsxResponse(result);
  assert.match(response.headers.get("Content-Type")!, /spreadsheetml/);
  const book = XLSX.read(Buffer.from(await response.arrayBuffer()), { type: "buffer" });
  const sheet = book.Sheets.Justificativas;
  assert.equal(sheet.J3.v, "=Motivo informado");
  assert.equal(sheet.J3.t, "s");
  assert.equal(sheet.J3.f, undefined);
  assert.equal(sheet.K3.v, "Supervisor");
  assert.equal(sheet.L3.v, "03/09/2026, 11:00");
  assert.deepEqual(sheet["!autofilter"], { ref: "A1:L3" });
  assert.equal(mutations(f.calls).length, 0);
});

test("reimportação não recupera justificativa órfã de exclusão anterior à correção", async (t) => {
  const f = fixture(t, { employeeProfile: [employee()], schedule: [slot()],
    workHourAdherenceJustification: [adherence("legacy", "agent", { status: "JUSTIFIED", justification: "Resposta antiga" })] });
  f.capture("agent", 6);
  await commitCaptureWorkHoursImport(actor, { shiftDate: day });
  assert.equal(f.state.workHourAdherenceJustification[0].status, "PENDING");
  assert.equal(f.state.workHourAdherenceJustification[0].justification, null);
  assert.equal(f.state.auditLog.find((r) => r.entityId === "legacy" && r.action === "EXCLUSAO")!.previousValue.justification, "Resposta antiga");
});

test("exportação respeita escopo do supervisor e impede acesso de agente", async (t) => {
  const f = fixture(t, { employeeProfile: [employee(), employee("other")],
    workHourRecord: [{ id: "hours", employeeId: "agent", date }, { id: "hours-other", employeeId: "other", date }],
    workHourAdherenceJustification: [adherence("mine", "agent", { supervisorId: "supervisor" }), adherence("other", "other", { supervisorId: "someone-else" })] });
  Object.assign(f.state.user[0], { role: { name: "SUPERVISOR" }, employeeProfile: { id: "supervisor" } });
  const result = await exportWorkHourAdherenceJustifications(actor, { startDate: day, endDate: day });
  assert.ok("rows" in result && result.rows.length === 1 && result.rows[0][2] === "wb_agent");
  const forged = await exportWorkHourAdherenceJustifications(actor, { startDate: day, endDate: day, employeeId: "other" });
  assert.ok("rows" in forged && forged.rows.length === 0);
  Object.assign(f.state.user[0], { role: { name: "COLABORADOR" } });
  assert.ok("error" in await exportWorkHourAdherenceJustifications(actor, { startDate: day, endDate: day }));
});

test("nenhuma consulta da captura ou do cronograma para Staff, TI, nesting, treinamento e inativos", async (t) => {
  const profiles = [employee("staff", { roleTitle: "Staff" }), employee("ti", { lob: { name: "TI" } }), employee("nesting", { operationalStatus: "Nesting" }),
    employee("training", { operationalStatus: "Em treinamento" }), employee("trainee", { roleTitle: "Trainee" }), employee("inactive", { operationalStatus: "Inativo" })];
  const f = fixture(t, { employeeProfile: profiles, schedule: profiles.map((p, i) => slot(p.id, i % 2 ? "VENDA_FOLGA_APROVADA" : "TROCA_APROVADA")) });
  const before = clone(f.state);
  const result: any = await previewCaptureWorkHoursImport(actor, { shiftDate: day });
  assert.deepEqual(result.data.summary, { automatic: 0, divergences: 0, ignored: 0 });
  assert.ok(f.calls.every((call) => ["user", "employeeProfile"].includes(call.model)));
  assert.deepEqual(f.state, before);
});
test("data única é obrigatória antes de consultar agentes, horas ou captura", async (t) => {
  const f = fixture(t);
  for (const input of [{}, { startDate: day, endDate: "2026-09-04" }, { shiftDate: "2026-02-31" }]) {
    assert.ok("error" in await previewCaptureWorkHoursImport(actor, input));
  }
  assert.ok(f.calls.every((call) => call.model === "user"));
});
test("horas existentes são verificadas antes do cruzamento; captura só recebe IDs elegíveis", async (t) => {
  const f = fixture(t, { employeeProfile: [employee(), employee("ti", { skill: "TI" })], schedule: [slot()] });
  f.capture();
  await previewCaptureWorkHoursImport(actor, { shiftDate: day });
  const hoursIndex = f.calls.findIndex((c) => c.model === "workHourRecord");
  assert.ok(hoursIndex < f.calls.findIndex((c) => c.model === "capture"));
  assert.ok(hoursIndex < f.calls.findIndex((c) => c.model === "schedule"));
  assert.deepEqual(f.calls.find((c) => c.model === "capture")!.args, { dates: [day], eligibleEmployeeIds: ["agent"], eligibleWbLogins: ["wb_agent"] });
  assert.equal(mutations(f.calls).length, 0);
});
test("turno noturno 23–08 é salvo pelo Shift Date, não pelo dia da saída; reimportação não duplica", async (t) => {
  const f = fixture(t, { employeeProfile: [employee()], schedule: [slot()] });
  f.capture("agent", 6.5); f.capture("agent", 9, "2026-09-04");
  const first: any = await commitCaptureWorkHoursImport(actor, { shiftDate: day });
  assert.equal(first.data.imported, 1);
  assert.equal(f.state.workHourRecord.length, 1);
  assert.equal(f.state.workHourRecord[0].date.toISOString().slice(0, 10), day);
  assert.equal(f.state.workHourRecord[0].effectiveHours, 7);
  assert.equal(f.state.schedule[0].status, "PRESENTE");
  const denied: any = await commitCaptureWorkHoursImport(actor, { shiftDate: day });
  assert.equal(denied.code, "REPROCESS_CONFIRMATION_REQUIRED");
  const second: any = await commitCaptureWorkHoursImport(actor, { shiftDate: day, confirmReprocessing: true });
  assert.equal(second.data.unchanged, 1);
  assert.equal(f.state.workHourRecord.length, 1);
  assert.equal(f.state.workHourRecord[0].effectiveHours, 7);
  assert.equal(f.state.workHourAdherenceJustification.length, 1);
  assert.equal(f.state.scheduleChangeHistory.length, 1);
});
test("presença manual aplica regra e aderência; escolha não altera nada antes do lote", async (t) => {
  const f = fixture(t, { employeeProfile: [employee()], schedule: [slot()], workHourCaptureDivergence: [divergence()] });
  const choice = f.decision("div-agent", "CONFIRM_PRESENCE");
  assert.equal(f.state.workHourRecord.length, 0);
  const result: any = await applyCaptureWorkHourDivergenceDecisions(actor, { shiftDate: day, decisions: [choice], confirmed: true });
  assert.equal(result.data.resolved, 1);
  assert.equal(f.state.schedule[0].status, "PRESENTE");
  assert.equal(f.state.workHourRecord[0].effectiveHours, 1.5);
  assert.equal(f.state.workHourAdherenceJustification.length, 1);
  const duplicate = await applyCaptureWorkHourDivergenceDecisions(actor, { shiftDate: day, decisions: [choice], confirmed: true });
  assert.ok("error" in duplicate);
  assert.equal(f.state.workHourRecord.length, 1);
});
for (const [action, status] of [["CONFIRM_ABSENCE", "FALTA"], ["CONFIRM_DAY_OFF", "FOLGA"]]) {
  test(`${action} retira horas e segue fluxo correto de falta/folga`, async (t) => {
    const f = fixture(t, { employeeProfile: [employee()], schedule: [slot()], workHourCaptureDivergence: [divergence()],
      workHourRecord: [{ id: "hours", employeeId: "agent", date, effectiveHours: 8, actualHours: 8 }] });
    const result: any = await applyCaptureWorkHourDivergenceDecisions(actor, { shiftDate: day, decisions: [f.decision("div-agent", action)], confirmed: true });
    assert.equal(result.data.resolved, 1);
    assert.equal(f.state.schedule[0].status, status);
    assert.equal(f.state.workHourRecord.length, 0);
    assert.equal(f.state.attendanceRecord.length, status === "FALTA" ? 1 : 0);
    if (status === "FALTA") assert.equal(f.state.attendanceRecord[0].absenceReason, "Sem justificativa");
  });
}
test("Manter e Pendente aplicados juntos preservam cronograma/horas e registram auditoria distinta", async (t) => {
  const f = fixture(t, { employeeProfile: [employee("a"), employee("b")], schedule: [slot("a"), slot("b")],
    workHourRecord: [{ id: "hours-a", employeeId: "a", date, effectiveHours: 8 }], workHourCaptureDivergence: [divergence("a"), divergence("b")] });
  const schedules = clone(f.state.schedule), hours = clone(f.state.workHourRecord);
  const result: any = await applyCaptureWorkHourDivergenceDecisions(actor, { shiftDate: day,
    decisions: [f.decision("div-a", "KEEP_SCHEDULE"), f.decision("div-b", "KEEP_PENDING")], confirmed: true });
  assert.deepEqual([result.data.resolved, result.data.pending], [1, 1]);
  assert.deepEqual(f.state.schedule, schedules); assert.deepEqual(f.state.workHourRecord, hours);
  assert.deepEqual(f.state.workHourCaptureDivergence.map((d) => d.status), ["RESOLVED", "PENDING"]);
  assert.equal(f.state.auditLog.length, 2);
  assert.match(f.state.auditLog[0].reason, /sem alteração/);
  assert.equal(f.state.auditLog[1].newValue.status, "PENDING");
  const listed: any = await listCaptureWorkHourDivergences(actor, { shiftDate: day, lob: "CEC", supervisor: "não existe" });
  assert.deepEqual(listed.data.map((d: Row) => d.id), ["div-b"]); // slicers never restrict the source.
});
test("Manter cronograma não reabre com mesma fonte; alteração na captura reabre", async (t) => {
  const f = fixture(t, { employeeProfile: [employee()], schedule: [slot()], workHourCaptureDivergence: [divergence()] });
  f.capture();
  await applyCaptureWorkHourDivergenceDecisions(actor, { shiftDate: day, decisions: [f.decision("div-agent", "KEEP_SCHEDULE")], confirmed: true });
  let result: any = await commitCaptureWorkHoursImport(actor, { shiftDate: day });
  assert.equal(result.data.divergences, 0);
  assert.equal(f.state.schedule[0].status, "ESCALADO");
  f.timeline.rows[0].activeMs += 60_000;
  result = await commitCaptureWorkHoursImport(actor, { shiftDate: day });
  assert.equal(result.data.divergences, 1);
  assert.equal(f.state.workHourCaptureDivergence.length, 1);
  assert.equal(f.state.workHourCaptureDivergence[0].status, "PENDING");
});
test("lote rejeitado integralmente quando uma linha está desatualizada ou inelegível", async (t) => {
  const f = fixture(t, { employeeProfile: [employee("a"), employee("b")], schedule: [slot("a"), slot("b")], workHourCaptureDivergence: [divergence("a"), divergence("b")] });
  const before = clone(f.state);
  const result = await applyCaptureWorkHourDivergenceDecisions(actor, { shiftDate: day, decisions: [f.decision("div-a", "CONFIRM_PRESENCE"), { ...f.decision("div-b", "CONFIRM_ABSENCE"), revision: "old" }], confirmed: true });
  assert.ok("error" in result); assert.deepEqual(f.state, before);
  f.state.employeeProfile[1].operationalStatus = "Nesting";
  assert.ok("error" in await applyCaptureWorkHourDivergenceDecisions(actor, { shiftDate: day, decisions: [f.decision("div-a", "CONFIRM_PRESENCE"), f.decision("div-b", "CONFIRM_ABSENCE")], confirmed: true }));
  assert.equal(f.state.workHourRecord.length, 0);
});
test("presença explícita sem captura aplica fórmula sobre zero e exige aderência", async (t) => {
  const f = fixture(t, { employeeProfile: [employee()], schedule: [slot()], workHourCaptureDivergence: [divergence("agent", 0, { sourceDurationMs: null })] });
  const result: any = await applyCaptureWorkHourDivergenceDecisions(actor, { shiftDate: day, decisions: [f.decision("div-agent", "CONFIRM_PRESENCE")], confirmed: true });
  assert.equal(result.data.resolved, 1);
  assert.equal(f.state.workHourRecord[0].effectiveHours, 0.5);
  assert.equal(f.state.workHourAdherenceJustification[0].sourceDurationMs, 0);
  assert.equal(f.state.schedule[0].status, "PRESENTE");
});
