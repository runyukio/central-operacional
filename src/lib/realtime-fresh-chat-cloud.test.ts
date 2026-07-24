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
  const reportUrl = "https://freshchat-au.freshreports.com/api/public/latest-export?token=test";
  const csvUrl = "https://s3.ap-southeast-2.amazonaws.com/freshreports-production-au-encrypt/application-data/advanced-schedules/8/52361/42687/total_chat_conversations_1784740573547.csv?signature=test";
  const requested: string[] = [];
  const fetchImplementation = async (input: string | URL | Request) => {
    const url = String(input);
    requested.push(url);
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
    fetchImplementation,
    timeoutMs: 1_000
  });

  assert.deepEqual(requested, [reportUrl, csvUrl]);
  assert.equal(result.cycleDownload, "2026-07-22 14:00");
  assert.equal(result.fileName, "total_chat_conversations_1784740573547.csv");
  assert.equal(result.generatedDate, "2026-07-22T17:16:13.547Z");
  assert.equal(result.source, "fresh-chat-freshreports-cloud");
  assert.equal(result.rawText, "Status\nassigned\nnew\nresolved\n");
});

test("recusa uma API URL fora do Freshreports", async () => {
  await assert.rejects(
    fetchFreshChatExportFromFreshreports({
      reportUrl: "https://example.com/latest.csv",
      fetchImplementation: async () => new Response(""),
      timeoutMs: 1_000
    }),
    /URL HTTPS do Freshreports/
  );
});
