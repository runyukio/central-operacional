import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildAdsAlertMentions, buildAdsAlertSummary, type AdsAlertResult } from "./ads-productivity-alert-core";
import { ADS_ALERT_MAX_HEIGHT, AdsAlertImage, adsAlertImageHeight, paginateAdsAlertImages, renderAdsAlertPng } from "./ads-productivity-alert-image";
import { kimImageMediaId, prepareAdsAlertDelivery, uploadAdsAlertImage } from "./ads-productivity-alert-kim";
import { deliverAdsAlertMessages, type AlertDeliveryStore } from "./ads-productivity-alert-service";

const webhook = "https://kim-robot.kwaitalk.com/api/robot/send?key=test-only";
function sample(count = 11, supervisors = 2): AdsAlertResult {
  const offenders = Array.from({ length: count }, (_, index) => ({ employeeId: `agent-${index}`, name: `Agente ${index}`, wbLogin: `wb_agent${index}`,
      supervisorId: `supervisor-${Math.floor(index / Math.ceil(count / supervisors))}`, supervisorName: `Supervisor ${Math.floor(index / Math.ceil(count / supervisors))}`,
      supervisorWb: `wb_sup${Math.floor(index / Math.ceil(count / supervisors))}`, submit: index % 34 + 1, moderationMs: (index % 44) * 60_000 + 35_000,
      cumulativeSubmit: index % 34 + 1, cumulativeModerationMs: (index % 44) * 60_000 + 35_000 }));
  return { interval: { start: "2026-09-21 14:00", middle: "2026-09-21 14:30", end: "2026-09-21 15:00" }, evaluatedCount: count,
    evaluated: offenders, offenders,
    issues: [], outsideInterval: 0 };
}

test("approved summary uses bold/color, AND rule and no agent details repeated in text", () => {
  const result = sample();
  const summary = buildAdsAlertSummary(result);
  assert.equal(summary.msgtype, "markdown");
  assert.match(summary.markdown.content, /\*\*11 agentes abaixo dos dois limites\*\*/);
  assert.match(summary.markdown.content, /<font color="warning">/);
  assert.match(summary.markdown.content, /menos de 35/);
  assert.match(summary.markdown.content, /menos de 45 minutos/);
  assert.match(summary.markdown.content, /mesmo intervalo/);
  assert.match(summary.markdown.content, /Zero submit não entra/);
  assert.doesNotMatch(summary.markdown.content, /wb_agent|<@=/);
  const mentions = buildAdsAlertMentions(result);
  assert.equal(mentions.length, 1);
  assert.match(mentions[0].text.content, /<@=username\(wb_sup0\)=>: 6 agentes/);
  assert.match(mentions[0].text.content, /<@=username\(wb_sup1\)=>: 5 agentes/);
  assert.equal((mentions[0].text.content.match(/<@=/g) ?? []).length, 2);
  assert.doesNotMatch(mentions[0].text.content, /wb_agent|Supervisor 0/);
});

test("pagination preserves every agent exactly once and the image budget for many supervisors", () => {
  for (const supervisors of [1, 2, 200]) {
    const result = sample(200, supervisors); const pages = paginateAdsAlertImages(result);
    assert.ok(pages.length > 1);
    assert.deepEqual(pages.flatMap(p => p.rows.map(r => r.employeeId)), result.offenders.map(r => r.employeeId));
    for (const [index, page] of pages.entries()) {
      assert.ok(page.height <= ADS_ALERT_MAX_HEIGHT);
      assert.equal(page.height, adsAlertImageHeight(page.rows));
      assert.equal(page.pageNumber, index + 1); assert.equal(page.pageCount, pages.length);
    }
  }
  assert.deepEqual(paginateAdsAlertImages(sample(0)), []);
});

test("image carries exact hour, names, units and measures without recomputing or rounding to 45m", async () => {
  const result = sample(2);
  result.offenders[0].moderationMs = 2_699_999;
  const page = paginateAdsAlertImages(result)[0];
  const markup = renderToStaticMarkup(createElement(AdsAlertImage, { result, page }));
  assert.match(markup, /14:00 a 15:00/); assert.match(markup, /44m59s/);
  for (const row of result.offenders) assert.ok(markup.includes(row.wbLogin));
  assert.match(markup, /Menos de 35/); assert.match(markup, /Menos de 45 minutos/);
  assert.match(markup, /font-weight:700/);
  assert.match(markup, /Valores da hora, não acumulados do dia/);
  const png = await renderAdsAlertPng(result, page);
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.equal(png.readUInt32BE(16), 1080); assert.equal(png.readUInt32BE(20), page.height);
  assert.ok(png.length < 2 * 1024 * 1024);
});

