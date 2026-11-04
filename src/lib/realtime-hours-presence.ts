type PresenceSignal = {
  capturedAt: Date;
  hostname: string;
  windowsUser?: string | null;
  eventType?: string | null;
  sessionState?: string | null;
  activeProcessName?: string | null;
  isSessionActive: boolean;
};

export function isRealtimeHoursLockScreen(record: Pick<PresenceSignal, "sessionState" | "activeProcessName">) {
  const process = String(record.activeProcessName ?? "").trim().toLowerCase().split(/[\\/]/).pop()?.replace(/\.exe$/, "");
  return String(record.sessionState ?? "").trim().toUpperCase() === "LOCKED"
    || process === "lockapp" || process === "logonui";
}

/** Interpret copies only: the original workstation evidence must remain intact. */
export function interpretRealtimeHoursPresence<T extends PresenceSignal>(records: T[]) {
  const lockedDevices = new Set<string>();
  return [...records].sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime()).map((record) => {
    const key = `${record.hostname.trim().toLowerCase()}::${String(record.windowsUser ?? "").trim().toLowerCase()}`;
    const process = String(record.activeProcessName ?? "").trim();
    const event = String(record.eventType ?? "").toUpperCase();
    if (isRealtimeHoursLockScreen(record)) lockedDevices.add(key);
    else if (process || event === "SESSION_START" || event === "SESSION_RESUME") lockedDevices.delete(key);

    // A blank heartbeat cannot prove that a previously observed lock was released.
    const locked = lockedDevices.has(key);
    const stopped = event === "SESSION_END" || String(record.sessionState ?? "").toUpperCase() === "DISCONNECTED";
    return {
      ...record,
      isSessionActive: record.isSessionActive && !locked && !stopped,
      sessionState: locked ? "LOCKED" : record.sessionState,
      activityRejected: record.isSessionActive && (locked || stopped)
    };
  });
}
