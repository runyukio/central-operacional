import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { prisma } from "./prisma";
import { mockPrismaDelegate } from "./prisma-test-delegate";
import { updateOperationalRequestStatus } from "./request-service";
import { resolveShiftSupervisor, saveSupervisionAssignment, type SupervisionAssignment } from "./supervision-matrix";
import { historicalSlotSupervisor } from "./schedule-supervision-history";
import { applyDueFixedShiftChanges } from "./shift-change-effective-service";

const date = (day: string) => new Date(`${day}T00:00:00Z`);
const actor = { email: "wfm@example.test", name: "WFM", role: "WFM" as const };
const assignment = (lobId = "ADS", shift: SupervisionAssignment["shift"] = "Tarde", extra = {}): SupervisionAssignment => ({
  id: `${lobId}-${shift}`, lobId, shift, supervisorId: `${lobId}-${shift}-supervisor`,
  startsOn: "2026-01-01", endsOn: null, active: true, ...extra
});

// This boundary fixture models transaction isolation/rollback and compare-and-set.
// It never connects to the operational database. Database-level semantics are
// exercised through the same transaction callback as production.
function setup(t: TestContext, options: { lob?: string; shift?: SupervisionAssignment["shift"]; future?: boolean; temporary?: boolean; failure?: string; matrix?: SupervisionAssignment[]; status?: string } = {}) {
  const lob = options.lob ?? "ADS";
  const shift = options.shift ?? "Tarde";
  const effectiveDay = options.future ? "2099-11-15" : "2026-01-15";
  const matrix = options.matrix ?? [assignment(lob, shift, { endsOn: options.future ? null : "2026-01-31" }),
    assignment(lob, shift, { id: "later", startsOn: options.future ? "2100-01-01" : "2026-02-01", supervisorId: "later-supervisor", active: !options.future }),
    assignment("OTHER", shift), assignment(lob, shift === "Tarde" ? "Manhã" : "Tarde")];
  const user = { id: "wfm", ...actor, status: "ACTIVE", role: { name: "WFM" }, employeeProfile: null };
  let state: any = {
    request: { id: "request", code: "REQ-9000", title: "Troca de turno", description: "Test", typeId: "type", type: { name: "Troca de Turno" },
      requesterId: "requester", requester: { id: "requester", name: "Agent", email: "agent@example.test" },
      status: options.status ?? "EM_ANALISE", priority: "MEDIA", assignedArea: "WFM", assignee: null, employeeId: "agent",
      employee: { wbLogin: "agent", supervisorId: "old", supervisor: { fullName: "Old" }, lob: { name: lob } },
      payload: { shiftChange: true, shiftChangeType: options.temporary ? "Temporária" : "Fixa", desiredShift: shift,
        shiftChangeStartDate: effectiveDay, ...(options.temporary ? { shiftChangeEndDate: "2026-01-16" } : {}) },
      history: [], comments: [], createdAt: date("2026-01-01"), updatedAt: date("2026-01-01") },
    employee: { id: "agent", lobId: lob, lob: { name: lob }, supervisorId: "old", shiftId: "old-shift", shift: { name: "Manhã" },
      workStartTime: "08:00", workEndTime: "16:00", deletedAt: null, contractType: "CLT", roleTitle: "Agente", operationalStatus: "Ativo" },
    schedules: ["2026-01-14", effectiveDay, options.future ? "2099-11-16" : "2026-01-16", options.future ? "2099-12-01" : "2026-02-01"].map((day, index) => ({
      id: `slot-${index}`, employeeId: "agent", date: date(day), deletedAt: null, shiftId: "old-shift", shift: { name: "Manhã" },
      supervisorId: index ? "old" : null, startsAt: "08:00", endsAt: "16:00", status: ["PRESENTE", "FOLGA", "FALTA", "ATRASO"][index],
      observation: "Original note", operationalHours: 7.5
    })), audits: [], changes: [], notifications: []
  };
  const before = structuredClone(state);
  mockPrismaDelegate(t, "user", { findUnique: async () => user, findMany: async () => [] });
  mockPrismaDelegate(t, "request", { findFirst: async () => structuredClone(state.request), findMany: async () => [structuredClone(state.request)] });
  mockPrismaDelegate(t, "employeeProfile", { findUnique: async () => null });
  mockPrismaDelegate(t, "notification", { create: async () => ({}) });
  let lock = Promise.resolve();
  let writes = 0;
  const original = prisma.$transaction;
  prisma.$transaction = (async (callback: (client: any) => Promise<unknown>) => {
    let release!: () => void;
    const previous = lock;
    lock = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    const draft = structuredClone(state);
    const tx = {
      $queryRaw: async () => [],
      systemConfig: { findUnique: async () => ({ value: matrix }) },
      shift: { findFirst: async () => ({ id: `shift-${shift}`, name: shift }) },
      employeeProfile: {
        findUnique: async ({ where }: any) => where.id === "agent" ? structuredClone(draft.employee) : { id: where.id, deletedAt: null },
        findMany: async ({ where }: any) => where.id.in.map((id: string) => ({ id, fullName: `Supervisor ${id}` })),
        update: async ({ data }: any) => {
          if (options.failure === "profile") throw new Error("Injected partner map failure");
          Object.assign(draft.employee, data); writes++;
          return structuredClone(draft.employee);
        }
      },
      request: {
        findUnique: async ({ select }: any) => structuredClone(select ? { ...draft.request, employee: draft.employee } : draft.request),
        updateMany: async ({ where, data }: any) => {
          const valid = draft.request.status === (where.status ?? draft.request.status)
            && draft.request.updatedAt.getTime() === where.updatedAt.getTime();
          if (valid) Object.assign(draft.request, data);
          return { count: valid ? 1 : 0 };
        },
        update: async ({ data }: any) => {
          const { history, comments, ...fields } = data;
          Object.assign(draft.request, fields);
          if (history) draft.request.history.unshift({ ...history.create, actor: user, createdAt: new Date() });
          return structuredClone(draft.request);
        }
      },
      schedule: {
        findMany: async ({ where }: any) => draft.schedules.filter((row: any) => row.date >= where.date.gte && (!where.date.lte || row.date <= where.date.lte)),
        update: async ({ where, data }: any) => {
          if (options.failure === "schedule") throw new Error("Injected schedule failure");
          const row = draft.schedules.find((entry: any) => entry.id === where.id);
          Object.assign(row, data); return structuredClone(row);
        }
      },
      auditLog: { create: async ({ data }: any) => {
        if (options.failure === "audit") throw new Error("Injected audit failure");
        draft.audits.push(data); return data;
      } },
      requestHistory: { create: async () => ({}) },
      scheduleChangeHistory: { create: async ({ data }: any) => { draft.changes.push(data); return data; } },
      notification: { create: async ({ data }: any) => { draft.notifications.push(data); return data; } }
    };
    try { const result = await callback(tx); state = draft; return result; }
    finally { release(); }
  }) as typeof prisma.$transaction;
  t.after(() => { prisma.$transaction = original; });
  return { before, matrix, user, effectiveDay, get state() { return state; }, get writes() { return writes; } };
}

