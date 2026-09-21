import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { AlertReading, buildAdsAlertMessages, evaluateAdsProductivityHour, kimAcceptedMessageKey,
  kimSupervisorMention, latestClosedAlertHour, validateAdsAlertWebhook } from "./ads-productivity-alert-core";
import { AlertDeliveryStore, deliverAdsAlertMessages, prepareAlertReadings, readAdsProductivityAlert } from "./ads-productivity-alert-service";
import { mockPrismaDelegate } from "./prisma-test-delegate";
import { prisma } from "./prisma";
import { GET } from "../app/api/cron/ads-productivity-alerts/route";

const now = new Date("2026-09-21T17:10:00Z");
const interval = latestClosedAlertHour(now);

test("hourly alert runs at minute 03 and bypasses sessions, not its own cron authorization", () => {
  const middleware = readFileSync("src/middleware.ts", "utf8");
  const matcher = JSON.parse(middleware.match(/matcher: (\[[^\n]+\])/u)![1]);
  assert.equal(unstable_doesMiddlewareMatch({ config: { matcher }, url: "https://test/api/cron/ads-productivity-alerts" }), false);
  assert.equal(unstable_doesMiddlewareMatch({ config: { matcher }, url: "https://test/api/performance" }), true);
  assert.equal(unstable_doesMiddlewareMatch({ config: { matcher }, url: "https://test/meu-espaco" }), true);
  const crons = JSON.parse(readFileSync("vercel.json", "utf8")).crons;
  assert.equal(crons.find((cron: { path: string }) => cron.path === "/api/cron/ads-productivity-alerts").schedule, "3 * * * *");
  assert.deepEqual(latestClosedAlertHour(new Date("2026-09-21T17:03:00Z")), interval);
});
function readings(submit = 20, minutes = 30, extra: Partial<AlertReading> = {}): AlertReading[] {
  return [interval.start, interval.middle, interval.end].map((cycle, index) => ({ cycle, employeeId: "agent-1",
    name: "Agent One", wbLogin: "wb_agent", lob: "ADS", personType: "Agente", employeeStatus: "Ativo", crossingStatus: "Encontrado",
    submit: 100 + index * submit / 2, moderationMs: 3_600_000 + index * minutes * 30_000,
    sourceValid: true, observedPresence: true, supervisorId: "supervisor-1", supervisorName: "Supervisor One", supervisorWb: "wb_supervisor", ...extra }));
}
const evaluate = (data: AlertReading[]) => evaluateAdsProductivityHour(data, interval, true);

test("full previous civil hour in São Paulo; midnight belongs to the prior day", () => {
  assert.deepEqual(interval, { start: "2026-09-21 13:00", middle: "2026-09-21 13:30", end: "2026-09-21 14:00" });
  assert.deepEqual(latestClosedAlertHour(new Date("2026-10-01T03:10:00Z")), {
    start: "2026-09-30 23:00", middle: "2026-09-30 23:30", end: "2026-10-01 00:00" });
});

test("AND rule with strict boundaries, compared before display rounding", () => {
  assert.equal(evaluate(readings(34, 44.999)).offenders.length, 1);
  assert.equal(evaluate(readings(36, 20)).offenders.length, 0);
  const exactly35 = readings(34, 20); exactly35[2].submit = 135;
  assert.equal(evaluate(exactly35).offenders.length, 0);
  assert.equal(evaluate(readings(20, 45)).offenders.length, 0);
  assert.equal(evaluate(readings(20, 46)).offenders.length, 0);
});

test("zero submits are excluded even with presence; pauses do not discount thresholds", () => {
  assert.equal(evaluate(readings(0, 0)).offenders.length, 0);
  assert.equal(evaluate(readings(0, 30)).offenders.length, 0);
  assert.equal(evaluate(readings(20, 30, { observedPresence: false })).offenders.length, 1, "production proves activity");
  assert.equal(evaluate(readings(0, 0, { observedPresence: false })).offenders.length, 0, "offline roster zero is not presence");
});

test("only matched ADS agents, including nesting, never staff/TNS/CEC/inactive", () => {
  for (const extra of [{ lob: "TNS" }, { lob: "VIDEO" }, { lob: "CEC" }, { personType: "Staff" },
    { employeeStatus: "Desligado" }, { employeeStatus: "Afastado" }, { crossingStatus: "Não encontrado" }, { employeeId: null }]) {
    assert.equal(evaluate(readings(20, 30, extra)).offenders.length, 0);
  }
  assert.equal(evaluate(readings(20, 30, { employeeStatus: "Nesting" })).offenders.length, 1);
});

