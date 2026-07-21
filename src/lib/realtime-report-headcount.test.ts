import assert from "node:assert/strict";
import test from "node:test";

import { isReportOnlineHeadcountRow } from "./realtime-report-headcount";

test("conta os sinais operacionais validos da Captura de Horas", () => {
  assert.equal(isReportOnlineHeadcountRow({ presenceStatus: "Online", isSchedulePresent: false }), true);
  assert.equal(isReportOnlineHeadcountRow({ presenceStatus: "Tela bloqueada", isSchedulePresent: false }), true);
  assert.equal(isReportOnlineHeadcountRow({ presenceStatus: "Ocioso", isSchedulePresent: false }), true);
});

test("mantem presente no report durante pausas previstas pelo cronograma", () => {
  assert.equal(isReportOnlineHeadcountRow({ presenceStatus: "Offline", isSchedulePresent: true }), true);
});

test("nao conta agente offline e sem presenca no cronograma", () => {
  assert.equal(isReportOnlineHeadcountRow({ presenceStatus: "Offline", isSchedulePresent: false }), false);
});
