import assert from "node:assert/strict";
import test from "node:test";

import { countFreshChatBacklog, getFreshChatSnapshotFreshness } from "./realtime-fresh-chat-service";

test("conta backlog FreshChat quando os status chegam como linhas de texto", () => {
  const summary = countFreshChatBacklog([], "status\nassigned\nnew\nreopened\non hold\nAssigned\nNEW");

  assert.equal(summary.assignedCount, 2);
  assert.equal(summary.newCount, 3);
});

test("conta backlog FreshChat quando o status vem em objetos ou arrays", () => {
  const summary = countFreshChatBacklog([
    { ticket: "123", status: "assigned" },
    { ticket: "124", "Ticket Status": "new" },
    ["125", "open"],
    ["126", "assigned"],
    { values: { statusLabel: "new" } }
  ]);

  assert.equal(summary.assignedCount, 2);
  assert.equal(summary.newCount, 2);
});

test("ignora palavras parecidas que nao sao status de backlog", () => {
  const summary = countFreshChatBacklog([
    "unassigned",
    "renewal",
    "opened",
    { status: "on hold" },
    "assigned"
  ]);

  assert.equal(summary.assignedCount, 1);
  assert.equal(summary.newCount, 0);
});

test("considera o horario de geracao do relatorio para detectar snapshot vencido", () => {
  const freshness = getFreshChatSnapshotFreshness(
    {
      generatedDate: "2026-07-22T17:16:13.000Z",
      importedAt: "2026-07-24T12:00:00.000Z"
    },
    Date.parse("2026-07-24T12:05:00.000Z"),
    15
  );

  assert.equal(freshness.observedAt, "2026-07-22T17:16:13.000Z");
  assert.equal(freshness.ageMinutes, 2_568);
  assert.equal(freshness.isStale, true);
});

test("usa o horario de importacao quando a fonte nao informa a geracao", () => {
  const freshness = getFreshChatSnapshotFreshness(
    { importedAt: "2026-07-24T12:00:00.000Z" },
    Date.parse("2026-07-24T12:14:59.000Z"),
    15
  );

  assert.equal(freshness.observedAt, "2026-07-24T12:00:00.000Z");
  assert.equal(freshness.ageMinutes, 14);
  assert.equal(freshness.isStale, false);
});
