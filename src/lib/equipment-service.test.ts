import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { prisma } from "./prisma";
import { mockPrismaDelegate } from "./prisma-test-delegate";
import { commitEquipmentImport, exportEquipmentXlsxData, getEquipmentHistory, listEquipment, previewEquipmentImport, saveEquipment } from "./equipment-service";

const actor = { email: "ti@example.test", name: "TI Test", role: "TI" as const };
const lobs = [{ id: "ads", name: "ADS" }, { id: "cec", name: "CEC" }];
const employee = { id: "agent", wbLogin: "wb_agent", fullName: "Test Agent", user: { email: "agent@example.test" } };
const date = new Date("2026-10-05T00:00:00Z");
const base = { numeroSerie: "SN001", type: "Notebook", model: "Model", status: "Em uso", dataEntrega: "2026-10-05", responsibleEmployeeId: employee.id };
const record = { id: "equipment", code: "SN001", serial: "SN001", type: "Notebook", model: "Model", employeeId: employee.id, employee, status: "ENTREGUE", deliveredAt: date, impact: "BAIXO", createdAt: date, updatedAt: date, deletedAt: null, lobId: "ads", lob: lobs[0], usage: "AGENTE", histories: [] };

function fixture(t: TestContext, role = "TI") {
  mockPrismaDelegate(t, "user", { findUnique: async () => ({ id: "ti", role: { name: role }, employeeProfile: null }) });
  mockPrismaDelegate(t, "lob", { findMany: async () => lobs });
  mockPrismaDelegate(t, "employeeProfile", { findFirst: async () => employee, findMany: async () => [employee] });
  const equipment = mockPrismaDelegate(t, "equipment", {
    findFirst: async (args) => typeof args.where.id === "string" ? structuredClone(record) : null,
    findMany: async () => [structuredClone(record)], count: async () => 1,
    groupBy: async () => [{ status: "ENTREGUE", _count: { _all: 1 } }]
  });
  const writes: Array<Record<string, any>> = [];
  const tx = {
    equipment: {
      create: async (args: any) => { writes.push(args.data); return { ...record, ...args.data }; },
      update: async (args: any) => { writes.push(args.data); return { ...record, ...args.data }; }
    },
    equipmentHistory: { create: t.mock.fn(async (args: any) => args.data) },
    auditLog: { create: t.mock.fn(async (args: any) => args.data) }
  };
  const client = prisma as any;
  const originalTransaction = client.$transaction;
  client.$transaction = t.mock.fn(async (fn: any) => fn(tx));
  t.after(() => { client.$transaction = originalTransaction; });
  return { equipment, writes, tx };
}

for (const [label, usage] of [["agente", "AGENTE"], [" Staff ", "STAFF"], ["Treinamento", "TREINAMENTO"]] as const) {
  test(`saves registered LOB and ${label} with audit history`, async (t) => {
    const f = fixture(t);
    const result = await saveEquipment(actor, { ...base, lobId: "cec", usage: label });
    assert.ok("success" in result, JSON.stringify(result));
    assert.equal(f.writes[0].lobId, "cec");
    assert.equal(f.writes[0].usage, usage);
    assert.equal(f.tx.equipmentHistory.create.mock.calls[0].arguments[0].data.after.usage, usage);
    assert.equal(f.tx.auditLog.create.mock.calls[0].arguments[0].data.newValue.lobId, "cec");
  });
}

test("omitting classification preserves it during an edit; explicit blanks clear it", async (t) => {
  const f = fixture(t);
  await saveEquipment(actor, { ...base, id: record.id });
  assert.equal(Object.hasOwn(f.writes[0], "lobId"), false);
  assert.equal(Object.hasOwn(f.writes[0], "usage"), false);
  await saveEquipment(actor, { ...base, id: record.id, lobId: "", usage: null });
  assert.equal(f.writes[1].lobId, null);
  assert.equal(f.writes[1].usage, null);
});

for (const classification of [{ lobId: "missing" }, { usage: "Supervisor" }]) {
  test(`rejects invalid classification ${JSON.stringify(classification)} before any write`, async (t) => {
    const f = fixture(t);
    assert.ok("error" in await saveEquipment(actor, { ...base, ...classification }));
    assert.equal(f.writes.length, 0);
    assert.equal(f.tx.auditLog.create.mock.callCount(), 0);
  });
}

test("unauthorized roles cannot edit classification or access the catalog", async (t) => {
  const f = fixture(t, "COLABORADOR");
  assert.ok("error" in await saveEquipment(actor, { ...base, lobId: "cec", usage: "STAFF" }));
  assert.equal(f.writes.length, 0);
  assert.deepEqual((await listEquipment(actor)).lobs, []);
});

