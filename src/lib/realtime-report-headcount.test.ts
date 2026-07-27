import assert from "node:assert/strict";
import test from "node:test";

import {
  isExecutivePresentHeadcountRow,
  isReportOnlineHeadcountRow
} from "./realtime-report-headcount";

test("no Report conta somente quem está efetivamente Online", () => {
  assert.equal(isReportOnlineHeadcountRow({ presenceStatus: "Online", isSchedulePresent: false }), true);
  assert.equal(isReportOnlineHeadcountRow({ presenceStatus: "Tela bloqueada", isSchedulePresent: false }), false);
  assert.equal(isReportOnlineHeadcountRow({ presenceStatus: "Ocioso", isSchedulePresent: false }), false);
});

test("no Report não transforma presença da escala em status online", () => {
  assert.equal(isReportOnlineHeadcountRow({ presenceStatus: "Offline", isSchedulePresent: true }), false);
});

test("nao conta agente offline e sem presenca no cronograma", () => {
  assert.equal(isReportOnlineHeadcountRow({ presenceStatus: "Offline", isSchedulePresent: false }), false);
});

test("no Executive considera quem esteve presente ou está online", () => {
  assert.equal(isExecutivePresentHeadcountRow({ presenceStatus: "Online", isSchedulePresent: false }), true);
  assert.equal(isExecutivePresentHeadcountRow({ presenceStatus: "Offline", isSchedulePresent: true }), true);
  assert.equal(isExecutivePresentHeadcountRow({ presenceStatus: "Tela bloqueada", isSchedulePresent: false }), false);
  assert.equal(isExecutivePresentHeadcountRow({ presenceStatus: "Ocioso", isSchedulePresent: false }), false);
});
