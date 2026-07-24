const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildFreshChatPayload,
  currentCycleFromTimestamp,
  findLatestFreshChatExport
} = require("./upload-freshchat-backlog");

test("seleciona o export Freshchat pelo maior timestamp do nome", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "freshchat-export-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, "total_chat_conversations_1784718663624.csv"), "Status\nassigned\n");
  fs.writeFileSync(path.join(directory, "total_chat_conversations_1784740573547.csv"), "Status\nassigned\nnew\n");
  fs.writeFileSync(path.join(directory, "arquivo-ignorado.csv"), "Status\nnew\n");

  const latest = findLatestFreshChatExport(directory);

  assert.equal(path.basename(latest.filePath), "total_chat_conversations_1784740573547.csv");
  assert.equal(latest.generatedAtMs, 1_784_740_573_547);
});

test("gera ciclo e data da fonte a partir do timestamp do arquivo", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "freshchat-payload-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "total_chat_conversations_1784740573547.csv");
  fs.writeFileSync(filePath, "Status\nassigned\nnew\n");

  const payload = buildFreshChatPayload(filePath, 1_784_740_573_547);

  assert.equal(currentCycleFromTimestamp(1_784_740_573_547), "2026-07-22 14:00");
  assert.equal(payload.cycleDownload, "2026-07-22 14:00");
  assert.equal(payload.generatedDate, "2026-07-22T17:16:13.547Z");
  assert.equal(payload.rawText, "Status\nassigned\nnew\n");
});
