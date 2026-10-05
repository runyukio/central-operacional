import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { absenceNoticeLabel } from "./absence-notice";
import { exportAttendanceDetailXlsxData, exportClassifiedUnjustifiedAbsencesXlsxData, exportJustifiedAbsencesXlsxData, exportOperationalSchedulesXlsxData, exportUnjustifiedAbsencesXlsxData, getOperationalAttendance } from "./schedule-service";
import { mockPrismaDelegate } from "./prisma-test-delegate";

const actor = { email: "wfm@example.test", name: "Test WFM", role: "WFM" as const };
const date = new Date("2026-10-05T00:00:00Z");
const query = { startDate: "2026-10-01", endDate: "2026-10-05" };
function fixture(t: TestContext, status: "FALTA" | "FALTA_JUSTIFICADA" | "FALTA_INJUSTIFICADA") {
  const records = [true, false, null].map((notifiedWithin48h, index) => ({
    id: `s${index}`, employeeId: `e${index}`, supervisorId: null, date, status, deletedAt: null, updatedAt: date,
    startsAt: "08:00", endsAt: "17:00", shift: { name: "Manhã" }, observation: "Descrição original",
    workHourRecords: [], employee: { id: `e${index}`, fullName: `Pessoa ${index}`, wbLogin: `wb_${index}`, user: null,
      shift: { name: "Manhã" }, supervisorId: null, supervisor: null, lob: { name: "ADS" }, roleTitle: "Agente" },
    attendanceRecords: [{ id: `a${index}`, status: "FALTA", isJustified: status !== "FALTA", absenceReason: status === "FALTA" ? "Sem justificativa" : status === "FALTA_JUSTIFICADA" ? "Problema de saúde" : "Não informado",
      reasonClassification: status === "FALTA_JUSTIFICADA" ? "JUSTIFIED" : status === "FALTA_INJUSTIFICADA" ? "UNJUSTIFIED" : null,
      reasonCategory: "Operacional", supervisorJustification: "Descrição original", notifiedWithin48h,
      registeredAt: date, justifiedAt: date, updatedAt: date, registeredBy: { name: "Supervisor" }, justifiedBy: { name: "Supervisor" }, justifiedById: null }]
  }));
  mockPrismaDelegate(t, "user", { findUnique: async () => ({ id: "wfm", status: "ACTIVE", role: { name: "WFM" }, employeeProfile: null }) });
  mockPrismaDelegate(t, "schedule", { findMany: async () => records });
  mockPrismaDelegate(t, "workHourRecord", { findMany: async () => [] });
  mockPrismaDelegate(t, "auditLog", { create: async () => ({}) });
  return records;
}

for (const [status, exporter] of [
  ["FALTA_JUSTIFICADA", exportJustifiedAbsencesXlsxData],
  ["FALTA_INJUSTIFICADA", exportClassifiedUnjustifiedAbsencesXlsxData],
  ["FALTA", exportUnjustifiedAbsencesXlsxData]
] as const) {
  test(`export ${status} preserves Sim, Não and historical Não informado with aligned columns`, async (t) => {
    fixture(t, status);
    const result = await exporter(actor, query);
    assert.ok("headers" in result && result.headers && result.rows, JSON.stringify(result));
    const { headers, rows } = result;
    const col = headers.indexOf("Aviso dentro de 48h");
    assert.ok(col >= 0);
    assert.deepEqual(rows.map(row => row[col]), ["Sim", "Não", "Não informado"]);
    assert.ok(rows.every(row => row.length === headers.length));
    assert.ok(rows.every(row => row.includes("Descrição original") || status === "FALTA"));
  });
}

test("consolidated schedule and absence detail export the same assessments", async (t) => {
  fixture(t, "FALTA_JUSTIFICADA");
  for (const result of [await exportOperationalSchedulesXlsxData(actor, query), await exportAttendanceDetailXlsxData(actor, { ...query, detailType: "absences" })]) {
    assert.ok("headers" in result && result.headers && result.rows, JSON.stringify(result));
    const { headers, rows } = result;
    const col = headers.indexOf("Aviso dentro de 48h");
    assert.deepEqual(rows.map(row => row[col]), ["Sim", "Não", "Não informado"]);
    assert.ok(rows.every(row => row.length === headers.length));
  }
  const list = await getOperationalAttendance(actor, { ...query, includeJustified: "true", skipSummary: true });
  assert.ok("data" in list);
  assert.deepEqual(list.data.map(row => "notifiedWithin48h" in row ? row.notifiedWithin48h : undefined), [true, false, null]);
});

test("legacy unknown is distinct from a supervisor's No", () => {
  assert.equal(absenceNoticeLabel(undefined), "Não informado");
  assert.equal(absenceNoticeLabel(null), "Não informado");
  assert.equal(absenceNoticeLabel(false), "Não");
});
