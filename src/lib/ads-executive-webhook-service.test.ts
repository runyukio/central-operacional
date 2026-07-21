import assert from "node:assert/strict";
import test from "node:test";

import { assertKwaiTalkAccepted, buildKwaiTalkMarkdownPayload } from "./ads-executive-webhook-service";

test("buildKwaiTalkMarkdownPayload builds the Kim markdown contract", () => {
  const payload = buildKwaiTalkMarkdownPayload({
    imageUrl: "https://storage.example/report.png?v=2026-07-21-10-00",
    selectedCycle: "2026-07-21 10:00",
    generatedAt: "2026-07-21T13:05:00.000Z"
  });

  assert.equal(payload.msgtype, "markdown");
  assert.match(payload.markdown.content, /ADS Executive Report/);
  assert.match(payload.markdown.content, /2026-07-21 10:00/);
  assert.match(payload.markdown.content, /21\/07\/2026/);
  assert.match(payload.markdown.content, /!\[ADS Executive Report\]\(https:\/\/storage\.example\/report\.png/);
});

test("assertKwaiTalkAccepted accepts successful Kim response variants", () => {
  assert.doesNotThrow(() => assertKwaiTalkAccepted('{"code":200,"message":"success"}'));
  assert.doesNotThrow(() => assertKwaiTalkAccepted('{"code":0,"message":"success"}'));
  assert.doesNotThrow(() => assertKwaiTalkAccepted('{"result":"ok"}'));
  assert.doesNotThrow(() => assertKwaiTalkAccepted("ok"));
  assert.throws(
    () => assertKwaiTalkAccepted('{"code":400,"message":"invalid markdown"}'),
    /KwaiTalk rejeitou a mensagem: invalid markdown/
  );
  assert.throws(() => assertKwaiTalkAccepted('{"success":false,"message":"invalid markdown"}'), /invalid markdown/);
});
