import assert from "node:assert/strict";
import test from "node:test";

import {
  assertKwaiTalkAccepted,
  buildExecutiveReportDeliveryFileName,
  buildExecutiveReportStoragePath,
  buildKwaiTalkMarkdownPayload,
  expandExecutiveShiftRequirements,
  mergeExecutiveRequirements
} from "./ads-executive-webhook-service";

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

test("buildKwaiTalkMarkdownPayload identifica o report VIDEO", () => {
  const payload = buildKwaiTalkMarkdownPayload({
    lob: "VIDEO",
    imageUrl: "https://storage.example/video.png",
    selectedCycle: "2026-07-24 23:30",
    generatedAt: "2026-07-25T02:35:00.000Z"
  });

  assert.match(payload.markdown.content, /VIDEO Executive Report/);
  assert.match(payload.markdown.content, /!\[VIDEO Executive Report\]/);
});

test("buildKwaiTalkMarkdownPayload supports the ADS online productivity title", () => {
  const payload = buildKwaiTalkMarkdownPayload({
    lob: "ADS",
    reportTitle: "ADS Online Productivity",
    imageUrl: "https://storage.example/ads-online-productivity.png",
    selectedCycle: "2026-07-29 14:58",
    generatedAt: "2026-07-29T17:58:00.000Z"
  });

  assert.match(payload.markdown.content, /### ADS Online Productivity/);
  assert.match(payload.markdown.content, /!\[ADS Online Productivity\]/);
});

test("gera uma URL de imagem imutável por ciclo sem substituir o latest", () => {
  assert.equal(
    buildExecutiveReportStoragePath(
      "automation/video-executive/latest.png",
      "video_executive_2026-07-28-09-30.png"
    ),
    "automation/video-executive/video_executive_2026-07-28-09-30.png"
  );
});

test("gera um objeto exclusivo mesmo quando o mesmo ciclo é reenviado", () => {
  const first = buildExecutiveReportDeliveryFileName(
    "ads_online_productivity_2026-07-29-02-30.png",
    "delivery-a"
  );
  const second = buildExecutiveReportDeliveryFileName(
    "ads_online_productivity_2026-07-29-02-30.png",
    "delivery-b"
  );

  assert.equal(first, "ads_online_productivity_2026-07-29-02-30_delivery-a.png");
  assert.equal(second, "ads_online_productivity_2026-07-29-02-30_delivery-b.png");
  assert.notEqual(first, second);
});

test("expande o Required HC por turno para todas as horas do ADS", () => {
  const requirements = expandExecutiveShiftRequirements([
    { requiredStaff: 11, shift: { name: "Manhã" } },
    { requiredStaff: 12, shift: { name: "Tarde" } },
    { requiredStaff: 9, shift: { name: "Noite" } }
  ]);

  assert.equal(requirements.length, 24);
  assert.deepEqual(requirements.slice(0, 7), [
    { hour: 0, required: 9 },
    { hour: 1, required: 9 },
    { hour: 2, required: 9 },
    { hour: 3, required: 9 },
    { hour: 4, required: 9 },
    { hour: 5, required: 9 },
    { hour: 6, required: 11 }
  ]);
  assert.deepEqual(requirements.at(-1), { hour: 23, required: 9 });
});

test("mantém o Required HC horário importado e usa o turno somente como fallback", () => {
  const requirements = mergeExecutiveRequirements(
    [{ hour: 6, required: 15 }, { hour: 7, required: 14 }],
    [{ hour: 6, required: 11 }, { hour: 7, required: 11 }, { hour: 8, required: 11 }]
  );

  assert.deepEqual(requirements, [
    { hour: 6, required: 15 },
    { hour: 7, required: 14 },
    { hour: 8, required: 11 }
  ]);
});
