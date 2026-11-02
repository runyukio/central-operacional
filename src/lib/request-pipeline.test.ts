import assert from "node:assert/strict";
import test from "node:test";
import { addBusinessHours, businessMillisecondsBetween, calculateRequestSla, requestDateBoundary, requestNextAction, selectPipeline, type PipelineRecord } from "./request-pipeline";

const friday = new Date("2026-10-30T15:00:00-03:00");
const tuesday = new Date("2026-11-03T15:00:00-03:00");
const entry = { createdAt: friday, from: "ABERTO", to: "EM_ANALISE" };
const request = { type: "Troca Casada", status: "EM_ANALISE", createdAt: new Date("2026-10-20T12:00:00Z"), history: [entry] };

test("48h count all weekday hours in São Paulo, pausing the entire weekend, including Monday's holiday", () => {
  assert.equal(addBusinessHours(friday).toISOString(), tuesday.toISOString());
  assert.equal(businessMillisecondsBetween(friday, tuesday), 48 * 3_600_000);
  assert.equal(addBusinessHours(new Date("2026-10-31T15:00:00-03:00")).toISOString(), "2026-11-04T03:00:00.000Z");
  assert.equal(addBusinessHours(new Date("2026-11-01T23:59:59-03:00")).toISOString(), "2026-11-04T03:00:00.000Z");
  assert.equal(addBusinessHours(new Date("2026-10-29T00:00:00-03:00")).toISOString(), "2026-10-31T03:00:00.000Z");
});

test("UTC Friday evening can already be Saturday locally, and vice versa", () => {
  const start = new Date("2026-10-31T01:00:00Z"); // Friday 22:00 in Brazil.
  assert.equal(addBusinessHours(start).toISOString(), "2026-11-04T01:00:00.000Z");
  assert.equal(businessMillisecondsBetween(new Date("2026-10-31T03:00:00Z"), new Date("2026-11-02T03:00:00Z")), 0);
});

test("exactly 48h is within deadline; one millisecond later is overdue; approval keeps counting", () => {
  assert.equal(calculateRequestSla(request, tuesday).state, "WITHIN_DEADLINE");
  assert.equal(calculateRequestSla(request, new Date(+tuesday + 1)).state, "OVERDUE");
  assert.equal(calculateRequestSla({ ...request, status: "APROVADO", payload: { stage: "DONE" } }, new Date(+tuesday + 1)).closed, false);
  assert.equal(calculateRequestSla({ ...request, status: "APROVADO" }, new Date(+tuesday + 1)).state, "OVERDUE");
});

test("direct WFM starts immediately; partner and supervisor steps do not start the clock", () => {
  assert.equal(calculateRequestSla({ ...request, type: "WFM", createdAt: friday, status: "ABERTO", history: [] }, friday).receivedAt, friday.toISOString());
  for (const stage of ["PARTNER", "SUPERVISOR"]) {
    const sla = calculateRequestSla({ ...request, status: "ABERTO", history: [], payload: { stage } }, tuesday);
    assert.equal(sla.state, "WAITING_WFM");
    assert.equal(sla.dueAt, null);
  }
  assert.equal(calculateRequestSla({ ...request, history: [], payload: { stage: "WFM", supervisorApprovedAt: friday.toISOString() } }, tuesday).receivedAt, friday.toISOString());
});

for (const status of ["CONCLUIDO", "RECUSADO", "CANCELADO"]) {
  test(`${status} freezes the deadline result at closure`, () => {
    const history = [entry, { createdAt: new Date(+tuesday - 60_000), from: "APROVADO", to: status }];
    const sla = calculateRequestSla({ ...request, status, history }, new Date("2026-12-01T12:00:00Z"));
    assert.equal(sla.state, "WITHIN_DEADLINE");
    assert.equal(sla.closed, true);
    assert.equal(sla.remainingBusinessMinutes, 1);
    const late = calculateRequestSla({ ...request, status, history: [entry, { ...history[1], createdAt: new Date(+tuesday + 60_000) }] }, new Date("2026-12-01T12:00:00Z"));
    assert.equal(late.state, "OVERDUE");
    assert.equal(late.remainingBusinessMinutes, -1);
  });
}

test("missing old timing is explicit, never inferred from creation, approval or last update", () => {
  assert.equal(calculateRequestSla({ ...request, history: [] }, tuesday).state, "UNRECORDED");
  assert.equal(calculateRequestSla({ ...request, status: "APROVADO", history: [] }, tuesday).dueAt, null);
  assert.equal(calculateRequestSla({ ...request, status: "CONCLUIDO" }, tuesday).state, "UNRECORDED");
  assert.equal(calculateRequestSla({ ...request, history: [{ ...entry, from: "EM_ANALISE" }] }, tuesday).state, "UNRECORDED");
});

test("the earliest WFM entry survives later approval and more than 30 history records", () => {
  const history = [entry, ...Array.from({ length: 50 }, (_, i) => ({ createdAt: new Date(+friday + (i + 1) * 1000), from: "EM_ANALISE", to: "EM_ANALISE" }))].reverse();
  assert.equal(calculateRequestSla({ ...request, history }, tuesday).receivedAt, friday.toISOString());
});