for (const lob of ["ADS", "VIDEO", "COMMENTS", "CEC"]) {
  for (const shift of ["Manhã", "Tarde", "Noite"] as const) {
    test(`${lob} → ${shift}: dated matrix, directory, future schedules, audit, preserved history/status/hours`, async (t) => {
      const fixture = setup(t, { lob, shift });
      const result = await updateOperationalRequestStatus(actor, "REQ-9000", "Aprovado");
      assert.ok(result && typeof result === "object" && "data" in result, JSON.stringify(result));
      const { state, before } = fixture;
      const supervisor = `${lob}-${shift}-supervisor`;
      assert.equal(state.request.status, "APROVADO");
      assert.equal(state.employee.supervisorId, supervisor);
      assert.equal(state.employee.lobId, before.employee.lobId);
      for (const field of ["contractType", "roleTitle", "operationalStatus"]) assert.equal(state.employee[field], before.employee[field]);
      assert.deepEqual(state.schedules[0], before.schedules[0]);
      for (const row of state.schedules.slice(1)) {
        assert.equal(row.supervisorId, supervisor);
        assert.equal(row.shiftId, `shift-${shift}`);
        const old = before.schedules.find((entry: any) => entry.id === row.id);
        for (const field of ["status", "observation", "operationalHours", "date"]) assert.deepEqual(row[field], old[field]);
      }
      assert.equal(state.changes.length, 3);
      assert.ok(state.audits.some((audit: any) => audit.entity === "EmployeeProfile" && audit.previousValue.supervisorId === "old" && audit.newValue.supervisorId === supervisor));
      const manifest = state.audits.find((audit: any) => audit.entity === "EmployeeSupervisionSwap").newValue;
      assert.equal(historicalSlotSupervisor({ ...state.schedules[0], employee: state.employee }, manifest.transfers.map((row: any) => ({ ...row, effectiveDate: manifest.effectiveDate }))), "old");
      if (shift === "Noite") {
        assert.equal(state.schedules[1].startsAt, "23:00");
        assert.equal(state.schedules[1].endsAt, "08:00");
        assert.equal(state.schedules[1].date.toISOString().slice(0, 10), fixture.effectiveDay);
      }
    });
  }
}

