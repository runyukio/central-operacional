import assert from "node:assert/strict";
import test from "node:test";

import { countFreshChatBacklog } from "./realtime-fresh-chat-service";

test("conta backlog FreshChat quando os status chegam como linhas de texto", () => {
  const summary = countFreshChatBacklog([], "status\nassigned\nnew\non hold\nAssigned\nNEW");

  assert.equal(summary.assignedCount, 2);
  assert.equal(summary.newCount, 2);
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