test("missing endpoints, half hour, counters or raw evidence never become zero", () => {
  for (const index of [0, 1, 2]) assert.equal(evaluate(readings().filter((_, i) => i !== index)).offenders.length, 0);
  for (const extra of [{ submit: null }, { moderationMs: null }, { submit: -1 }, { moderationMs: NaN }, { sourceValid: false }]) {
    const data = readings(); data[1] = { ...data[1], ...extra };
    assert.equal(evaluate(data).offenders.length, 0);
  }
});

test("duplicate employee/checkpoint excluded, not summed or sent twice", () => {
  const data = readings();
  const result = evaluate([...data, { ...data[1], wbLogin: "alternate-login" }]);
  assert.equal(result.offenders.length, 0);
  assert.equal(result.issues[0].reason, "missing_or_duplicate_checkpoint");
});

test("midnight subtracts the prior day baseline; no daily cumulative alert", () => {
  const overnight = latestClosedAlertHour(new Date("2026-09-22T03:10:00Z"));
  const data = readings().map((row, index) => ({ ...row, cycle: [overnight.start, overnight.middle, overnight.end][index] }));
  assert.equal(evaluateAdsProductivityHour(data, overnight, true).offenders[0].submit, 20);
});

test("13:00 known reset preserves both half-hour increments; other drops excluded", () => {
  const resetInterval = latestClosedAlertHour(new Date("2026-09-21T16:10:00Z"));
  const data = readings().map((row, index) => ({ ...row, cycle: [resetInterval.start, resetInterval.middle, resetInterval.end][index],
    submit: [100, 110, 12][index], moderationMs: [3_600_000, 4_200_000, 900_000][index] }));
  const result = evaluateAdsProductivityHour(data, resetInterval, true);
  assert.equal(result.offenders[0].submit, 22);
  assert.equal(result.offenders[0].moderationMs, 1_500_000);
  const unexpected = readings(); unexpected[1].submit = 0;
  assert.equal(evaluate(unexpected).offenders.length, 0);
  assert.equal(evaluate(unexpected).issues[0].reason, "unexpected_counter_drop");
});

test("reject partial intervals rather than prorating fixed thresholds", () => {
  assert.throws(() => evaluateAdsProductivityHour(readings(), { ...interval, end: interval.middle }));
});

test("five-minute checkpoints preserve a reset first observed at 13:05 and require the entire hour", () => {
  const base = readings()[0];
  const data = Array.from({ length: 13 }, (_, index) => ({ ...base,
    cycle: `2026-09-21 ${index === 12 ? "14:00" : `13:${String(index * 5).padStart(2, "0")}`}`,
    submit: index === 0 ? 999 : index * 2, moderationMs: index === 0 ? 8_000_000 : index * 120_000 }));
  const result = evaluateAdsProductivityHour(data, interval, true, 5);
  assert.equal(result.offenders[0].submit, 24);
  assert.equal(result.offenders[0].moderationMs, 24 * 60_000);
  assert.equal(evaluateAdsProductivityHour(data.filter((_, i) => i !== 7), interval, true, 5).offenders.length, 0);
  const correction = structuredClone(data); correction[8].submit = 0;
  assert.equal(evaluateAdsProductivityHour(correction, interval, true, 5).offenders.length, 0);
});

test("five-minute source collection time, not a refreshed half-hour label, validates coverage", () => {
  const row = { ...readings(0, 0)[0], cycle: "2026-09-21 13:05", sourceCycle: "2026-09-21 13:00",
    submit: 2, moderationMs: 1000, batchId: "batch", wbKey: "wb_agent", sourceRows: 1, importedAt: now };
  const raw = { batchId: "batch", wbLogin: "wb_agent", status: "Pausa", rawData: { ciclo_download: row.sourceCycle,
    data_execucao: "2026-09-21 13:05:04", "审核量": 2, "真实审核时长（毫秒）": 1000 } };
  assert.equal(prepareAlertReadings([row], [raw])[0].sourceValid, true);
  assert.equal(prepareAlertReadings([row], [{ ...raw, rawData: { ...raw.rawData, data_execucao: "2026-09-21 13:25:04" } }])[0].sourceValid, false);
  assert.equal(prepareAlertReadings([row], [{ ...raw, rawData: { ...raw.rawData, data_execucao: "" } }])[0].sourceValid, false);
});

