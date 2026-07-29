import assert from "node:assert/strict";
import test from "node:test";

import {
  isExecutivePresentHeadcountRow,
  isReportOnlineHeadcountRow
} from "./realtime-report-headcount";

test("no Report conta os sinais ativos, inclusive tela bloqueada e ocioso", () => {
  assert.equal(isReportOnlineHeadcountRow({ presenceStatus: "Online", isSchedulePresent: false }), true);
  assert.equal(isReportOnlineHeadcountRow({ presenceStatus: "Tela bloqueada", isSchedulePresent: false }), true);
  assert.equal(isReportOnlineHeadcountRow({ presenceStatus: "Ocioso", isSchedulePresent: false }), true);
});

test("no Report preserva a presença confirmada no cronograma durante a pausa", () => {
  assert.equal(isReportOnlineHeadcountRow({ presenceStatus: "Offline", isSchedulePresent: true }), true);
});

test("nao conta agente offline e sem presenca no cronograma", () => {
  assert.equal(isReportOnlineHeadcountRow({ presenceStatus: "Offline", isSchedulePresent: false }), false);
});

test("no Executive usa a mesma regra de presença do Report", () => {
  assert.equal(isExecutivePresentHeadcountRow({ presenceStatus: "Online", isSchedulePresent: false }), true);
  assert.equal(isExecutivePresentHeadcountRow({ presenceStatus: "Offline", isSchedulePresent: true }), true);
  assert.equal(isExecutivePresentHeadcountRow({ presenceStatus: "Tela bloqueada", isSchedulePresent: false }), true);
  assert.equal(isExecutivePresentHeadcountRow({ presenceStatus: "Ocioso", isSchedulePresent: false }), true);
});
