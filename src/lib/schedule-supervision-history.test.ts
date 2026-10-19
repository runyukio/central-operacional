import assert from "node:assert/strict";
import test from "node:test";
import { historicalSlotSupervisor, historicalSupervisorFilter, scheduleSupervisorNames } from "./schedule-supervision-history";
import { mockPrismaDelegate } from "./prisma-test-delegate";
import { exportOperationalSchedulesXlsxData, getOperationalSchedules } from "./schedule-service";
import { calculateOperationalHours } from "./work-hours-capture-integration-core";

const transfers = [{ employeeId: "a", from: "joao", to: "priscilla", effectiveDate: "2026-10-19" },
  { employeeId: "b", from: "priscilla", to: "joao", effectiveDate: "2026-10-19" }];
const date = (day: string) => new Date(`${day}T00:00:00Z`);

test("histórico nulo mantém vínculo anterior sem mudar slots; corte é inclusivo e snapshot explícito prevalece", () => {
  for (const transfer of transfers) {
    const slot = { employeeId: transfer.employeeId, supervisorId: null, employee: { supervisorId: transfer.to } };
    assert.equal(historicalSlotSupervisor({ ...slot, date: date("2026-10-18") }, transfers), transfer.from);
    assert.equal(historicalSlotSupervisor({ ...slot, date: date("2026-10-19") }, transfers), transfer.to);
    assert.equal(historicalSlotSupervisor({ ...slot, supervisorId: "older-supervisor", date: date("2026-10-18") }, transfers), "older-supervisor");
    assert.equal(slot.supervisorId, null);
  }
});

test("filtro histórico separa snapshots explícitos, vínculo legado e vínculo atual", () => {
  const filter = historicalSupervisorFilter(["joao"], transfers) as any;
  const match = (row: any, where: any): boolean => Object.entries(where).every(([key, expected]: any) => {
    if (key === "OR") return expected.some((part: any) => match(row, part));
    const value = row[key];
    if (expected && typeof expected === "object") {
      if ("in" in expected) return expected.in.includes(value);
      if ("notIn" in expected) return !expected.notIn.includes(value);
      if ("lt" in expected || "gte" in expected) return (!expected.lt || value < expected.lt) && (!expected.gte || value >= expected.gte);
      return match(value, expected);
    }
    return value === expected;
  });
  for (const t of transfers) {
    for (const day of ["2026-10-18", "2026-10-19"]) {
      const row = { employeeId: t.employeeId, date: date(day), supervisorId: null, employee: { supervisorId: t.to } };
      assert.equal(match(row, filter), (day < "2026-10-19" ? t.from : t.to) === "joao");
    }
  }
  assert.equal(match({ employeeId: "other", supervisorId: "priscilla", employee: { supervisorId: "joao" } }, filter), false);
});

for (const day of ["2026-10-18", "2026-10-19"]) {
  test(`grid e exportação preservam supervisão por data e usam as mesmas horas oficiais em ${day}`, async (t) => {
    const employee = { id: "a", fullName: "Agent A", wbLogin: "wb_a", roleTitle: "Agente", operationalStatus: "Ativo",
      admissionDate: date("2026-01-01"), scheduleType: "5x2", skill: "L1", lob: { id: "cec", name: "CEC" },
      supervisorId: "priscilla", supervisor: { fullName: "Priscilla" }, shift: { name: "Noite" }, user: null };
    const schedule = { id: "slot", employeeId: "a", date: date(day), status: "PRESENTE", supervisorId: day < "2026-10-19" ? null : "priscilla",
      lobId: "cec", startsAt: "23:00", endsAt: "08:00", employee, shift: { name: "Noite" }, attendanceRecords: [], workHourRecords: [] };
    const calculation = calculateOperationalHours(6 * 3_600_000, { lob: "CEC", shiftDate: day });
    const record = { id: "hours", employeeId: "a", date: date(day), actualHours: calculation.operationalHours, effectiveHours: calculation.operationalHours,
      status: "DIVERGENT", source: "captura-horas", observation: calculation.ruleLabel, updatedAt: date(day), adjustments: [] };
    mockPrismaDelegate(t, "user", { findUnique: async () => ({ id: "wfm", status: "ACTIVE", role: { name: "WFM" }, employeeProfile: null }) });
    mockPrismaDelegate(t, "auditLog", { findMany: async () => [{ newValue: { effectiveDate: "2026-10-19", transfers } }], create: async () => ({}) });
    mockPrismaDelegate(t, "employeeProfile", { count: async () => 1, findMany: async (args: any) => args.select?.fullName
      ? [{ id: "joao", fullName: "João" }, { id: "priscilla", fullName: "Priscilla" }] : [{ id: "a" }] });
    mockPrismaDelegate(t, "schedule", { count: async () => 1, findMany: async () => [structuredClone(schedule)] });
    mockPrismaDelegate(t, "lob", { findMany: async () => [{ id: "cec", name: "CEC" }] });
    mockPrismaDelegate(t, "workHourRecord", { findMany: async () => [record] });
    mockPrismaDelegate(t, "employeeMoodRecord", { findMany: async () => [] });
    mockPrismaDelegate(t, "scheduleImport", { findMany: async () => [] });
    const query = { startDate: day, endDate: day, skipSummary: true };
    const actor = { email: "wfm@test.invalid", name: "WFM", role: "WFM" as const };
    const grid = await getOperationalSchedules(actor, query);
    const row = grid.scheduleGridRows[0] as any;
    assert.equal(row.employee.supervisor, day < "2026-10-19" ? "João" : "Priscilla");
    assert.equal(row.workHours[0].effectiveHours, 6.5);
    assert.equal(row.workHours[0].differenceMinutes, -90);
    const exported = await exportOperationalSchedulesXlsxData(actor, query) as any;
    assert.equal(exported.rows[0][exported.headers.indexOf("supervisor")], row.employee.supervisor);
    assert.equal(exported.rows[0][exported.headers.indexOf("horas_realizadas")], "6:30");
    assert.equal(schedule.supervisorId, day < "2026-10-19" ? null : "priscilla");
    assert.equal((await scheduleSupervisorNames([schedule])).get("schedule:slot"), row.employee.supervisor);
  });
}
