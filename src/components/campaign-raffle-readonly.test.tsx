import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const localRequire = createRequire(import.meta.url);
const source = readFileSync(new URL("./campaign-raffle-page.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(`${source}\nexport { StaffCampaignView, TicketAssignmentsPanel };`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
}).outputText;
const compiledModule = { exports: {} as { StaffCampaignView: ComponentType<any>; TicketAssignmentsPanel: ComponentType<any> } };
const Panel = ({ title, children }: { title: string; children: React.ReactNode }) => createElement("section", null, createElement("h2", null, title), children);
const StatCard = ({ title, value }: { title: string; value: string }) => createElement("div", null, `${title}: ${value}`);
const dependencies: Record<string, unknown> = { "@/components/ui/primitives": { Panel, StatCard } };
new Function("require", "exports", "module", compiled)((name: string) => dependencies[name] ?? localRequire(name), compiledModule.exports, compiledModule);
const holders = [{ employeeId: "agent", name: "Parceiro Teste", wbLogin: "wb_test", status: "Ativo", tickets: [{ id: "ticket", number: 42, assignedAt: "2026-09-09T12:00:00Z" }] }];

test("read-only raffle opens all tickets without create/distribute/delete controls", () => {
  const html = renderToStaticMarkup(createElement(compiledModule.exports.StaffCampaignView, {
    payload: {
      access: { canManage: false, canViewOwn: false }, selectedCampaignId: "campaign",
      campaigns: [{ id: "campaign", name: "Campanha Teste", status: "ACTIVE" }],
      summary: { usedTickets: 1, availableTickets: 9999, coveredAgents: 1, distributions: 1 },
      agents: [], recentDistributions: [], ticketHolders: holders
    },
    selectedCampaignId: "", selectedEmployeeIds: [], ticketsPerEmployee: 1, agentSearch: "",
    setSelectedCampaignId: () => {}, setSelectedEmployeeIds: () => {}, setTicketsPerEmployee: () => {}, setAgentSearch: () => {},
    onCreate: () => {}, onPrepare: () => {}, onDeleteTicket: () => {}
  }));
  for (const text of ["Todos os tickets", "Buscar agente ou ticket", "Parceiro Teste", "00042"]) assert.ok(html.includes(text), text);
  for (const text of ["Nova campanha", "Distribuir tickets", "Excluir ticket"]) assert.ok(!html.includes(text), text);
});

test("ticket deletion control remains available only with manager callback", () => {
  for (const canManage of [true, false]) {
    const html = renderToStaticMarkup(createElement(compiledModule.exports.TicketAssignmentsPanel, {
      holders, search: "", setSearch: () => {}, onDeleteTicket: canManage ? () => {} : undefined
    }));
    assert.equal(html.includes("Excluir ticket 00042"), canManage);
  }
});
