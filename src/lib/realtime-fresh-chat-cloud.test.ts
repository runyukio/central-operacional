import assert from "node:assert/strict";
import test from "node:test";

import {
  extractFreshChatExportUrl,
  fetchFreshChatExportFromFreshreports,
  freshChatCycleFromTimestamp
} from "./realtime-fresh-chat-cloud";

test("extrai o CSV de uma resposta aninhada do Freshreports", () => {
  const url = "https://s3.ap-southeast-2.amazonaws.com/freshreports-production-au-encrypt/application-data/advanced-schedules/8/52361/42687/total_chat_conversations_1784740573547.csv?signature=test";
  assert.equal(extractFreshChatExportUrl({ response: { export: { url } } }), url);
});

test("gera o ciclo de São Paulo a partir do timestamp do export", () => {
  assert.equal(freshChatCycleFromTimestamp(1_784_740_573_547), "2026-07-22 14:00");
});

test("segue a API URL cloud, baixa o CSV e monta o snapshot", async () => {
  const reportUrl = "https://tenant.freshchat.com/v2/analytics/export?id=schedule-id";
  const csvUrl = "https://s3.ap-southeast-2.amazonaws.com/freshreports-production-au-encrypt/application-data/advanced-schedules/8/52361/42687/total_chat_conversations_1784740573547.csv?signature=test";
  const requested: Array<{ url: string; authorization: string }> = [];
  const fetchImplementation = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    requested.push({ url, authorization: headers.get("authorization") ?? "" });
    if (url === reportUrl) {
      return new Response(JSON.stringify({ response: { url: csvUrl } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (url === csvUrl) {
      return new Response("Status\nassigned\nnew\nresolved\n", {
        status: 200,
        headers: {
          "content-type": "text/csv",
          "content-disposition": 'attachment; filename="total_chat_conversations_1784740573547.csv"'
        }
      });
    }
    return new Response("not found", { status: 404 });
  };

  const result = await fetchFreshChatExportFromFreshreports({
    reportUrl,
    apiToken: "freshchat-api-token",
    fetchImplementation,
    timeoutMs: 1_000
  });

  assert.deepEqual(requested, [
    { url: reportUrl, authorization: "Bearer freshchat-api-token" },
    { url: csvUrl, authorization: "" }
  ]);
  assert.equal(result.cycleDownload, "2026-07-22 14:00");
  assert.equal(result.fileName, "total_chat_conversations_1784740573547.csv");
  assert.equal(result.generatedDate, "2026-07-22T17:16:13.547Z");
  assert.equal(result.source, "fresh-chat-freshreports-cloud");
  assert.equal(result.rawText, "Status\nassigned\nnew\nresolved\n");
});

test("recusa uma API URL fora dos domínios oficiais", async () => {
  await assert.rejects(
    fetchFreshChatExportFromFreshreports({
      reportUrl: "https://example.com/latest.csv",
      fetchImplementation: async () => new Response(""),
      timeoutMs: 1_000
    }),
    /URL HTTPS oficial do Freshchat\/Freshreports/
  );
});

test("explica a configuração ausente quando o Freshchat exige token", async () => {
  await assert.rejects(
    fetchFreshChatExportFromFreshreports({
      reportUrl: "https://tenant.freshchat.com/v2/analytics/export?id=schedule-id",
      fetchImplementation: async () => new Response(
        JSON.stringify({ status: "UNAUTHORIZED", code: 401, message: "Please provide a valid token" }),
        { status: 401, headers: { "content-type": "application/json" } }
      ),
      timeoutMs: 1_000
    }),
    /configure FRESHCHAT_REPORT_API_TOKEN/
  );
});