test("official KIM text mention syntax, no @all or injected names", () => {
  assert.equal(kimSupervisorMention("wb_sup"), "<@=username(wb_sup)=>");
  for (const value of ["all", "ALL", "x)=> <@=all=>", null, "a@company.com"]) assert.equal(kimSupervisorMention(value), "");
  const messages = buildAdsAlertMessages(evaluate(readings(20, 30, { name: "name\n<@=all=>" })));
  assert.equal(messages[0].msgtype, "text");
  assert.match(messages[0].text.content, /<@=username\(wb_supervisor\)=>/);
  assert.doesNotMatch(messages[0].text.content, /<@=all=>/);
  assert.match(messages[0].text.content, /30m00s de moderação \| 20 submits/);
});

test("one mention per supervisor and safe chunks below the KIM limit", () => {
  const many = Array.from({ length: 100 }, (_, index) => readings(20, 30, { employeeId: `a${index}`, name: `Agente ${index} com nome longo`, wbLogin: `wb_${index}` })).flat();
  const result = evaluate(many); const messages = buildAdsAlertMessages(result);
  assert.ok(messages.length > 1);
  for (const message of messages) {
    assert.ok(Buffer.byteLength(JSON.stringify(message), "utf8") < 7900);
    assert.equal(message.text.content.match(/<@=username\(wb_supervisor\)=>/g)?.length, 1);
  }
  assert.equal(messages.map((m) => m.text.content).join("\n").match(/de moderação \| 20 submits/g)?.length, 100);
  assert.deepEqual(buildAdsAlertMessages(evaluate(readings(40, 50))), []);
});

test("missing supervisor is explicit and cannot tag another agent", () => {
  const message = buildAdsAlertMessages(evaluate(readings(20, 30, { supervisorId: null, supervisorName: null, supervisorWb: null })))[0];
  assert.match(message.text.content, /Sem supervisor cadastrado/);
  assert.doesNotMatch(message.text.content, /<@=/);
});

const webhook = "https://kim-robot.kwaitalk.com/api/robot/send?key=test-only";
test("webhook restricted to the official HTTPS endpoint; errors do not echo secrets", () => {
  assert.equal(validateAdsAlertWebhook(webhook), webhook);
  for (const value of ["http://kim-robot.kwaitalk.com/api/robot/send?key=secret", "https://other.test?key=secret", "https://kim-robot.kwaitalk.com:8080/api/robot/send?key=secret", "https://kim-robot.kwaitalk.com/api/robot/send", "bad-secret"]) {
    assert.throws(() => validateAdsAlertWebhook(value), (e: unknown) => e instanceof Error && !e.message.includes("secret"));
  }
});

test("only a nonempty KIM messageKey confirms delivery", () => {
  assert.equal(kimAcceptedMessageKey({ data: { messageKey: "confirmed" } }), "confirmed");
  assert.equal(kimAcceptedMessageKey({ messageKey: "confirmed" }), "confirmed");
  assert.equal(kimAcceptedMessageKey({ status: 200, success: true, messageKey: '["confirmed"]' }), '["confirmed"]');
  assert.equal(kimAcceptedMessageKey({ messageKey: ["confirmed"] }), '["confirmed"]');
  for (const value of [{ code: 0 }, { status: 200 }, { data: { messageKey: "" } }, { messageKey: '[]' }, { messageKey: [] }, { success: false, messageKey: 'x' }, null, "ok"]) assert.equal(kimAcceptedMessageKey(value), null);
});

