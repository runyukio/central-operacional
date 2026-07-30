import assert from "node:assert/strict";
import test from "node:test";

import { loadImage } from "@napi-rs/canvas";

import {
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
      { ticket: "1", agentName: "wb_alex", status: "Resolved" },
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
});

test("renders the compact report without the removed ranking area", async () => {
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

test("uploads the PNG and sends the returned Kim media ID", async () => {
  const image = Buffer.from("real-report-image");
  let payload: Record<string, unknown> | null = null;
  let requestCount = 0;
  const fetcher: typeof fetch = async (input, init) => {
    requestCount += 1;
    if (String(input).includes("/api/robot/upload")) {
      assert.ok(init?.body instanceof FormData);
      return new Response(JSON.stringify({ type: "image", media_id: "ks://report.png/7" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ success: true, status: 200, errmsg: "" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  const result = await sendCecResolvedReportToKim(
    image,
    "https://kim-robot.kwaitalk.com/api/robot/send?key=test-key",
    fetcher
  );

  assert.equal(result.success, true);
  assert.equal(requestCount, 2);
  const sentPayload = payload as Record<string, unknown> | null;
  assert.ok(sentPayload);
  assert.equal(sentPayload.msgtype, "image");
  assert.equal((sentPayload.image as { media_id: string }).media_id, "ks://report.png/7");
});