test("future approval updates map immediately, prepares existing future schedules and retains current shift/hours", async (t) => {
  const fixture = setup(t, { future: true });
  const result = await updateOperationalRequestStatus(actor, "REQ-9000", "Aprovado");
  assert.ok(result && typeof result === "object" && "data" in result, JSON.stringify(result));
  assert.equal(fixture.state.employee.supervisorId, "ADS-Tarde-supervisor");
  assert.equal(fixture.state.employee.shiftId, "old-shift");
  assert.equal(fixture.state.employee.workStartTime, "08:00");
  assert.equal(fixture.state.request.payload.shiftChangeApplicationStatus, "SCHEDULED");
  assert.equal(fixture.state.request.payload.shiftChangeSupervisorId, fixture.state.schedules[1].supervisorId);
});

test("future activation keeps approved supervisor even after matrix changes; repeating activation is harmless", async (t) => {
  const fixture = setup(t, { future: true });
  await updateOperationalRequestStatus(actor, "REQ-9000", "Aprovado");
  fixture.matrix[0].supervisorId = "changed-after-approval";
  const result = await applyDueFixedShiftChanges(new Date("2099-11-15T12:00:00Z"));
  assert.equal(result.applied, 1, JSON.stringify(result));
  assert.equal(fixture.state.employee.supervisorId, "ADS-Tarde-supervisor");
  assert.equal(fixture.state.employee.shiftId, "shift-Tarde");
  assert.equal((await applyDueFixedShiftChanges(new Date("2099-11-15T12:00:00Z"))).applied, 0);
});

for (const matrix of [[], [assignment(), assignment("ADS", "Tarde", { id: "duplicate", supervisorId: "second" })]]) {
  test(`approval blocked with ${matrix.length ? "ambiguous" : "missing"} supervisor`, async (t) => {
    const fixture = setup(t, { matrix });
    const result = await updateOperationalRequestStatus(actor, "REQ-9000", "Aprovado");
    assert.ok(result && typeof result === "object" && "error" in result);
    assert.match(result.error ?? "", /LOB ADS, novo turno Tarde, vigência 2026-01-15/);
    assert.match(result.error ?? "", matrix.length ? /sobrepostas.*Supervisor.*second/ : /não há supervisão definida/);
    assert.deepEqual(fixture.state, fixture.before);
  });
}
for (const failure of ["profile", "schedule", "audit"]) {
  test(`rollback on ${failure} failure keeps request pending and all records unchanged`, async (t) => {
    const fixture = setup(t, { failure });
    const result = await updateOperationalRequestStatus(actor, "REQ-9000", "Aprovado");
    assert.ok(result && typeof result === "object" && "error" in result);
    assert.deepEqual(fixture.state, fixture.before);
  });
}
for (const target of ["Recusado", "Cancelado", "Em análise"] as const) {
  test(`${target} does not change supervision`, async (t) => {
    const fixture = setup(t);
    await updateOperationalRequestStatus(actor, "REQ-9000", target);
    assert.deepEqual(fixture.state.employee, fixture.before.employee);
    assert.deepEqual(fixture.state.schedules, fixture.before.schedules);
    assert.equal(fixture.state.changes.length, 0);
  });
}
test("double click runs effects once; repeated approval cannot duplicate history", async (t) => {
  const fixture = setup(t);
  const results = await Promise.all([updateOperationalRequestStatus(actor, "REQ-9000", "Aprovado"), updateOperationalRequestStatus(actor, "REQ-9000", "Aprovado")]);
  assert.equal(results.filter((result) => result && typeof result === "object" && "data" in result).length, 1);
  assert.equal(fixture.state.changes.length, 3);
  const audits = fixture.state.audits.length;
  await updateOperationalRequestStatus(actor, "REQ-9000", "Aprovado");
  assert.equal(fixture.state.audits.length, audits);
});
test("temporary change retains existing range while applying the same supervisor to directory and affected slots", async (t) => {
  const fixture = setup(t, { temporary: true });
  await updateOperationalRequestStatus(actor, "REQ-9000", "Aprovado");
  assert.equal(fixture.state.employee.supervisorId, "ADS-Tarde-supervisor");
  assert.equal(fixture.state.employee.shiftId, "old-shift");
  assert.equal(fixture.state.changes.length, 2);
  assert.equal(fixture.state.schedules[3].supervisorId, "old");
});

