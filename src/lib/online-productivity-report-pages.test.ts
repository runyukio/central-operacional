import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { buildAdsOnlineProductivityReportSnapshot, type AdsOnlineProductivityReportSnapshot } from "./ads-online-productivity-report-core";
import {
  ONLINE_PRODUCTIVITY_IMAGE_WIDTH,
  ONLINE_PRODUCTIVITY_MAX_IMAGE_HEIGHT,
  onlineProductivityImageHeight,
  onlineProductivityPageDelivery,
  paginateOnlineProductivityReport
} from "./online-productivity-report-pages";

function reportFixture(rows = 500, skills = 13): AdsOnlineProductivityReportSnapshot {
  return {
    ...buildAdsOnlineProductivityReportSnapshot({ selectedCycle: "2026-07-29 14:58", agentRows: [] }),
    productiveAgentCount: rows,
    averageSubmitPerHour: 123,
    totalShiftSubmit: 9999,
    rows: Array.from({ length: rows }, (_, index) => ({ name: `Partner ${index}`, wbLogin: `wb-${index}`, skill: `Skill ${index % Math.max(1, skills)}`, currentSubmit: rows - index, previousSubmit: 1, comparisonPercent: 100, comparison: "up", shiftTotal: 10, ahtMs: 60_000, moderationMs: 60_000 })),
    skillAverages: Array.from({ length: skills }, (_, index) => ({ skill: `Skill ${index}`, averageSubmit: 12, agentCount: 1 }))
  };
}

test("all 500 partners and skill summaries survive pagination in order within a fixed pixel budget", () => {
  const report = reportFixture();
  const before = structuredClone(report);
  const pages = paginateOnlineProductivityReport(report);
  assert.ok(pages.length > 1);
  assert.deepEqual(pages.flatMap((page) => page.report.rows), report.rows);
  assert.deepEqual(pages.flatMap((page) => page.report.skillAverages), report.skillAverages);
  let rowOffset = 0;
  for (const [index, page] of pages.entries()) {
    assert.equal(page.pageNumber, index + 1);
    assert.equal(page.pageCount, pages.length);
    assert.equal(page.rowOffset, rowOffset);
    assert.equal(page.totalRows, 500);
    assert.equal(page.maxSubmit, 500);
    assert.equal(page.report.averageSubmitPerHour, report.averageSubmitPerHour);
    assert.equal(page.report.totalShiftSubmit, report.totalShiftSubmit);
    assert.equal(page.report.productiveAgentCount, report.productiveAgentCount);
    assert.equal(page.height, onlineProductivityImageHeight(page.report.rows.length, page.report.skillAverages.length));
    assert.ok(page.height <= ONLINE_PRODUCTIVITY_MAX_IMAGE_HEIGHT);
    assert.ok(ONLINE_PRODUCTIVITY_IMAGE_WIDTH * page.height <= 5_120_000);
    rowOffset += page.report.rows.length;
  }
  assert.deepEqual(report, before);
});

test("skill-only continuation and an empty report are bounded without dropping summaries", () => {
  for (const [rowCount, skills] of [[0, 0], [0, 200], [1, 200], [5, 2]]) {
    const report = reportFixture(rowCount, skills);
    const pages = paginateOnlineProductivityReport(report);
    assert.ok(pages.length >= 1);
    assert.equal(pages.flatMap((page) => page.report.rows).length, rowCount);
    assert.equal(pages.flatMap((page) => page.report.skillAverages).length, skills);
    assert.ok(pages.every((page) => page.height <= ONLINE_PRODUCTIVITY_MAX_IMAGE_HEIGHT));
  }
});

test("single-page names/keys stay compatible and multipage keys are unique and deterministic", () => {
  assert.deepEqual(onlineProductivityPageDelivery("report.png", "report:cycle", { pageNumber: 1, pageCount: 1 }), { fileName: "report.png", idempotencyKey: "report:cycle" });
  const pages = paginateOnlineProductivityReport(reportFixture());
  const deliveries = pages.map((page) => onlineProductivityPageDelivery("report.png", "report:cycle", page));
  assert.equal(new Set(deliveries.map((delivery) => delivery.fileName)).size, pages.length);
  assert.equal(new Set(deliveries.map((delivery) => delivery.idempotencyKey)).size, pages.length);
  assert.deepEqual(deliveries, pages.map((page) => onlineProductivityPageDelivery("report.png", "report:cycle", page)));
});