test("list applies LOB and usage filters to rows, totals and summary; export retains them", async (t) => {
  const f = fixture(t);
  const query = { lobId: "ads", usage: "AGENTE", page: 2 };
  const result = await listEquipment(actor, query);
  assert.equal(result.data[0].lob, "ADS");
  assert.equal(result.data[0].usageLabel, "Agente");
  assert.deepEqual(result.lobs, lobs);
  const expected = { deletedAt: null, AND: [{ lobId: "ads" }, { usage: "AGENTE" }] };
  assert.deepEqual(f.equipment.findMany.mock.calls[0].arguments[0].where, expected);
  assert.deepEqual(f.equipment.count.mock.calls[0].arguments[0].where, expected);
  assert.deepEqual(f.equipment.groupBy.mock.calls[0].arguments[0].where, expected);
  assert.deepEqual(f.equipment.count.mock.calls[1].arguments[0].where.AND[0], expected);
  const exported = await exportEquipmentXlsxData(actor, query);
  assert.equal(exported.rows[0][exported.headers.indexOf("lob")], "ADS");
  assert.equal(exported.rows[0][exported.headers.indexOf("destinacao")], "Agente");
  const args = f.equipment.findMany.mock.calls[1].arguments[0];
  assert.deepEqual(args.where, expected);
  assert.equal(args.skip, undefined);
  assert.equal(args.take, undefined);
});

test("unclassified filters select nulls, and invalid usage cannot expose all rows", async (t) => {
  const f = fixture(t);
  await listEquipment(actor, { lobId: "unclassified", usage: "unclassified" });
  assert.deepEqual(f.equipment.findMany.mock.calls[0].arguments[0].where.AND, [{ lobId: null }, { usage: null }]);
  await listEquipment(actor, { usage: "invalid" });
  assert.deepEqual(f.equipment.findMany.mock.calls[1].arguments[0].where.AND, [{ id: { in: [] } }]);
});

const importRow = { numero_serie: "SN001", tipo_equipamento: "Notebook", modelo: "Model", status: "Em uso", data_entrega: "05/10/2026", responsavel_wb_login: employee.wbLogin };

test("import accepts existing LOB names without case sensitivity and commits both fields", async (t) => {
  const f = fixture(t);
  const result = await previewEquipmentImport(actor, [{ ...importRow, lob: " cEc ", destinacao: "treinamento" }]);
  assert.equal(result.summary.errorRows, 0);
  assert.equal(result.rows[0].lob, "CEC");
  assert.equal(result.rows[0].usage, "Treinamento");
  await commitEquipmentImport(actor, result.rows);
  assert.equal(f.writes[0].lobId, "cec");
  assert.equal(f.writes[0].usage, "TREINAMENTO");
});

test("legacy imports and blank optional columns preserve saved classification", async (t) => {
  const f = fixture(t);
  for (const row of [importRow, { ...importRow, lob: "", destinacao: "" }]) {
    const result = await previewEquipmentImport(actor, [row]);
    assert.equal(result.summary.errorRows, 0);
    await commitEquipmentImport(actor, result.rows);
  }
  assert.equal(f.writes.length, 2);
  for (const write of f.writes) {
    assert.equal(Object.hasOwn(write, "lobId"), false);
    assert.equal(Object.hasOwn(write, "usage"), false);
  }
});

test("import preview flags invalid classification and commit revalidates tampered rows", async (t) => {
  const f = fixture(t);
  const invalid = await previewEquipmentImport(actor, [{ ...importRow, lob: "Unknown", destinacao: "Agente" }, { ...importRow, lob: "ADS", destinacao: "Invalid" }]);
  assert.equal(invalid.summary.errorRows, 2);
  assert.ok(invalid.rows.every((row) => row.action === "ignore"));
  const valid = await previewEquipmentImport(actor, [{ ...importRow, lob: "ADS", destinacao: "Agente" }]);
  valid.rows[0].normalized!.lobId = "missing";
  const committed = await commitEquipmentImport(actor, valid.rows);
  assert.ok("summary" in committed && committed.summary);
  assert.equal(committed.summary.skippedRows, 1);
  assert.equal(committed.summary.errorRows, 1);
  assert.equal(f.writes.length, 0);
});

test("history fetch includes the saved equipment LOB and usage", async (t) => {
  const f = fixture(t);
  const result = await getEquipmentHistory(actor, record.id);
  assert.ok("data" in result && result.data);
  assert.equal(result.data.equipment.lob, "ADS");
  assert.equal(result.data.equipment.usageLabel, "Agente");
  assert.deepEqual(f.equipment.findFirst.mock.calls[0].arguments[0].include.lob, { select: { id: true, name: true } });
});
