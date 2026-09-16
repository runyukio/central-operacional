import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";

import { exportCampaignRaffleTickets } from "./campaign-raffle-service";
import { mockPrismaDelegate } from "./prisma-test-delegate";
import { buildXlsxBuffer } from "./xlsx-export";

const actor = { email: "reader@example.test", name: "Reader", role: "ADMIN" as const };
const ticket = (number: number, wbLogin = "wb_test", fullName = "Agente Teste") => ({ number, employee: { fullName, wbLogin } });
const identity = (role: string, lob = "ADS", status = "ACTIVE", terminationDate: Date | null = null) => ({
  id: "reader", status, role: { name: role }, employeeProfile: {
    id: "profile", roleTitle: role === "COLABORADOR" ? "Agente" : role,
    operationalStatus: "Ativo", deletedAt: null, terminationDate, lob: { name: lob }
  }
});

test("exporta uma linha por ticket da campanha, inclusive vários números do mesmo agente", async (t) => {
  mockPrismaDelegate(t, "user", { findFirst: async () => identity("ADMIN") });
  const campaign = mockPrismaDelegate(t, "raffleCampaign", { findUnique: async () => ({
    name: "Campanha Setembro", tickets: [ticket(1), ticket(42), ticket(10000, "wb_outro", "Outro Agente")]
  }) });
  const result = await exportCampaignRaffleTickets(actor, " campaign ");
  assert.deepEqual(result.headers, ["Número", "Nome do agente", "WB/Login"]);
  assert.deepEqual(result.rows, [[1, "Agente Teste", "wb_test"], [42, "Agente Teste", "wb_test"], [10000, "Outro Agente", "wb_outro"]]);
  assert.deepEqual(campaign.findUnique.mock.calls[0].arguments[0], {
    where: { id: "campaign" },
    select: { name: true, tickets: { orderBy: { number: "asc" }, select: {
      number: true, employee: { select: { fullName: true, wbLogin: true } }
    } } }
  }); // No pagination, current-agent eligibility, search, or other-team filters.
  assert.equal(result.fileName, "rifa_Campanha_Setembro.xlsx");
});

test("exportação respeita os perfis de consulta sem depender de permissão para distribuir", async (t) => {
  for (const role of ["ADMIN", "WFM", "GESTOR", "COORDENADOR", "GERENTE", "SUPERVISOR"]) {
    await t.test(role, async (sub) => {
      mockPrismaDelegate(sub, "user", { findFirst: async () => identity(role) });
      mockPrismaDelegate(sub, "raffleCampaign", { findUnique: async () => ({ name: "Campanha", tickets: [ticket(12)] }) });
      assert.equal((await exportCampaignRaffleTickets(actor, "campaign")).rows.length, 1);
    });
  }
});

test("nega export completo a agentes, POC, supervisor de outra LOB e usuários inativos", async (t) => {
  const identities = [identity("COLABORADOR"), identity("POC"), identity("RTA"), identity("QUALIDADE"),
    identity("SUPERVISOR", "CEC"), identity("SUPERVISOR", "ADS", "ACTIVE", new Date()), identity("ADMIN", "ADS", "INACTIVE"), null];
  for (const [index, user] of identities.entries()) {
    await t.test(String(index), async (sub) => {
      mockPrismaDelegate(sub, "user", { findFirst: async () => user });
      const campaign = mockPrismaDelegate(sub, "raffleCampaign", { findUnique: async () => assert.fail("Unauthorized data query") });
      await assert.rejects(() => exportCampaignRaffleTickets(actor, "campaign"), { status: !user || user.status !== "ACTIVE" ? 401 : 403 });
      assert.equal(campaign.findUnique.mock.callCount(), 0, "revalida o perfil no banco, não o ADMIN antigo do token");
    });
  }
});

test("exige autenticação e campanha explícita, sem usar silenciosamente outra campanha", async (t) => {
  mockPrismaDelegate(t, "user", { findFirst: async () => identity("ADMIN") });
  const campaign = mockPrismaDelegate(t, "raffleCampaign", { findUnique: async () => null });
  await assert.rejects(() => exportCampaignRaffleTickets({ ...actor, email: "" }, "campaign"), { status: 401 });
  for (const id of [undefined, null, "", "  "]) {
    await assert.rejects(() => exportCampaignRaffleTickets(actor, id), { status: 400 });
  }
  assert.equal(campaign.findUnique.mock.callCount(), 0);
  await assert.rejects(() => exportCampaignRaffleTickets(actor, "missing"), { status: 404 });
});

test("campanha sem tickets gera cabeçalho sem criar linhas ou números fictícios", async (t) => {
  mockPrismaDelegate(t, "user", { findFirst: async () => identity("WFM") });
  mockPrismaDelegate(t, "raffleCampaign", { findUnique: async () => ({ name: "Campanha vazia", tickets: [] }) });
  const result = await exportCampaignRaffleTickets(actor, "empty");
  assert.deepEqual(result.rows, []);
  const workbook = XLSX.read(buildXlsxBuffer(result), { type: "buffer" });
  assert.deepEqual(XLSX.utils.sheet_to_json(workbook.Sheets.Tickets, { header: 1 }), [result.headers]);
});

test("XLSX preserva 10.000 tickets, zeros visuais, nomes e WB como texto, sem fórmulas", async (t) => {
  mockPrismaDelegate(t, "user", { findFirst: async () => identity("ADMIN") });
  mockPrismaDelegate(t, "raffleCampaign", { findUnique: async () => ({
    name: 'Rifa "Setembro"\r\n/teste',
    tickets: Array.from({ length: 10000 }, (_, index) => ticket(index + 1, "wb_0001", "=Nome literal"))
  }) });
  const result = await exportCampaignRaffleTickets(actor, "full");
  assert.equal(result.rows.length, 10000);
  assert.match(result.fileName, /^rifa_[a-zA-Z0-9_-]+\.xlsx$/);
  const workbook = XLSX.read(buildXlsxBuffer(result), { type: "buffer", cellNF: true });
  const sheet = workbook.Sheets.Tickets;
  assert.deepEqual(workbook.SheetNames, ["Tickets"]);
  assert.equal(sheet["!ref"], "A1:C10001");
  assert.equal(sheet["!autofilter"]?.ref, "A1:C10001");
  assert.equal(sheet.A2.v, 1);
  assert.equal(sheet.A2.w, "00001");
  assert.equal(sheet.A10001.v, 10000);
  assert.equal(sheet.B2.v, "=Nome literal");
  assert.equal(sheet.B2.t, "s");
  assert.equal(sheet.B2.f, undefined);
  assert.equal(sheet.C2.v, "wb_0001");
});
