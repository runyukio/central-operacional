import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { getOperationalAttendance, exportAttritionXlsxData } from "./schedule-service";
import { mockPrismaDelegate } from "./prisma-test-delegate";

const actor = { email: "wfm@example.test", name: "WFM", role: "WFM" as const };
const period = { startDate: "2026-09-01", endDate: "2026-09-21" };
const employees = [
  { id: "voluntary", terminationType: "Voluntário", terminationReason: "Nova oportunidade" },
  { id: "involuntary", terminationType: "Involuntário", terminationReason: "Encerramento do contrato" },
  { id: "missing", terminationType: null, terminationReason: " " }
].map((row) => ({
  ...row, fullName: `Parceiro ${row.id}`, wbLogin: `wb_${row.id}`, roleTitle: "Agente",
  skill: "Video", wave: "Wave 1", admissionDate: new Date("2026-08-01T00:00:00Z"),
  terminationDate: new Date("2026-09-20T00:00:00Z"), operationalStatus: "Desligado",
  user: { email: `${row.id}@example.test` }, lob: { name: "VIDEO" }, supervisor: { fullName: "Gestora" }
}));

function fixture(t: TestContext, role = "WFM", status = "ACTIVE") {
  mockPrismaDelegate(t, "user", { findUnique: async () => ({
    id: "viewer", status, role: { name: role }, employeeProfile: null
  }) });
  const people = mockPrismaDelegate(t, "employeeProfile", { findMany: async ({ select }: any) =>
    employees.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => Boolean(select[key]))))
  });
  mockPrismaDelegate(t, "auditLog", { create: async () => ({}) });
  return people;
}

test("attrition detail returns registered voluntary/involuntary reasons without inventing missing classification", async (t) => {
  fixture(t);
  const result = await getOperationalAttendance(actor, { ...period, detailType: "attrition", skipSummary: true });
  assert.ok("canViewTerminationData" in result && result.canViewTerminationData);
  assert.deepEqual(result.data.map((row: any) => [row.terminationType, row.terminationReason]), [
    ["Voluntário", "Nova oportunidade"], ["Involuntário", "Encerramento do contrato"],
    ["Não informado", "Não informado"]
  ]);
});

test("attrition export matches detail classification and reasons, with aligned headers and unchanged counts", async (t) => {
  fixture(t);
  const result = await exportAttritionXlsxData(actor, period);
  assert.ok(!("error" in result));
  const sheet = result.sheets[0];
  assert.equal(result.rows[0][3], 3);
  const typeIndex = sheet.headers.indexOf("tipo_desligamento");
  const reasonIndex = sheet.headers.indexOf("motivo_desligamento");
  assert.ok(typeIndex >= 0 && reasonIndex >= 0);
  assert.deepEqual(sheet.rows.map((row) => [row[typeIndex], row[reasonIndex]]), [
    ["Voluntário", "Nova oportunidade"], ["Involuntário", "Encerramento do contrato"],
    ["Não informado", "Não informado"]
  ]);
  for (const row of sheet.rows) assert.equal(row.length, sheet.headers.length);
});

for (const role of ["SUPERVISOR", "GESTOR", "RTA"]) {
  test(`attrition protects termination details for ${role}, including a stale privileged session`, async (t) => {
    const people = fixture(t, role);
    const detail = await getOperationalAttendance(actor, { ...period, detailType: "attrition", skipSummary: true });
    assert.ok("canViewTerminationData" in detail && !detail.canViewTerminationData);
    for (const row of detail.data) {
      assert.ok(!("terminationType" in row));
      assert.ok(!("terminationReason" in row));
    }
    const exported = await exportAttritionXlsxData(actor, period);
    assert.ok(!("error" in exported));
    const sheet = exported.sheets[0];
    assert.ok(!sheet.headers.includes("tipo_desligamento"));
    assert.ok(!sheet.headers.includes("motivo_desligamento"));
    for (const row of sheet.rows) assert.equal(row.length, sheet.headers.length);
    for (const call of people.findMany.mock.calls) {
      assert.ok(!call.arguments[0].select.terminationType);
      assert.ok(!call.arguments[0].select.terminationReason);
    }
  });
}