test("image upload goes only to KIM multipart endpoint, never public storage or a redirected host", async () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  let requests = 0;
  const fetcher: typeof fetch = async (url, options) => {
    requests++; assert.equal(url, "https://kim-robot.kwaitalk.com/api/robot/upload");
    assert.equal(options?.redirect, "error"); assert.equal(options?.method, "POST");
    assert.equal(options?.headers, undefined, "fetch must set the multipart boundary");
    const form = options?.body as FormData;
    assert.equal(form.get("key"), "test-only"); assert.equal(form.get("type"), "image");
    const file = form.get("media") as File; assert.equal(file.type, "image/png"); assert.equal(file.name, "ads-alert-1.png");
    return Response.json({ type: "image", media_id: "ks://confirmed.png/7" });
  };
  assert.equal(await uploadAdsAlertImage(png, webhook, 1, fetcher), "ks://confirmed.png/7");
  for (const buffer of [Buffer.from("not png"), Buffer.alloc(2 * 1024 * 1024 + 1)]) await assert.rejects(() => uploadAdsAlertImage(buffer, webhook, 1, fetcher));
  assert.equal(requests, 1);
  for (const payload of [{ media_id: "https://public.example/file" }, { type: "file", media_id: "ks://x" }, { success: false, media_id: "ks://x" }, {}, { data: { media_id: "" } }]) assert.equal(kimImageMediaId(payload), null);
  assert.equal(kimImageMediaId({ data: { type: "image", media_id: "ks://x" } }), "ks://x");
});

test("delivery prepares all pages and sends summary, images and real supervisor mentions", async () => {
  const result = sample(40); const rendered: string[] = [];
  const payloads = await prepareAdsAlertDelivery(result, webhook, {
    render: async (_result, page) => { rendered.push(...page.rows.map(r => r.wbLogin)); return Buffer.from("mock-png"); },
    upload: async (_png, url, pageNumber) => { assert.equal(url, webhook); return `ks://page-${pageNumber}`; }
  });
  assert.deepEqual(rendered, result.offenders.map(r => r.wbLogin));
  assert.equal(payloads[0].msgtype, "markdown"); assert.equal(payloads.at(-1)?.msgtype, "text");
  assert.equal(payloads.filter(p => p.msgtype === "image").length, paginateAdsAlertImages(result).length);
  for (const payload of payloads) assert.ok(Buffer.byteLength(JSON.stringify(payload)) < 7900);
  assert.deepEqual(await prepareAdsAlertDelivery(sample(0), webhook), []);
});

test("claim precedes uploads and prevents duplicate work or partial summary on upload failure", async () => {
  const events: string[] = []; let claimed = false;
  const store: AlertDeliveryStore = {
    async claim() { events.push("claim"); if (claimed) return false; claimed = true; return true; },
    async finish(_key, value) { events.push(value.status); }
  };
  const fetcher: typeof fetch = async () => { events.push("send"); return Response.json({ messageKey: "confirmed" }); };
  const input = { webhook, intervalEnd: "2026-09-21 15:00", messages: [buildAdsAlertSummary(sample())], store, fetcher,
    prepareMessages: async () => { events.push("upload"); throw new Error("provider-secret"); } };
  await assert.rejects(() => deliverAdsAlertMessages(input), /Automatic resend is blocked/);
  assert.deepEqual(events, ["claim", "upload", "uncertain"]);
  await deliverAdsAlertMessages(input);
  assert.deepEqual(events, ["claim", "upload", "uncertain", "claim"]);
});

test("an interrupted image/text delivery keeps confirmed receipts and does not resend", async () => {
  let claimed = false; let requests = 0; let receipt: unknown;
  const store: AlertDeliveryStore = { async claim() { if (claimed) return false; claimed = true; return true; }, async finish(_key, value) { receipt = value; } };
  const input = { webhook, intervalEnd: "2026-09-21 15:00", messages: [buildAdsAlertSummary(sample())], store,
    prepareMessages: async () => [buildAdsAlertSummary(sample()), { msgtype: "image" as const, image: { media_id: "ks://image" } }, ...buildAdsAlertMentions(sample())],
    fetcher: (async () => { requests++; if (requests === 2) throw new Error("timeout"); return Response.json({ messageKey: "summary-confirmed" }); }) as typeof fetch };
  await assert.rejects(() => deliverAdsAlertMessages(input));
  assert.deepEqual(receipt, { status: "uncertain", messageKeys: ["summary-confirmed"] });
  await deliverAdsAlertMessages(input); assert.equal(requests, 2);
});
