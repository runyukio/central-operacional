import assert from "node:assert/strict";
import test from "node:test";
import { interpretRealtimeHoursPresence, isRealtimeHoursLockScreen } from "./realtime-hours-presence";

const signal = (minute: number, process: string | null, sessionState = "ACTIVE", hostname = "PC-A") => ({
  capturedAt: new Date(Date.UTC(2026, 10, 4, 11, minute)), hostname,
  windowsUser: "agent", eventType: "HEARTBEAT", sessionState,
  activeProcessName: process, isSessionActive: sessionState === "ACTIVE"
});

test("recognizes exact lock/login executables including Windows paths", () => {
  for (const activeProcessName of ["lockapp", " LockApp.EXE ", "C:\\Windows\\SystemApps\\LockApp.exe", "LogonUI.exe"]) {
    assert.equal(isRealtimeHoursLockScreen({ activeProcessName }), true);
  }
  for (const activeProcessName of [null, "chrome", "explorer", "my-lockapp-tool"]) {
    assert.equal(isRealtimeHoursLockScreen({ activeProcessName }), false);
  }
});

test("replays false morning activity without changing original workstation evidence", () => {
  const records = [signal(25, null, "LOCKED"), signal(26, null), signal(28, "lockapp"), signal(33, "lockapp", "IDLE"), signal(37, "lockapp")];
  const before = structuredClone(records);
  const interpreted = interpretRealtimeHoursPresence(records);
  assert.ok(interpreted.every((record) => !record.isSessionActive && record.sessionState === "LOCKED"));
  assert.equal(interpreted.filter((record) => record.activityRejected).length, 3);
  assert.deepEqual(records, before);
});

test("normal application or explicit unlock releases the inferred lock", () => {
  const interpreted = interpretRealtimeHoursPresence([
    signal(0, "lockapp"), signal(1, null), signal(2, "chrome"), signal(3, null),
    signal(4, "lockapp"), { ...signal(5, null), eventType: "SESSION_RESUME" }
  ]);
  assert.deepEqual(interpreted.map((record) => record.isSessionActive), [false, false, true, true, false, true]);
});

test("preserves legacy blank-process records and isolates users and computers", () => {
  const interpreted = interpretRealtimeHoursPresence([
    signal(0, "lockapp"), signal(1, null, "ACTIVE", "PC-B"),
    { ...signal(2, null), windowsUser: "another-agent" }, signal(3, null)
  ]);
  assert.deepEqual(interpreted.map((record) => record.isSessionActive), [false, true, true, false]);
});

test("session end and disconnected signals override contradictory active flags", () => {
  const interpreted = interpretRealtimeHoursPresence([
    { ...signal(0, "chrome"), eventType: "SESSION_END" },
    { ...signal(1, "chrome", "DISCONNECTED"), isSessionActive: true }
  ]);
  assert.ok(interpreted.every((record) => !record.isSessionActive));
});