function simulatedDelivery(report: AdsOnlineProductivityReportSnapshot, failPage?: number) {
  const content = readFileSync("src/lib/ads-executive-webhook-service.ts", "utf8");
  const source = ts.createSourceFile("service.ts", content, ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find((statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement) && statement.name?.text === "sendLatestOnlineProductivityReport");
  assert.ok(declaration);
  const events: string[] = [];
  const requests: Array<Record<string, any>> = [];
  const renderedRows: string[] = [];
  const subject = vm.runInNewContext(ts.transpileModule(`const subject = (${declaration.getText(source)}); subject;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
    Buffer, Date, Error, isWebhookEnabled: () => true, resolveWebhookUrl: () => "https://mock.invalid",
    getRealtimeSnapshot: async () => ({ data: { agents: { selectedCycle: report.selectedCycle, rows: [] }, queueView: {}, summary: { hasData: true } } }),
    automationActor: {}, mapAgentRows: () => [], buildAdsOnlineProductivityReportSnapshot: () => report, buildTnsOnlineProductivityReportSnapshot: () => report,
    paginateOnlineProductivityReport, onlineProductivityPageDelivery, safeFilePart: () => "cycle", resolvePayloadMode: () => "kwaitalk", resolveWebhookToken: () => "mock", resolveTimeoutMs: () => 100,
    renderAdsOnlineProductivityReportPng: async (snapshot: AdsOnlineProductivityReportSnapshot, page: { pageNumber: number }) => { events.push(`render:${page.pageNumber}`); renderedRows.push(...snapshot.rows.map((row) => row.wbLogin)); return Buffer.from("mock-png"); },
    publishKwaiTalkImage: async (_: Buffer, name: string) => { events.push(`upload:${name}`); return `https://mock.invalid/${name}`; },
    postWebhook: async (input: Record<string, any>) => { events.push(`send:${input.metadata.pageNumber}`); if (Number(input.metadata.pageNumber) === failPage) throw new Error("Simulated failure"); requests.push(input); return { status: 200 }; }
  }) as (config: unknown) => Promise<{ pageCount: number; bytes: number; fileNames: string[] }>;
  const result = subject({ reportScope: report.reportScope, webhookConfig: { lob: "ADS" }, filePrefix: "report", idempotencyPrefix: "report", reportTitle: "Online", reportType: "ADS_ONLINE_PRODUCTIVITY", storagePath: "mock" });
  return { result, events, requests, renderedRows };
}

test("delivery renders/uploads/sends every numbered page sequentially with no live network", async () => {
  const report = reportFixture(100);
  const { result, events, requests, renderedRows } = simulatedDelivery(report);
  const delivery = await result;
  const count = paginateOnlineProductivityReport(report).length;
  assert.equal(delivery.pageCount, count);
  assert.equal(delivery.fileNames.length, count);
  assert.equal(delivery.bytes, count * Buffer.byteLength("mock-png"));
  assert.deepEqual(renderedRows, report.rows.map((row) => row.wbLogin));
  for (let index = 0; index < count; index++) {
    assert.equal(events[index * 3], `render:${index + 1}`);
    assert.match(events[index * 3 + 1], /^upload:/);
    assert.equal(events[index * 3 + 2], `send:${index + 1}`);
    assert.equal(requests[index].metadata.pageNumber, String(index + 1));
    assert.equal(requests[index].metadata.pageCount, String(count));
  }
});

test("partial delivery failure reports the failed page instead of claiming a complete report", async () => {
  const { result, requests, events } = simulatedDelivery(reportFixture(100), 2);
  await assert.rejects(result, /page 2\/\d+ failed after 1 delivered page\(s\): Simulated failure/);
  assert.equal(requests.length, 1);
  assert.equal(events.some((event) => event === "render:3"), false);
});