for (const extra of [{ active: false }, { startsOn: "2026-01-16" }, { endsOn: "2026-01-14" }]) {
  test(`matrix excludes invalid effective period/status ${JSON.stringify(extra)}`, async () => {
    const tx: any = { $queryRaw: async () => [], systemConfig: { findUnique: async () => ({ value: [assignment("ADS", "Tarde", extra)] }) } };
    await assert.rejects(resolveShiftSupervisor(tx, { lobId: "ADS", lobName: "ADS", shift: "Tarde", effectiveDate: date("2026-01-15"), employeeId: "agent" }), /não há supervisão definida/);
  });
}
test("matrix dates are inclusive, and a missing/deleted/self supervisor blocks approval", async () => {
  for (const invalid of [null, { id: "sup", deletedAt: date("2026-01-01") }, { id: "agent", deletedAt: null }]) {
    const tx: any = { $queryRaw: async () => [], systemConfig: { findUnique: async () => ({ value: [assignment("ADS", "Tarde", { startsOn: "2026-01-15", endsOn: "2026-01-15" })] }) }, employeeProfile: { findUnique: async () => invalid } };
    await assert.rejects(resolveShiftSupervisor(tx, { lobId: "ADS", lobName: "ADS", shift: "Tarde", effectiveDate: date("2026-01-15"), employeeId: "agent" }), /indisponível ou inválido/);
  }
});

test("matrix configuration rejects overlapping inclusive periods without writing", async () => {
  let writes = 0;
  const tx: any = { $queryRaw: async () => [], systemConfig: { findUnique: async () => ({ value: [assignment()] }), upsert: async () => { writes++; } },
    lob: { findUnique: async () => ({ name: "ADS" }) }, employeeProfile: { findUnique: async () => ({ id: "sup", user: { status: "ACTIVE", role: { name: "SUPERVISOR" } } }) } };
  const result = await saveSupervisionAssignment(tx, "admin", assignment("ADS", "Tarde", { id: "new", startsOn: "2026-11-15" }));
  assert.ok("error" in result);
  assert.match(result.error ?? "", /já há supervisão/);
  assert.equal(writes, 0);
});

test("legacy future approvals resolve supervision at their effective date and fail safely without a matrix", async (t) => {
  const fixture = setup(t, { future: true, status: "APROVADO", matrix: [] });
  Object.assign(fixture.state.request.payload, { shiftChangeApplicationStatus: "SCHEDULED", shiftChangeApprovedById: "wfm" });
  const before = structuredClone(fixture.state);
  const result = await applyDueFixedShiftChanges(new Date("2099-11-15T12:00:00Z"));
  assert.equal(result.applied, 0);
  assert.match(result.failures[0].error, /LOB ADS, novo turno Tarde.*não há supervisão definida/);
  assert.deepEqual(fixture.state, before);
});

test("the old supervisor is retained only when the dated matrix explicitly assigns that supervisor", async (t) => {
  const fixture = setup(t, { matrix: [assignment("ADS", "Tarde", { supervisorId: "old" })] });
  const result = await updateOperationalRequestStatus(actor, "REQ-9000", "Aprovado");
  assert.ok(result && typeof result === "object" && "data" in result);
  assert.equal(fixture.state.employee.supervisorId, "old");
  assert.equal(fixture.state.request.payload.shiftChangeSupervisionAssignmentId, "ADS-Tarde");
});

test("a malformed matrix blocks approval with LOB and shift context", async (t) => {
  const fixture = setup(t, { matrix: [{ ...assignment(), startsOn: "2026-02-30" }] });
  const result = await updateOperationalRequestStatus(actor, "REQ-9000", "Aprovado");
  assert.ok(result && typeof result === "object" && "error" in result);
  assert.match(result.error ?? "", /LOB ADS, novo turno Tarde.*Matriz de supervisão inválida/);
  assert.deepEqual(fixture.state, fixture.before);
});
