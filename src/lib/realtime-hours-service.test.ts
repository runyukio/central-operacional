import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMergedTimelineSegments,
  buildTimelineSegments,
  realtimeHoursTimelinePersonKey,
  resolveRealtimeHoursPresenceStatus,
  selectRealtimeHoursPresenceRecord
} from "./realtime-hours-service";

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

test("ociosidade de ate quinze minutos continua contabilizada como atividade", () => {
  const segments = buildTimelineSegments(
    [
      point("2026-07-11T13:00:00.000Z", true, "HEARTBEAT", 900),
      point("2026-07-11T13:01:00.000Z", false, "SESSION_END", 960)
    ],
    new Date("2026-07-11T13:00:00.000Z"),
    new Date("2026-07-11T13:05:00.000Z")
  );

  assert.equal(activeDuration(segments), minute);
});

test("ociosidade acima de quinze minutos nao contabiliza atividade", () => {
  const segments = buildTimelineSegments(
    [
      point("2026-07-11T13:00:00.000Z", true, "HEARTBEAT", 901),
      point("2026-07-11T13:01:00.000Z", false, "SESSION_END", 961)
    ],
    new Date("2026-07-11T13:00:00.000Z"),
    new Date("2026-07-11T13:05:00.000Z")
  );

  assert.equal(activeDuration(segments), 0);
});

test("une atividade do mesmo parceiro em notebooks diferentes sem duplicar sobreposicao", () => {
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

test("considera ocioso somente acima de dez minutos sem movimento", () => {
  const capturedAt = new Date("2026-07-19T12:00:00.000Z");
  const base = { capturedAt, isSessionActive: true, sessionState: "ACTIVE", idleSeconds: 600 };

  assert.equal(resolveRealtimeHoursPresenceStatus(base, capturedAt, 600), "ONLINE");
  assert.equal(resolveRealtimeHoursPresenceStatus({ ...base, idleSeconds: 601 }, capturedAt, 600), "IDLE");
});

test("prioriza tela bloqueada sobre o tempo sem movimento", () => {
  const capturedAt = new Date("2026-07-19T12:00:00.000Z");
  const status = resolveRealtimeHoursPresenceStatus({
    capturedAt,
    isSessionActive: false,
    sessionState: "LOCKED",
    idleSeconds: 3_600
  }, capturedAt, 600);

  assert.equal(status, "LOCKED");
});

test("consolida multiplas maquinas priorizando uma sessao realmente online", () => {
  const referenceTime = new Date("2026-07-19T12:10:00.000Z");
  const locked = {
    capturedAt: new Date("2026-07-19T12:10:00.000Z"),
    isSessionActive: false,
    sessionState: "LOCKED",
    idleSeconds: 0,
    hostname: "NOTEBOOK-ANTIGO"
  };
  const online = {
    capturedAt: new Date("2026-07-19T12:09:00.000Z"),
    isSessionActive: true,
    sessionState: "ACTIVE",
    idleSeconds: 20,
    hostname: "NOTEBOOK-ATUAL"
  };

  assert.equal(selectRealtimeHoursPresenceRecord([locked, online], referenceTime, 600)?.hostname, "NOTEBOOK-ATUAL");
});

test("usa o registro mais recente quando as maquinas possuem o mesmo status", () => {
  const referenceTime = new Date("2026-07-19T12:10:00.000Z");
  const older = {
    capturedAt: new Date("2026-07-19T12:08:00.000Z"),
    isSessionActive: true,
    sessionState: "ACTIVE",
    idleSeconds: 0,
    hostname: "NOTEBOOK-A"
  };
  const newer = { ...older, capturedAt: new Date("2026-07-19T12:10:00.000Z"), hostname: "NOTEBOOK-B" };

  assert.equal(selectRealtimeHoursPresenceRecord([older, newer], referenceTime, 600)?.hostname, "NOTEBOOK-B");
});
