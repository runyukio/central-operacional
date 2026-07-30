import assert from "node:assert/strict";
import test from "node:test";

import { loadImage } from "@napi-rs/canvas";

import {
  buildCecKwaiTalkMarkdownPayload,
  buildCecResolvedHourlyReport,
  renderCecResolvedKimReport,
  sendCecResolvedReportToKim,
  type CecHourlySnapshotInput
} from "@/lib/realtime-cec-kim-report";

function snapshot(
  cycleDownload: string,
  tickets: Array<{ ticket: string; agentName: string; status: string }>,
  fileName = `${cycleDownload}.csv`
): CecHourlySnapshotInput {
  return {
    cycleDownload,
    fileName,
    generatedDate: `${cycleDownload.replace(" ", "T")}:00-03:00`,
    importedAt: new Date(`${cycleDownload.replace(" ", "T")}:00-03:00`),
    rawData: { tickets }
  };
}

test("builds Resolved-only hourly metrics and deduplicates ticket IDs", () => {
  const report = buildCecResolvedHourlyReport([
    snapshot("2026-07-28 10:00", [
      { ticket: "previous", agentName: "wb_previous", status: "Resolved" }
    ]),
    snapshot("2026-07-29 09:00", [
      { ticket: "1", agentName: "wb_alex Alex Silva", status: "Resolved" },
      { ticket: "2", agentName: "wb_alex", status: "Open" },
      { ticket: "3", agentName: "outside_team", status: "Resolved" }
    ]),
    snapshot("2026-07-29 10:00", [
      { ticket: "1", agentName: "wb_alex", status: "Resolved" },
      { ticket: "4", agentName: "wb_bia", status: "Resolved" }
    ])
  ], "2026-07-29");

  assert.equal(report.totalResolved, 2);
  assert.equal(report.hourlyResolved[9], 1);
  assert.equal(report.hourlyResolved[10], 1);
  assert.equal(report.lastHourResolved, 1);
  assert.equal(report.activeAgents, 2);
  assert.equal(report.previousTotalResolved, 1);
  assert.deepEqual(report.topDay.map((agent) => agent.name), ["wb_alex", "wb_bia"]);
  assert.equal(report.topDay[0].skill, "No skill");
});

test("renders the compact PNG report without the removed ranking area", async () => {
  const report = buildCecResolvedHourlyReport([
    snapshot("2026-07-29 10:00", [
      { ticket: "1", agentName: "wb_alex", status: "Resolved" }
    ])
  ], "2026-07-29");
  const image = renderCecResolvedKimReport(report);

  assert.equal(image.subarray(1, 4).toString(), "PNG");
  const rendered = await loadImage(image);
  assert.equal(rendered.width, 1200);
  assert.equal(rendered.height, 1900);
  assert.ok(image.length > 10_000);
  assert.ok(image.length < 2 * 1024 * 1024);
});

test("builds the Kim heading with cycle, generated time, and image", () => {
  const payload = buildCecKwaiTalkMarkdownPayload(
    { dateKey: "2026-07-30", updatedThroughHour: 11 },
    "https://storage.example/cec-report.png",
    new Date("2026-07-30T15:05:00.000Z")
  );

  assert.equal(payload.msgtype, "markdown");
  assert.match(payload.markdown.content, /CEC Resolved Report/);
  assert.match(payload.markdown.content, /Cycle:\*\* 2026-07-30 11:00/);
  assert.match(payload.markdown.content, /Generated:\*\* 30\/07\/2026, 12:05/);
  assert.match(payload.markdown.content, /!\[CEC Resolved Report\]\(https:\/\/storage\.example\/cec-report\.png\)/);
});

test("publishes the PNG and sends the Kim markdown card", async () => {
  const image = Buffer.from("real-report-image");
  let payload: Record<string, unknown> | null = null;
  let requestCount = 0;
  const fetcher: typeof fetch = async (_input, init) => {
    requestCount += 1;
    if (init?.method === "GET") {
      const publishedPng = Buffer.alloc(10_001);
      publishedPng.write("PNG", 1);
      return new Response(publishedPng, {
        status: 200,
        headers: { "Content-Type": "image/png" }
      });
    }
    payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ success: true, status: 200, errmsg: "" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
  const report = buildCecResolvedHourlyReport([
    snapshot("2026-07-30 11:00", [
      { ticket: "1", agentName: "wb_alex Alex Silva", status: "Resolved" }
    ])
  ], "2026-07-30");
  const publisher = async (publishedImage: Buffer) => {
    assert.equal(publishedImage, image);
    return "https://storage.example/cec-report.png";
  };

  const result = await sendCecResolvedReportToKim(
    image,
    report,
    "https://kim-robot.kwaitalk.com/api/robot/send?key=test-key",
    fetcher,
    publisher
  );

  assert.equal(result.success, true);
  assert.equal(requestCount, 2);
  const sentPayload = payload as Record<string, unknown> | null;
  assert.ok(sentPayload);
  assert.equal(sentPayload.msgtype, "markdown");
  assert.match(
    (sentPayload.markdown as { content: string }).content,
    /!\[CEC Resolved Report\]\(https:\/\/storage\.example\/cec-report\.png\)/
  );
});