function memoryStore() {
  const receipts = new Map<string, unknown>();
  const store: AlertDeliveryStore = {
    async claim(key, digest) { if (receipts.has(key)) return false; receipts.set(key, { digest }); return true; },
    async finish(key, value) { receipts.set(key, value); }
  };
  return { store, receipts };
}
const messages = buildAdsAlertMessages(evaluate(readings()));
test("concurrent invocations and a corrected re-import claim an hour only once", async () => {
  const { store } = memoryStore(); let requests = 0;
  const fetcher: typeof fetch = async (_url, options) => {
    requests++; assert.equal(options?.redirect, "error");
    return Response.json({ data: { messageKey: `confirmed-${requests}` } });
  };
  const input = { webhook, intervalEnd: interval.end, messages, store, fetcher };
  const result = await Promise.all([deliverAdsAlertMessages(input), deliverAdsAlertMessages(input)]);
  assert.equal(requests, 1); assert.equal(result.reduce((sum, r) => sum + r.sent, 0), 1);
  await deliverAdsAlertMessages({ ...input, messages: [...messages, ...messages] });
  assert.equal(requests, 1, "changed pagination cannot duplicate a previously claimed hour");
});

test("timeouts or partial delivery retain claim and do not auto-resend", async () => {
  const { store, receipts } = memoryStore(); let requests = 0;
  const fetcher: typeof fetch = async () => { requests++; if (requests === 1) return Response.json({ messageKey: "sent-one" }); throw new Error("secret-url"); };
  const input = { webhook, intervalEnd: interval.end, messages: [...messages, ...messages], store, fetcher };
  await assert.rejects(() => deliverAdsAlertMessages(input), /Automatic resend is blocked/);
  assert.deepEqual([...receipts.values()][0], { status: "uncertain", messageKeys: ["sent-one"] });
  await deliverAdsAlertMessages(input); assert.equal(requests, 2);
});

test("raw-data validation distinguishes genuine zero, missing field, duplicate raw rows and pause", () => {
  const row = { ...readings(0, 0)[0], submit: 0, moderationMs: 0, batchId: "batch", wbKey: "wb_agent", sourceRows: 1, importedAt: now };
  const raw = { batchId: "batch", wbLogin: "wb_agent", status: "Pausa", rawData: { ciclo_download: interval.start, "审核量": 0, "真实审核时长（毫秒）": 0 } };
  assert.equal(prepareAlertReadings([row], [raw])[0].sourceValid, true);
  assert.equal(prepareAlertReadings([row], [raw])[0].observedPresence, true);
  assert.equal(prepareAlertReadings([row], [])[0].sourceValid, false);
  assert.equal(prepareAlertReadings([row], [raw, raw])[0].sourceValid, false);
  assert.equal(prepareAlertReadings([row], [{ ...raw, rawData: { ciclo_download: interval.start, "审核量": 0 } }])[0].sourceValid, false);
  assert.equal(prepareAlertReadings([row], [{ ...raw, rawData: { ...raw.rawData, "审核量": "" } }])[0].sourceValid, false);
});

test("query only current closed hour; missing/stale imports skip without data writes", async (t) => {
  t.mock.method(prisma, "$queryRaw", async (sql: PrismaSql) => {
    assert.ok(sql.values.includes(interval.start)); assert.ok(sql.values.includes(interval.end)); return [];
  });
  const result = await readAdsProductivityAlert(now, true);
  assert.equal(result.status, "skipped");
  if (result.status === "skipped") assert.equal(result.reason, "incomplete_hour");
});
type PrismaSql = { values: unknown[] };

test("cron denies missing/wrong credentials before accessing any data", async (t) => {
  const original = process.env.CRON_SECRET;
  t.after(() => { if (original === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = original; });
  delete process.env.CRON_SECRET;
  assert.equal((await GET(new Request("https://test/api/cron/ads-productivity-alerts"))).status, 503);
  process.env.CRON_SECRET = "test-only";
  assert.equal((await GET(new Request("https://test/api/cron/ads-productivity-alerts"))).status, 401);
  assert.equal((await GET(new Request("https://test/api/cron/ads-productivity-alerts", { headers: { authorization: "Bearer wrong" } }))).status, 401);
});

test("authorized dry-run is read only, never claims or delivers", async (t) => {
  const original = process.env.CRON_SECRET;
  t.after(() => { if (original === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = original; });
  process.env.CRON_SECRET = "test-only";
  t.mock.method(prisma, "$queryRaw", async () => []);
  const db = mockPrismaDelegate(t, "systemConfig", { create: async () => { throw new Error("must not write"); } });
  const response = await GET(new Request("https://test/api/cron/ads-productivity-alerts?dryRun=true", { headers: { authorization: "Bearer test-only" } }));
  assert.equal(response.status, 200); assert.equal(db.create.mock.callCount(), 0);
});
