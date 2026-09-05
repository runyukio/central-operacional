import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { prisma } from "./prisma";
import { answerWorkHourAdherenceJustification, applyCaptureWorkHourDivergenceDecisions, captureWorkHoursData, commitCaptureWorkHoursImport, exportWorkHourAdherenceJustifications, listCaptureWorkHourDivergences, listWorkHourAdherenceJustifications, previewCaptureWorkHoursImport } from "./work-hours-capture-integration-service";
import { deleteWorkHourRecord, upsertManualWorkHourRecord } from "./work-hours-service";
import { cancelAdherenceForDeletedWorkHours } from "./work-hours-adherence-cleanup";
import { buildXlsxResponse } from "./xlsx-export";
import * as XLSX from "xlsx";
import { z } from "zod";
import { resolveCapturePeriod } from "./work-hours-capture-period";
import { capturePeriodShape, validateCapturePeriod } from "./work-hours-capture-period-schema";
import { CaptureBatchError, captureImportNeedsReview, processCaptureImportDays } from "./work-hours-capture-batch";

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
    if (["workHourRecord", "workHourCaptureDivergence", "workHourAdherenceJustification"].includes(model)) {
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
    for (const op of ["findFirst", "findUnique", "findUniqueOrThrow", "findMany", "create", "upsert", "update", "updateMany", "delete"] as const) {
      const impl = async (args: any = {}) => {
        calls.push({ model, op, args: clone(args) });
        const found = state[model].filter((row) => matches(hydrate(model, row), args.where));
        if (op === "findMany") return found.map((row) => hydrate(model, row));
        if (op === "findUnique" || op === "findFirst") return found[0] ? hydrate(model, found[0]) : null;
        if (op === "findUniqueOrThrow") { if (!found[0]) throw new Error(`Missing ${model}`); return hydrate(model, found[0]); }
        if (op === "delete") { state[model] = state[model].filter((row) => row !== found[0]); return found[0]; }
        if (op === "updateMany") { found.forEach((row) => Object.assign(row, clone(args.data))); return { count: found.length }; }
        if (op === "update" && !found.length) throw new Error(`Missing ${model}`);
        const existing = op !== "create" ? found[0] : null;
        const data = op === "upsert" ? existing ? args.update : args.create : args.data;
        const saved = existing ?? { id: `${model}-${++serial}`, status: "PENDING", createdAt: new Date(),
          ...(model === "notification" ? { isRead: false, readAt: null } : {}) };
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
const mutations = (calls: Row[]) => calls.filter((call) => !["findMany", "findFirst", "findUnique", "findUniqueOrThrow", "timeline"].includes(call.op));

test("Go Live ausente não fica invisível na prévia nem na tela de divergências, mesmo sem elegíveis", async (t) => {
  const f = fixture(t, { employeeProfile: [employee("otavioc", { goLiveDate: null })], schedule: [slot("otavioc")] });
  f.capture("otavioc", 8.25);
  const before = clone(f.state);
  const preview: any = await previewCaptureWorkHoursImport(actor, { shiftDate: day });
  assert.deepEqual(preview.data.summary, { automatic: 0, divergences: 0, ignored: 0 });
  const listed: any = await listCaptureWorkHourDivergences(actor, { shiftDate: day });
  assert.deepEqual(listed.data, []);
  assert.deepEqual(listed.registrationWarnings, preview.data.registrationWarnings);
  assert.deepEqual(listed.registrationWarnings.map((r: any) => [r.wbLogin, r.date, r.code, r.slot]),
    [["wb_otavioc", day, "MISSING_GO_LIVE", "23:00 - 08:00"]]);
  assert.match(listed.registrationWarnings[0].reason, /Go Live não preenchido/);
  assert.equal(f.calls.some((call) => call.model === "capture"), false);
  assert.deepEqual(f.state, before);
});

test("bloqueios preservam horas e cronograma existentes, não criam falta nem aceitam decisões de presença", async (t) => {
  const f = fixture(t, { employeeProfile: [employee("otavioc", { goLiveDate: null })], schedule: [slot("otavioc")],
    workHourRecord: [{ id: "saved-hours", employeeId: "otavioc", date, effectiveHours: 8 }] });
  const schedules = clone(f.state.schedule);
  const hours = clone(f.state.workHourRecord);
  const result: any = await commitCaptureWorkHoursImport(actor, { shiftDate: day });
  assert.equal(result.data.blocked, 1);
  assert.equal(result.data.imported, 0);
  assert.equal(result.data.divergences, 0);
  assert.equal(captureImportNeedsReview(result.data), true);
  const decision = await applyCaptureWorkHourDivergenceDecisions(actor, { shiftDate: day, confirmed: true,
    decisions: [{ id: "registration:slot-otavioc", action: "CONFIRM_PRESENCE", revision: new Date().toISOString() }] });
  assert.ok("error" in decision);
  assert.deepEqual(f.state.schedule, schedules);
  assert.deepEqual(f.state.workHourRecord, hours);
  for (const model of ["workHourCaptureDivergence", "workHourAdherenceJustification", "attendanceRecord"]) assert.equal(f.state[model].length, 0);
});

test("bloqueios respeitam período e filtros da importação; revisão mostra todo período com slicers locais", async (t) => {
  const otherDay = new Date("2026-09-04T00:00:00Z");
  fixture(t, { employeeProfile: [employee("ads", { goLiveDate: null }), employee("cec", { goLiveDate: null, lob: { name: "CEC" } }), employee("no-slot", { goLiveDate: null })],
    schedule: [slot("ads"), slot("cec"), { ...slot("ads"), id: "tomorrow", date: otherDay }] });
  const preview: any = await previewCaptureWorkHoursImport(actor, { shiftDate: day, lob: "ADS" });
  assert.deepEqual(preview.data.registrationWarnings.map((r: any) => r.wbLogin), ["wb_ads"]);
  const listed: any = await listCaptureWorkHourDivergences(actor, { startDate: day, endDate: "2026-09-04", lob: "ADS" });
  assert.deepEqual(listed.registrationWarnings.map((r: any) => [r.wbLogin, r.date]), [["wb_ads", day], ["wb_cec", day], ["wb_ads", "2026-09-04"]]);
  const morning: any = await previewCaptureWorkHoursImport(actor, { shiftDate: day, shift: "Manhã" });
  assert.deepEqual(morning.data.registrationWarnings, []);
});

test("exclusões esperadas e slots Nesting/Treinamento não viram bloqueios de cadastro", async (t) => {
  const profiles: Row[] = [employee("staff", { roleTitle: "Staff" }), employee("ti", { lob: { name: "TI" } }),
    employee("inactive", { operationalStatus: "Inativo" }), employee("nesting", { operationalStatus: "Nesting" }),
    employee("training", { operationalStatus: "Em treinamento" }), employee("slot-nesting"), employee("slot-training"),
    employee("deleted", { deletedAt: new Date() })].map((p) => ({ ...p, goLiveDate: null }));
  profiles.push(employee("future", { goLiveDate: new Date("2026-09-10") }));
  fixture(t, { employeeProfile: profiles, schedule: profiles.map((p) => slot(p.id,
    p.id === "slot-nesting" ? "NESTING" : p.id === "slot-training" ? "TREINAMENTO" : "ESCALADO")) });
  const preview: any = await previewCaptureWorkHoursImport(actor, { shiftDate: day });
  assert.deepEqual(preview.data.registrationWarnings, []);
  const listed: any = await listCaptureWorkHourDivergences(actor, { shiftDate: day });
  assert.deepEqual(listed.registrationWarnings, []);
});

test("corrigir Go Live remove o bloqueio sem importar sozinho; nova importação processa as horas", async (t) => {
  const f = fixture(t, { employeeProfile: [employee("otavioc", { goLiveDate: null })], schedule: [slot("otavioc")] });
  f.capture("otavioc", 8.25);
  const blocked: any = await listCaptureWorkHourDivergences(actor, { shiftDate: day });
  assert.equal(blocked.registrationWarnings.length, 1);
  f.state.employeeProfile[0].goLiveDate = date;
  const fixed: any = await listCaptureWorkHourDivergences(actor, { shiftDate: day });
  assert.deepEqual(fixed.registrationWarnings, []);
  assert.equal(f.state.workHourRecord.length, 0);
  const result: any = await commitCaptureWorkHoursImport(actor, { shiftDate: day });
  assert.equal(result.data.blocked, 0);
  assert.equal(result.data.imported, 1);
  assert.equal(f.state.workHourRecord[0].effectiveHours, 8.75);
});

test("bloqueios coexistem com divergências reais e continuam protegidos pela autorização", async (t) => {
  const f = fixture(t, { employeeProfile: [employee(), employee("blocked", { goLiveDate: null })],
    schedule: [slot(), slot("blocked")], workHourCaptureDivergence: [divergence()] });
  const result: any = await listCaptureWorkHourDivergences(actor, { shiftDate: day });
  assert.deepEqual(result.data.map((r: any) => r.id), ["div-agent"]);
  assert.equal(result.registrationWarnings.length, 1);
  f.state.user[0].role.name = "COLABORADOR";
  f.calls.length = 0;
  assert.ok("error" in await listCaptureWorkHourDivergences(actor, { shiftDate: day }));
  assert.ok(f.calls.every((call) => call.model === "user"));
});

test("lote com apenas bloqueios cadastrais também abre revisão e acumula todos os dias", async () => {
  const result = await processCaptureImportDays({ startDate: day, endDate: "2026-09-04" }, async () => ({
    imported: 0, unchanged: 0, divergences: 0, ignored: 0, blocked: 1
  }), () => {});
  assert.equal(result.blocked, 2);
  assert.equal(captureImportNeedsReview(result), true);
  assert.equal(captureImportNeedsReview({ imported: 1, unchanged: 0, divergences: 0, ignored: 0 }), false);
  assert.equal(captureImportNeedsReview({ imported: 0, unchanged: 0, divergences: 1, ignored: 0 }), true);
});

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
  assert.equal(sheet.M3.v, "Captura de Horas");
  assert.deepEqual(sheet["!autofilter"], { ref: "A1:M3" });
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

test("filtros independentes combinam período/LOB/turno/parceiro/supervisor/status na consulta e no XLSX, sem escrita", async (t) => {
  const profiles = [employee(), employee("other"), employee("morning", { shift: { name: "Manhã" } }), employee("cec", { lob: { name: "CEC" } })];
  const f = fixture(t, {
    employeeProfile: profiles,
    workHourRecord: profiles.map((p) => ({ id: `hours-${p.id}`, employeeId: p.id, date })),
    workHourAdherenceJustification: [
      adherence("pending", "agent", { supervisorId: "sup-a", supervisor: { fullName: "Supervisor" } }),
      adherence("answered", "agent", { supervisorId: "sup-a", status: "JUSTIFIED", justification: "Justificativa anterior" }),
      adherence("same-name", "agent", { supervisorId: "sup-b", supervisor: { fullName: "Supervisor" } }),
      adherence("other-partner", "other", { supervisorId: "sup-a" }),
      adherence("morning", "morning", { supervisorId: "sup-a" }),
      adherence("cec", "cec", { supervisorId: "sup-a", lob: "CEC" }),
      adherence("old", "agent", { supervisorId: "sup-a", date: new Date("2026-09-02T00:00:00Z") }),
      adherence("cancelled", "agent", { supervisorId: "sup-a", status: "CANCELLED" })
    ]
  });
  const before = clone(f.state);
  const filters = { startDate: day, endDate: day, lob: "ADS", shift: "Noite", employeeId: "agent", supervisorId: "sup-a", justificationStatus: "Pendentes" };
  const listed = await listWorkHourAdherenceJustifications(actor, filters);
  assert.ok("data" in listed);
  if (!("data" in listed)) return;
  assert.deepEqual(listed.data.map((r) => [r.id, r.employeeId, r.supervisorId, r.shift]), [["pending", "agent", "sup-a", "Noite"]]);
  const pending = await exportWorkHourAdherenceJustifications(actor, filters);
  assert.ok("rows" in pending && pending.rows.length === 1 && pending.rows[0][8] === "Pendente");
  const answered = await exportWorkHourAdherenceJustifications(actor, { ...filters, justificationStatus: "Justificados" });
  assert.ok("rows" in answered && answered.rows.length === 1 && answered.rows[0][9] === "Justificativa anterior");
  const all = await listWorkHourAdherenceJustifications(actor, { ...filters, justificationStatus: "Todos" });
  assert.ok("data" in all && all.data.length === 2);
  assert.deepEqual(f.state, before);
  assert.equal(mutations(f.calls).length, 0);
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
  const forgedSupervisor = await exportWorkHourAdherenceJustifications(actor, { startDate: day, endDate: day, supervisorId: "someone-else", justificationStatus: "Pendentes" });
  assert.ok("rows" in forgedSupervisor && forgedSupervisor.rows.length === 0);
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
for (const status of ["NESTING", "TREINAMENTO"]) {
  test(`slot ${status} de agente ativo não recebe presença, horas ou divergência, mesmo reimportando`, async (t) => {
    const ids = ["none", "short", "long", "onboarding"];
    const f = fixture(t, { employeeProfile: ids.map((id) => employee(id, id === "onboarding" ? { skill: "Onboarding" } : {})),
      schedule: ids.map((id) => slot(id, status)),
      workHourRecord: [{ id: "existing", employeeId: "long", date, effectiveHours: 7, actualHours: 7, status: "OK", scheduleId: "slot-long" }] });
    f.capture("short", 1); f.capture("long", 10); f.capture("onboarding", 5);
    const before = clone(f.state);
    const preview: any = await previewCaptureWorkHoursImport(actor, { shiftDate: day });
    assert.deepEqual(preview.data.summary, { automatic: 0, divergences: 0, ignored: 0 });
    assert.equal(preview.data.overlap.count, 0);
    for (const confirmReprocessing of [false, true]) {
      const result: any = await commitCaptureWorkHoursImport(actor, { shiftDate: day, confirmReprocessing });
      assert.equal(result.data?.imported, 0, result.error);
      assert.equal(result.data?.divergences, 0);
    }
    for (const model of ["schedule", "workHourRecord", "workHourCaptureDivergence", "workHourAdherenceJustification", "attendanceRecord", "notification"]) {
      assert.deepEqual(f.state[model], before[model], model);
    }
    assert.ok(mutations(f.calls).every((call) => call.model === "workHourCaptureImportRun" || (call.model === "auditLog" && call.args.data.entity === "WorkHourCaptureImportRun")));
  });

  test(`divergência antiga de slot ${status} não aparece nem permite alterar presença/falta/folga`, async (t) => {
    const f = fixture(t, { employeeProfile: [employee(), employee("valid")], schedule: [slot("agent", status), slot("valid")],
      workHourCaptureDivergence: [divergence("agent", hour, { scheduleStatus: status }), divergence("valid")] });
    const result: any = await listCaptureWorkHourDivergences(actor, { shiftDate: day });
    assert.deepEqual(result.data.map((r: Row) => r.id), ["div-valid"]);
    const before = clone(f.state);
    for (const action of ["CONFIRM_PRESENCE", "CONFIRM_ABSENCE", "CONFIRM_DAY_OFF", "KEEP_SCHEDULE", "KEEP_PENDING"]) {
      const applied: any = await applyCaptureWorkHourDivergenceDecisions(actor, { shiftDate: day, confirmed: true,
        decisions: [f.decision("div-valid", "CONFIRM_PRESENCE"), f.decision("div-agent", action)] });
      assert.match(applied.error, /Nesting|Treinamento/);
      assert.deepEqual(f.state, before);
    }
    assert.equal(mutations(f.calls).length, 0);
  });
}

test("range preserva dia em Nesting e processa somente o dia em produção do mesmo agente", async (t) => {
  const next = "2026-09-04";
  const f = fixture(t, { employeeProfile: [employee()], schedule: [slot("agent", "NESTING"),
    { ...slot(), id: "slot-next", date: new Date(`${next}T00:00:00Z`) }] });
  f.capture("agent", 6); f.capture("agent", 6, next);
  const result: any = await commitCaptureWorkHoursImport(actor, { startDate: day, endDate: next });
  assert.equal(result.data?.imported, 1, result.error);
  assert.deepEqual(f.state.schedule.map((r) => r.status), ["NESTING", "PRESENTE"]);
  assert.deepEqual(f.state.workHourRecord.map((r) => [r.date.toISOString().slice(0, 10), r.effectiveHours]), [[next, 6.5]]);
  assert.deepEqual(f.state.workHourAdherenceJustification.map((r) => r.date.toISOString().slice(0, 10)), [next]);
});

test("Onboarding ativo em produção importa 8h fixas, inclusive no cadastro de skills múltiplas, sem duplicar", async (t) => {
  const f = fixture(t, { employeeProfile: [employee("legacy", { skill: "Onboarding", lob: { name: "CEC" } }),
    employee("multi", { skillAssignments: [{ isPrimary: true, skill: { name: "Onboarding", normalizedName: "ONBOARDING" } }], lob: { name: "CEC" } })],
    schedule: [slot("legacy"), slot("multi")] });
  f.capture("legacy", 5); f.capture("multi", 10.5);
  const result: any = await commitCaptureWorkHoursImport(actor, { shiftDate: day });
  assert.equal(result.data?.imported, 2, result.error);
  assert.deepEqual(f.state.workHourRecord.map((r) => [r.effectiveHours, r.observation]), [[8, "RA/Onboarding: 8:00 fixas"], [8, "RA/Onboarding: 8:00 fixas"]]);
  assert.ok(f.state.schedule.every((r) => r.status === "PRESENTE"));
  assert.deepEqual(f.state.workHourAdherenceJustification.map((r) => [r.employeeId, r.sourceDurationMs]), [["legacy", 5 * hour]]);
  const repeated: any = await commitCaptureWorkHoursImport(actor, { shiftDate: day, confirmReprocessing: true });
  assert.equal(repeated.data?.unchanged, 2, repeated.error);
  assert.equal(f.state.workHourRecord.length, 2);
});

test("Onboarding sem captura ou com captura curta continua exigindo revisão antes de receber horas", async (t) => {
  const f = fixture(t, { employeeProfile: [employee("none", { skill: "Onboarding" }), employee("short", { skill: "Onboarding" })],
    schedule: [slot("none"), slot("short")] });
  f.capture("short", 1);
  const result: any = await commitCaptureWorkHoursImport(actor, { shiftDate: day });
  assert.equal(result.data?.divergences, 2, result.error);
  assert.equal(f.state.workHourRecord.length, 0);
  assert.ok(f.state.schedule.every((r) => r.status === "ESCALADO"));
  const item = f.state.workHourCaptureDivergence.find((r) => r.employeeId === "short")!;
  const applied: any = await applyCaptureWorkHourDivergenceDecisions(actor, { shiftDate: day, confirmed: true,
    decisions: [f.decision(item.id, "CONFIRM_PRESENCE")] });
  assert.equal(applied.data?.resolved, 1, applied.error);
  assert.equal(f.state.workHourRecord[0].effectiveHours, 8);
});

test("horas manuais abaixo de 7:25 geram justificativa e aviso, sem bônus, duplicação ou mudança de slot", async (t) => {
  const f = fixture(t, { employeeProfile: [employee("agent", { supervisorId: "sup" }), employee("sup", { roleTitle: "Supervisor", userId: "sup-user" })], schedule: [slot()] });
  const input = { employeeId: "agent", date: day, actualHours: "6:30" };
  const result: any = await upsertManualWorkHourRecord(actor, input);
  assert.equal(result.success, true, result.error);
  assert.equal(f.state.workHourRecord[0].effectiveHours, 6.5);
  assert.equal(f.state.schedule[0].status, "ESCALADO");
  assert.equal(f.state.attendanceRecord.length, 0);
  const pending = f.state.workHourAdherenceJustification[0];
  assert.equal(pending.date.toISOString().slice(0, 10), day);
  assert.equal(pending.sourceDurationMs, 6.5 * hour);
  assert.equal(pending.status, "PENDING");
  assert.equal(f.state.notification.length, 1);
  assert.match(f.state.notification[0].body, /lançamento manual/);
  const listed: any = await listWorkHourAdherenceJustifications(actor, { startDate: day, endDate: day });
  assert.equal(listed.data[0].durationSource, "Horas manuais");
  const exported: any = await exportWorkHourAdherenceJustifications(actor, { startDate: day, endDate: day });
  assert.equal(exported.rows[0][12], "Horas manuais");
  await upsertManualWorkHourRecord(actor, input);
  assert.equal(f.state.workHourAdherenceJustification.length, 1);
  assert.equal(f.state.notification.length, 1);
  await answerWorkHourAdherenceJustification(actor, { id: pending.id, justification: "Motivo válido" });
  await upsertManualWorkHourRecord(actor, input);
  assert.equal(f.state.workHourAdherenceJustification[0].status, "JUSTIFIED");
  assert.equal(f.state.workHourAdherenceJustification[0].justification, "Motivo válido");
  assert.equal(f.state.notification.length, 1);
  const changed: any = await upsertManualWorkHourRecord(actor, { ...input, actualHours: "6:00" });
  assert.equal(changed.success, true, changed.error);
  assert.equal(f.state.workHourAdherenceJustification[0].status, "PENDING");
  assert.equal(f.state.workHourAdherenceJustification[0].justification, null);
  assert.equal(f.state.notification.length, 2);
});

test("correção manual para 7:25 encerra a pendência e o aviso; reduzir novamente reabre só o mesmo dia", async (t) => {
  const f = fixture(t, { employeeProfile: [employee("agent", { supervisorId: "sup" }), employee("sup", { roleTitle: "Supervisor", userId: "sup-user" })], schedule: [slot()] });
  const input = { employeeId: "agent", date: day, actualHours: "7:24" };
  await upsertManualWorkHourRecord(actor, input);
  const id = f.state.workHourAdherenceJustification[0].id;
  await answerWorkHourAdherenceJustification(actor, { id, justification: "Justificativa anterior" });
  f.state.workHourAdherenceJustification.push(adherence("other-day", "agent", { date: new Date("2026-09-02T00:00:00Z") }));
  const result: any = await upsertManualWorkHourRecord(actor, { ...input, actualHours: "7:25" });
  assert.equal(result.success, true, result.error);
  assert.equal(f.state.workHourAdherenceJustification[0].status, "CANCELLED");
  assert.equal(f.state.workHourAdherenceJustification[1].status, "PENDING");
  assert.ok(f.state.notification.every((n) => n.isRead));
  assert.ok(f.state.auditLog.some((a) => a.entityId === id && a.previousValue?.justification === "Justificativa anterior"));
  const reopened: any = await upsertManualWorkHourRecord(actor, input);
  assert.equal(reopened.success, true, reopened.error);
  assert.equal(f.state.workHourAdherenceJustification[0].status, "PENDING");
  assert.equal(f.state.workHourAdherenceJustification[0].justification, null);
});

test("horas manuais respeitam limite exato e não aplicam regra de 8h da skill Onboarding", async (t) => {
  const ids = ["zero", "low", "threshold", "above"];
  const f = fixture(t, { employeeProfile: ids.map((id) => employee(id, { skill: "Onboarding" })), schedule: ids.map((id) => slot(id)) });
  for (const [employeeId, actualHours] of [["zero", "0:00"], ["low", "7:24"], ["threshold", "7:25"], ["above", "8:00"]]) {
    const result: any = await upsertManualWorkHourRecord(actor, { employeeId, date: day, actualHours });
    assert.equal(result.success, true, result.error);
  }
  assert.deepEqual(f.state.workHourAdherenceJustification.map((r) => r.employeeId), ["zero", "low"]);
  assert.equal(f.state.workHourRecord.find((r) => r.employeeId === "low")!.effectiveHours, 7.4);
});

test("lançamento manual em Nesting/Treinamento permanece bloqueado, inclusive se slot mudar durante salvamento", async (t) => {
  const f = fixture(t, { employeeProfile: [employee("nesting"), employee("training"), employee()],
    schedule: [slot("nesting", "NESTING"), slot("training", "TREINAMENTO"), slot()] });
  for (const employeeId of ["nesting", "training"]) {
    assert.ok("error" in await upsertManualWorkHourRecord(actor, { employeeId, date: day, actualHours: "6:00" }));
  }
  const find = prisma.schedule.findUnique;
  let reads = 0;
  t.mock.method(prisma.schedule, "findUnique", (async (args: any) => {
    const result: any = await find(args);
    if (++reads === 2) result.status = "NESTING";
    return result;
  }) as any);
  assert.ok("error" in await upsertManualWorkHourRecord(actor, { employeeId: "agent", date: day, actualHours: "6:00" }));
  assert.equal(mutations(f.calls).length, 0);
});

test("manual não gera aderência para Staff, TI, inativos ou pré-Go-Live", async (t) => {
  const profiles = [employee("staff", { roleTitle: "Staff" }), employee("it", { lob: { name: "IT" } }),
    employee("inactive", { operationalStatus: "Inativo" }), employee("prelive", { goLiveDate: new Date("2026-09-04") })];
  const f = fixture(t, { employeeProfile: profiles, schedule: profiles.map((p) => slot(p.id)) });
  for (const p of profiles) {
    const result: any = await upsertManualWorkHourRecord(actor, { employeeId: p.id, date: day, actualHours: "6:00" });
    assert.equal(result.success, true, result.error);
  }
  assert.equal(f.state.workHourAdherenceJustification.length, 0);
  assert.equal(f.state.notification.length, 0);
});

test("falha ao criar justificativa reverte também o lançamento manual de horas", async (t) => {
  const f = fixture(t, { employeeProfile: [employee()], schedule: [slot()] });
  const before = clone(f.state);
  t.mock.method(prisma.workHourAdherenceJustification, "upsert", async () => { throw new Error("Simulated adherence failure"); });
  assert.ok("error" in await upsertManualWorkHourRecord(actor, { employeeId: "agent", date: day, actualHours: "6:00" }));
  assert.deepEqual(f.state, before);
});

test("sobrescrita manual da captura exige confirmação e substitui a duração usada na justificativa", async (t) => {
  const f = fixture(t, { employeeProfile: [employee()], schedule: [slot()] });
  f.capture("agent", 6);
  await commitCaptureWorkHoursImport(actor, { shiftDate: day });
  const id = f.state.workHourAdherenceJustification[0].id;
  await answerWorkHourAdherenceJustification(actor, { id, justification: "Motivo da captura" });
  const input = { employeeId: "agent", date: day, actualHours: "5:30" };
  const before = clone(f.state);
  const refused: any = await upsertManualWorkHourRecord(actor, input);
  assert.equal(refused.type, "CONFIRMATION_REQUIRED");
  assert.deepEqual(f.state, before);
  const result: any = await upsertManualWorkHourRecord(actor, { ...input, confirmOverwrite: true });
  assert.equal(result.success, true, result.error);
  assert.equal(f.state.workHourAdherenceJustification[0].sourceDurationMs, 5.5 * hour);
  assert.equal(f.state.workHourAdherenceJustification[0].status, "PENDING");
  assert.equal(f.state.workHourAdherenceJustification[0].justification, null);
  assert.equal(f.state.workHourRecord.length, 1);
});

test("período válido é obrigatório antes de consultar agentes, horas ou captura", async (t) => {
  const f = fixture(t);
  for (const input of [{}, { startDate: day }, { startDate: day, endDate: "2026-09-02" }, { shiftDate: "2026-02-31" },
    { startDate: "2026-02-31", endDate: "2026-03-05" }, { startDate: "2026-01-01", endDate: "2026-09-04" }]) {
    assert.ok("error" in await previewCaptureWorkHoursImport(actor, input));
  }
  assert.ok(f.calls.every((call) => call.model === "user"));
});

test("ordem das skills não simula mudança de classificação entre plano e transação", async (t) => {
  const skills = ["Material Queues", "Account", "Freshchat"].map((name) => ({ isPrimary: false, skill: { name, normalizedName: name } }));
  const f = fixture(t, { employeeProfile: [employee("agent", { skillAssignments: skills })], schedule: [slot()] });
  f.capture("agent", 6);
  const find = prisma.employeeProfile.findMany;
  let calls = 0;
  t.mock.method(prisma.employeeProfile, "findMany", (async (args: any) => {
    const rows = await find(args);
    if (++calls === 2) rows.forEach((row: any) => row.skillAssignments.reverse());
    return rows;
  }) as any);
  const result: any = await commitCaptureWorkHoursImport(actor, { shiftDate: day });
  assert.equal(result.data?.imported, 1, result.error);
  assert.equal(f.state.workHourRecord[0].effectiveHours, 6.5);
});

for (const change of ["skill", "shiftId", "supervisorId", "shiftTime"] as const) {
  test(`mudança real de ${change} bloqueia o lote e identifica o parceiro sem gravar horas`, async (t) => {
    const f = fixture(t, { employeeProfile: [employee()], schedule: [slot()] });
    f.capture("agent", 6);
    const find = prisma.employeeProfile.findMany;
    let calls = 0;
    t.mock.method(prisma.employeeProfile, "findMany", (async (args: any) => {
      const rows: any[] = await find(args);
      if (++calls === 2) {
        if (change === "shiftTime") rows[0].shift.startsAt = "22:00";
        else rows[0][change] = change === "skill" ? "Bilíngue" : "changed";
      }
      return rows;
    }) as any);
    const result: any = await commitCaptureWorkHoursImport(actor, { shiftDate: day });
    assert.match(result.error, /wb_agent/);
    assert.equal(mutations(f.calls).length, 0);
  });
}

test("range inclui cada Shift Date, respeita Go Live por dia e não altera dias externos", async (t) => {
  const next = "2026-09-04";
  const slots = ["2026-09-02", day, next, "2026-09-05"].flatMap((d) => ["agent", "new"].map((id) => ({
    ...slot(id), id: `slot-${id}-${d}`, date: new Date(`${d}T00:00:00Z`)
  })));
  const f = fixture(t, { employeeProfile: [employee(), employee("new", { goLiveDate: new Date(`${next}T00:00:00Z`) })], schedule: slots });
  for (const id of ["agent", "new"]) for (const d of ["2026-09-02", day, next, "2026-09-05"]) f.capture(id, d === day ? 6 : 7, d);
  const period = { startDate: day, endDate: next };
  const preview: any = await previewCaptureWorkHoursImport(actor, period);
  assert.deepEqual(preview.data.summary, { automatic: 3, divergences: 0, ignored: 0 });
  assert.equal(mutations(f.calls).length, 0);
  assert.deepEqual(f.calls.find((c) => c.model === "capture")!.args.dates, [day, next]);
  const first: any = await commitCaptureWorkHoursImport(actor, period);
  assert.equal(first.data?.imported, 3, first.error);
  assert.deepEqual(f.state.workHourRecord.map((r) => [r.employeeId, r.date.toISOString().slice(0, 10), r.effectiveHours]), [
    ["agent", day, 6.5], ["agent", next, 7.5], ["new", next, 7.5]
  ]);
  const external = f.state.schedule.filter((s) => ![day, next].includes(s.date.toISOString().slice(0, 10)) || (s.employeeId === "new" && +s.date === +date));
  assert.ok(external.every((s) => s.status === "ESCALADO"));
  const denied: any = await commitCaptureWorkHoursImport(actor, period);
  assert.equal(denied.code, "REPROCESS_CONFIRMATION_REQUIRED");
  assert.equal(denied.data.overlap.count, 3);
  assert.deepEqual(denied.data.overlap.dates, [day, next]);
  const repeated: any = await commitCaptureWorkHoursImport(actor, { ...period, confirmReprocessing: true });
  assert.equal(repeated.data.unchanged, 3);
  assert.equal(f.state.workHourRecord.length, 3);
});

test("divergências do range são revisadas com a data de cada linha e rejeitam linhas fora dele", async (t) => {
  const next = "2026-09-04";
  const nextDate = new Date(`${next}T00:00:00Z`);
  const tomorrow = { ...slot(), id: "tomorrow", date: nextDate };
  const f = fixture(t, { employeeProfile: [employee()], schedule: [slot(), tomorrow], workHourCaptureDivergence: [
    divergence(), divergence("agent", hour, { id: "tomorrow", date: nextDate, scheduleId: "tomorrow", reconciliationKey: `agent:${next}:tomorrow` }),
    divergence("agent", hour, { id: "outside", date: new Date("2026-09-05T00:00:00Z") })
  ] });
  const period = { startDate: day, endDate: next };
  const listed: any = await listCaptureWorkHourDivergences(actor, period);
  assert.deepEqual(listed.data.map((r: any) => r.date), [day, next]);
  assert.equal(listed.shiftDate, null);
  const denied = await applyCaptureWorkHourDivergenceDecisions(actor, { ...period, confirmed: true,
    decisions: [f.decision("div-agent", "CONFIRM_PRESENCE"), f.decision("outside", "CONFIRM_PRESENCE")] });
  assert.ok("error" in denied);
  assert.equal(mutations(f.calls).length, 0);
  const saved: any = await applyCaptureWorkHourDivergenceDecisions(actor, { ...period, confirmed: true,
    decisions: [f.decision("div-agent", "CONFIRM_PRESENCE"), f.decision("tomorrow", "CONFIRM_PRESENCE")] });
  assert.equal(saved.data.resolved, 2);
  assert.deepEqual(f.state.workHourRecord.map((r) => r.date.toISOString().slice(0, 10)), [day, next]);
  assert.equal(f.state.workHourCaptureDivergence.find((d) => d.id === "tomorrow")!.reconciliationKey, `agent:${next}:tomorrow`);
  assert.deepEqual(f.state.auditLog.filter((r) => r.entity === "WorkHourCaptureDivergence").map((r) => r.newValue.shiftDate), [day, next]);
  assert.equal(f.state.workHourCaptureDivergence.find((d) => d.id === "outside")!.status, "PENDING");
});

test("contrato de período aceita range e link antigo, mas rejeita datas inválidas ou conflitantes", () => {
  const schema = z.object(capturePeriodShape).superRefine(validateCapturePeriod);
  for (const input of [{ shiftDate: day }, { startDate: day, endDate: "2026-09-04" }, { startDate: "2026-08-01", endDate: "2026-10-01" }]) {
    assert.equal(schema.safeParse(input).success, true);
  }
  for (const input of [{}, { startDate: day }, { shiftDate: "2026-02-31" }, { startDate: "2026-09-05", endDate: day },
    { shiftDate: day, startDate: day, endDate: "2026-09-04" }, { startDate: "2026-08-01", endDate: "2026-10-02" }]) {
    assert.equal(schema.safeParse(input).success, false);
  }
  assert.deepEqual(resolveCapturePeriod({ startDate: "2026-08-31", endDate: "2026-09-01" }), {
    period: { startDate: "2026-08-31", endDate: "2026-09-01" }, dates: ["2026-08-31", "2026-09-01"]
  });
});

test("processamento diário acumula todos os dias antes de abrir as divergências", async () => {
  const calls: string[] = [];
  const progress: string[] = [];
  const result = await processCaptureImportDays({ startDate: day, endDate: "2026-09-05" }, async (d) => {
    calls.push(d); return { imported: 1, unchanged: 2, divergences: 1, ignored: 0 };
  }, (d, index, total) => progress.push(`${d}:${index}/${total}`));
  assert.deepEqual(result, { imported: 3, unchanged: 6, divergences: 3, ignored: 0, blocked: 0, completedDates: [day, "2026-09-04", "2026-09-05"] });
  assert.equal(calls.length, 3);
  assert.equal(progress[2], "2026-09-05:3/3");
});

test("falha diária interrompe sem retry e informa exatamente os dias concluídos", async () => {
  const calls: string[] = [];
  await assert.rejects(processCaptureImportDays({ startDate: day, endDate: "2026-09-05" }, async (d) => {
    calls.push(d);
    if (d === "2026-09-04") throw new Error("Confirme o reprocessamento");
    return { imported: 1, unchanged: 0, divergences: 1, ignored: 0 };
  }, () => {}), (error: unknown) => {
    assert.ok(error instanceof CaptureBatchError);
    assert.equal(error.failedDate, "2026-09-04");
    assert.deepEqual(error.result.completedDates, [day]);
    assert.match(error.message, /Dias concluídos: 2026-09-03/);
    assert.match(error.message, /Confirme o reprocessamento/);
    return true;
  });
  assert.deepEqual(calls, [day, "2026-09-04"]);
});

test("range não amplia a permissão de importar ou resolver divergências", async (t) => {
  const f = fixture(t, { employeeProfile: [employee()], schedule: [slot()] });
  f.state.user[0].role.name = "COLABORADOR";
  const period = { startDate: day, endDate: "2026-09-04" };
  assert.ok("error" in await previewCaptureWorkHoursImport(actor, period));
  assert.ok("error" in await commitCaptureWorkHoursImport(actor, period));
  assert.ok("error" in await listCaptureWorkHourDivergences(actor, period));
  assert.ok("error" in await applyCaptureWorkHourDivergenceDecisions(actor, { ...period, decisions: [], confirmed: true }));
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