test("approved paired swaps remain assigned to WFM/Admin until administrative completion", () => {
  assert.deepEqual(requestNextAction({ type: "Troca Casada", status: "APROVADO", payload: { stage: "DONE" } }), { nextStep: "Aguardando conclusão", nextOwner: "WFM/Admin" });
  assert.equal(requestNextAction({ type: "Troca Casada", status: "CONCLUIDO", payload: { stage: "DONE" } }).nextOwner, "Sem próxima ação");
});

const rows: PipelineRecord[] = Array.from({ length: 125 }, (_, i) => ({
  id: `REQ-${1000 + i}`, type: i % 2 ? "Troca Casada" : "WFM", title: "Revisar escala",
  status: i < 60 ? "Aberto" : i < 100 ? "Aprovado" : "Concluído", requester: "João Teste", requesterWbLogin: `wb_${i}`,
  supervisor: "Jéssica Silva", nextOwner: i < 60 ? "WFM" : "WFM/Admin", nextStep: i < 60 ? "Análise WFM" : "Aguardando conclusão",
  createdAtIso: new Date(+friday + i * 60_000).toISOString(),
  sla: calculateRequestSla({ ...request, type: "WFM", createdAt: friday, status: i < 100 ? "ABERTO" : "CONCLUIDO",
    history: i < 100 ? [] : [{ createdAt: tuesday, from: "APROVADO", to: "CONCLUIDO" }] }, new Date(+tuesday + 1))
}));

test("counts, oldest pending and status slices span every matching result, before pagination", () => {
  const result = selectPipeline(rows, { status: "Aprovado", limit: 50 });
  assert.equal(result.total, 40);
  assert.equal(result.summary.awaitingCompletion, 40);
  assert.equal(result.statusSummary.byStatus.Aberto, 60);
  assert.equal(result.statusSummary.total, 125);
  assert.equal(result.summary.oldestPending?.id, "REQ-1060");
  const all = selectPipeline(rows, {});
  assert.equal(all.data.length, 50);
  assert.equal(all.totalPages, 3);
  assert.equal(all.summary.overdue, 100);
  assert.equal(all.summary.oldestPending?.id, "REQ-1000");
  assert.equal(selectPipeline(rows, { page: 3 }).data.length, 25);
  assert.equal(selectPipeline(rows, { page: 99 }).page, 3);
});

test("unified search finds WB, accented names, owner and next action across pages", () => {
  assert.equal(selectPipeline(rows, { search: "wb_124" }).total, 1);
  assert.equal(selectPipeline(rows, { search: "jessica joao" }).total, 125);
  assert.equal(selectPipeline(rows, { search: "aguardando conclusao", status: "Aprovado" }).total, 40);
  assert.equal(selectPipeline(rows, { search: "WFM/Admin" }).total, 65);
});

test("deadline filtering excludes closed records and composes with status/search", () => {
  const result = selectPipeline(rows, { deadline: "OVERDUE", search: "jessica", status: "Aprovado" });
  assert.equal(result.total, 40);
  assert.equal(result.statusSummary.total, 100);
  assert.equal(result.summary.overdue, 40);
  assert.equal(selectPipeline(rows, { deadline: "WITHIN_DEADLINE" }).total, 0);
  assert.equal(selectPipeline([{ ...rows[0], sla: calculateRequestSla({ ...request, status: "ABERTO", history: [] }) }], { deadline: "WAITING_WFM" }).total, 1);
});

test("deadline sort places overdue active records first and missing timing last", () => {
  const missing = { ...rows[0], id: "missing", sla: undefined };
  const earlier = { ...rows[0], id: "earlier", sla: { ...rows[0].sla!, dueAt: friday.toISOString() } };
  const result = selectPipeline([missing, rows[0], rows[124], earlier], { sort: "deadline" });
  assert.deepEqual(result.data.map(row => row.id), ["earlier", rows[0].id, rows[124].id, "missing"]);
  assert.equal(selectPipeline(rows, {}).data[0].id, "REQ-1124");
});

test("long historical spans count whole weeks and preserve signed weekday duration", () => {
  const monday = new Date("2026-01-05T00:00:00-03:00");
  const end = new Date(+monday + 52 * 7 * 24 * 3_600_000);
  assert.equal(businessMillisecondsBetween(monday, end), 52 * 5 * 24 * 3_600_000);
  assert.equal(businessMillisecondsBetween(end, monday), -52 * 5 * 24 * 3_600_000);
});


test("date filters include the entire São Paulo day independently of the server timezone", () => {
  assert.equal(requestDateBoundary("2026-11-02")?.toISOString(), "2026-11-02T03:00:00.000Z");
  assert.equal(requestDateBoundary("2026-11-02", true)?.toISOString(), "2026-11-03T02:59:59.999Z");
  assert.equal(requestDateBoundary("2026-11-31"), null);
});

test("refusal before WFM closes without inventing a deadline", () => {
  const sla = calculateRequestSla({ ...request, status: "RECUSADO", history: [{ createdAt: friday, from: "ABERTO", to: "RECUSADO" }] }, tuesday);
  assert.equal(sla.state, "NOT_APPLICABLE");
  assert.equal(sla.dueAt, null);
});
