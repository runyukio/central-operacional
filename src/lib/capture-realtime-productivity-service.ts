import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  calculateCaptureProductivity, captureProductivityWindow, normalizeProductivityWb,
  type CaptureProductivitySlot, type CaptureProductivityReading
} from "@/lib/capture-realtime-productivity";

export async function readCaptureRealtimeProductivity(slots: CaptureProductivitySlot[]) {
  const cycle = (at: number) => new Date(at).toISOString().slice(0, 16).replace("T", " ");
  const windows = slots.flatMap((slot) => { const window = captureProductivityWindow(slot); return window ? [window] : []; });
  let readings: CaptureProductivityReading[] = [];
  if (windows.length) {
    const start = cycle(Math.min(...windows.map((window) => window.start)));
    const end = cycle(Math.max(...windows.map((window) => window.end)));
    const wbs = [...new Set(slots.map((slot) => normalizeProductivityWb(slot.wbLogin)))];
    readings = await prisma.$queryRaw<CaptureProductivityReading[]>(Prisma.sql`
      WITH candidates AS (
        SELECT DISTINCT a."cycleDownload", b.id, b."importedAt"
        FROM "RealTimeAgentCycleSummary" a
        JOIN "RealTimeImportBatch" b ON b.id = a."batchId"
        WHERE b.status = 'SUCCESS' AND a."cycleDownload" >= ${start} AND a."cycleDownload" <= ${end}
          AND a."cycleDownload" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}$'
      ), chosen AS (
        SELECT DISTINCT ON ("cycleDownload") * FROM candidates
        ORDER BY "cycleDownload", "importedAt" DESC, id DESC
      )
      SELECT c."cycleDownload", a."wbLoginNormalized", a.submit, a."moderationMs"
      FROM chosen c
      LEFT JOIN "RealTimeAgentCycleSummary" a ON a."batchId" = c.id AND a."cycleDownload" = c."cycleDownload"
        AND a."wbLoginNormalized" IN (${Prisma.join(wbs)})
      ORDER BY c."cycleDownload", a."wbLoginNormalized"
    `);
  }
  const byCycle = new Map<string, Map<string, CaptureProductivityReading>>();
  for (const reading of readings) {
    if (!byCycle.has(reading.cycleDownload)) byCycle.set(reading.cycleDownload, new Map());
    if (reading.wbLoginNormalized) byCycle.get(reading.cycleDownload)!.set(reading.wbLoginNormalized, reading);
  }
  const cycles = [...byCycle.keys()].sort();
  return new Map(slots.map((slot) => {
    const window = captureProductivityWindow(slot);
    const wb = normalizeProductivityWb(slot.wbLogin);
    const start = window ? cycle(window.start) : "";
    const end = window ? cycle(window.end) : "";
    const points = window ? cycles.filter((value) => value >= start && value <= end).map((value) =>
      byCycle.get(value)!.get(wb) ?? { cycleDownload: value, wbLoginNormalized: null, submit: null, moderationMs: null }) : [];
    return [slot.id, calculateCaptureProductivity(slot, points)];
  }));
}
