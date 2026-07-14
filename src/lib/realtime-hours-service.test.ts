import assert from "node:assert/strict";
import test from "node:test";

import { buildMergedTimelineSegments, buildTimelineSegments, realtimeHoursTimelinePersonKey } from "./realtime-hours-service";

const minute = 60_000;

function point(at: string, isSessionActive: boolean, eventType: string | null = "HEARTBEAT", idleSeconds = 0) {
  return {
    capturedAt: new Date(at),
    eventType,
    lastActivityAt: null,
    isSessionActive,
    idleSeconds
  };
}

function activeDuration(segments: ReturnType<typeof buildTimelineSegments>) {
  return segments
    .filter((segment) => segment.type === "ACTIVE")
    .reduce((total, segment) => total + segment.durationMs, 0);
}

test("limita o ultimo heartbeat ativo a dois minutos", () => {
  const segments = buildTimelineSegments(
    [point("2026-07-11T13:00:00.000Z", true)],
    new Date("2026-07-11T13:00:00.000Z"),
    new Date("2026-07-11T13:10:00.000Z")
  );

  assert.equal(activeDuration(segments), 2 * minute);
});

test("nao contabiliza uma queda de quatorze minutos como atividade", () => {
  const segments = buildTimelineSegments(
    [
      point("2026-07-11T13:00:00.000Z", true),
      point("2026-07-11T13:14:00.000Z", true, "SESSION_START")
    ],
    new Date("2026-07-11T13:00:00.000Z"),
    new Date("2026-07-11T13:20:00.000Z")
  );

  assert.equal(activeDuration(segments), 4 * minute);
});

test("SESSION_END encerra a atividade no horario exato", () => {
  const segments = buildTimelineSegments(
    [
      point("2026-07-11T13:00:00.000Z", true, "SESSION_START"),
      point("2026-07-11T13:01:00.000Z", false, "SESSION_END")
    ],
    new Date("2026-07-11T13:00:00.000Z"),
    new Date("2026-07-11T13:10:00.000Z")
  );

  assert.equal(activeDuration(segments), minute);
});

test("SESSION_END prevalece sobre heartbeat no mesmo instante", () => {
  const segments = buildTimelineSegments(
    [
      point("2026-07-11T13:00:00.000Z", false, "SESSION_END"),
      point("2026-07-11T13:00:00.000Z", true, "HEARTBEAT")
    ],
    new Date("2026-07-11T13:00:00.000Z"),
    new Date("2026-07-11T13:10:00.000Z")
  );

  assert.equal(activeDuration(segments), 0);
});

test("nao contabiliza o intervalo em que a tela ficou bloqueada", () => {
  const segments = buildTimelineSegments(
    [
      point("2026-07-11T13:00:00.000Z", true, "SESSION_START"),
      point("2026-07-11T13:01:00.000Z", true),
      point("2026-07-11T13:02:00.000Z", true),
      point("2026-07-11T13:03:00.000Z", true),
      point("2026-07-11T13:04:00.000Z", true),
      point("2026-07-11T13:05:00.000Z", false, "SESSION_END"),
      point("2026-07-11T13:10:00.000Z", true, "SESSION_RESUME"),
      point("2026-07-11T13:11:00.000Z", true),
      point("2026-07-11T13:12:00.000Z", false, "SESSION_END")
    ],
    new Date("2026-07-11T13:00:00.000Z"),
    new Date("2026-07-11T13:15:00.000Z")
  );

  assert.equal(activeDuration(segments), 7 * minute);
});

test("ociosidade de teclado continua contabilizada enquanto a tela esta desbloqueada", () => {
  const segments = buildTimelineSegments(
    [
      point("2026-07-11T13:00:00.000Z", true, "HEARTBEAT", 3_600),
      point("2026-07-11T13:01:00.000Z", false, "SESSION_END", 3_660)
    ],
    new Date("2026-07-11T13:00:00.000Z"),
    new Date("2026-07-11T13:05:00.000Z")
  );

  assert.equal(activeDuration(segments), minute);
});

test("une atividade do mesmo colaborador em notebooks diferentes sem duplicar sobreposicao", () => {
  const segments = buildMergedTimelineSegments(
    [
      { ...point("2026-07-13T09:00:00.000Z", true), hostname: "NOTEBOOK-A", windowsUser: "rita" },
      { ...point("2026-07-13T09:02:00.000Z", false, "SESSION_END"), hostname: "NOTEBOOK-A", windowsUser: "rita" },
      { ...point("2026-07-13T09:01:00.000Z", true), hostname: "NOTEBOOK-B", windowsUser: "rita" },
      { ...point("2026-07-13T09:03:00.000Z", false, "SESSION_END"), hostname: "NOTEBOOK-B", windowsUser: "rita" }
    ],
    new Date("2026-07-13T09:00:00.000Z"),
    new Date("2026-07-13T09:05:00.000Z")
  );

  assert.equal(activeDuration(segments), 3 * minute);
  assert.equal(segments.filter((segment) => segment.type === "ACTIVE").length, 1);
});

test("fim de sessao no notebook antigo nao encerra atividade no notebook novo", () => {
  const segments = buildMergedTimelineSegments(
    [
      { ...point("2026-07-13T09:00:00.000Z", true), hostname: "NOTEBOOK-A", windowsUser: "rita" },
      { ...point("2026-07-13T09:01:00.000Z", false, "SESSION_END"), hostname: "NOTEBOOK-A", windowsUser: "rita" },
      { ...point("2026-07-13T09:00:00.000Z", true), hostname: "NOTEBOOK-B", windowsUser: "rita" },
      { ...point("2026-07-13T09:02:00.000Z", false, "SESSION_END"), hostname: "NOTEBOOK-B", windowsUser: "rita" }
    ],
    new Date("2026-07-13T09:00:00.000Z"),
    new Date("2026-07-13T09:04:00.000Z")
  );

  assert.equal(activeDuration(segments), 2 * minute);
});

test("usa o mesmo agrupamento quando o WB troca de notebook", () => {
  const first = realtimeHoursTimelinePersonKey({ wbLogin: "WB_RITA06", hostname: "EASTRIVER004760", windowsUser: "rita" });
  const second = realtimeHoursTimelinePersonKey({ wbLogin: "wb_rita06", hostname: "EASTRIVER007377", windowsUser: "rita" });

  assert.equal(first, second);
  assert.equal(first, "wb:wb_rita06");
});
