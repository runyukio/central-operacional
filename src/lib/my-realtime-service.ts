import { Prisma } from "@prisma/client";

import type { Actor } from "@/lib/mock-db";
import { prisma } from "@/lib/prisma";
import { getRealtimeHoursTimeline } from "@/lib/realtime-hours-service";
import { canAccessOwnRealtimeHours } from "@/lib/realtime-hours-permissions";
import { addDateKeyDays, saoPauloDateKey } from "@/lib/realtime-hours-timeline";
import { allocateCapturedHours, canonicalPersonalCapture } from "@/lib/personal-capture-hours";
import {
  calculatePersonalModerationWithOvertime, normalizePersonalName, normalizePersonalWb, personalCecCpd,
  personalCycleTime, personalHourlyIntervals, personalObservationStart, resolvePersonalShift,
  type MyRealtimePayload, type PersonalInterval, type PersonalReading, type PersonalShift
} from "@/lib/my-realtime";

const employeeSelect = {
  id: true, fullName: true, wbLogin: true, lob: { select: { name: true } }, user: { select: { email: true } }
} satisfies Prisma.EmployeeProfileSelect;

export const myRealtimeData = { timeline: getRealtimeHoursTimeline };

function cycleLabel(at: string) {
  return new Date(Date.parse(at) - 3 * 3_600_000).toISOString().slice(0, 16).replace("T", " ");
}

async function readModeration(employee: { id: string; wbLogin: string }, shift: PersonalShift) {
  // Pick the latest successful import for each global cycle BEFORE joining the
  // person, so a missing agent cannot silently reuse an older import's numbers.
  const readings = await prisma.$queryRaw<PersonalReading[]>(Prisma.sql`
    WITH cycles AS (
      SELECT DISTINCT a."cycleDownload", b.id, b."importedAt"
      FROM "RealTimeAgentCycleSummary" a JOIN "RealTimeImportBatch" b ON b.id = a."batchId"
      WHERE b.status = 'SUCCESS' AND a."cycleDownload" >= ${cycleLabel(shift.observedFrom ?? shift.start)}
        AND a."cycleDownload" <= ${cycleLabel(shift.observedUntil)}
    ), chosen AS (
      SELECT DISTINCT ON ("cycleDownload") * FROM cycles ORDER BY "cycleDownload", "importedAt" DESC, id DESC
    )
    SELECT c."cycleDownload", c."importedAt",
      CASE WHEN COUNT(a.id) = 1 THEN MAX(a.submit) END AS submit,
      CASE WHEN COUNT(a.id) = 1 THEN MAX(a."moderationMs") END AS "moderationMs",
      CASE WHEN COUNT(a.id) = 1 THEN MAX(a.refresh) END AS refresh,
      CASE WHEN COUNT(a.id) = 1 THEN MAX(a.timeout) END AS timeout
    FROM chosen c LEFT JOIN "RealTimeAgentCycleSummary" a ON a."batchId" = c.id AND a."cycleDownload" = c."cycleDownload"
      AND a."wbLoginNormalized" = ${normalizePersonalWb(employee.wbLogin)}
      AND (a."employeeId" IS NULL OR a."employeeId" = ${employee.id})
    GROUP BY c."cycleDownload", c."importedAt" ORDER BY c."cycleDownload"
  `);
  return calculatePersonalModerationWithOvertime(shift, readings.map((reading) => ({ ...reading,
    importedAt: new Date(reading.importedAt).toISOString() })));
}

async function readCec(employee: { fullName: string }, shift: PersonalShift) {
  const [snapshots, profiles] = await Promise.all([
    prisma.$queryRaw<Array<{ cycleDownload: string; importedAt: Date; rawData: Prisma.JsonValue }>>(Prisma.sql`
      SELECT "cycleDownload", "importedAt",
        CASE WHEN jsonb_typeof("rawData"->'agents') = 'array' THEN jsonb_build_object('agents', "rawData"->'agents')
          ELSE jsonb_build_object('tickets', "rawData"->'tickets') END AS "rawData"
      FROM "RealTimeCecSnapshot" WHERE source = 'freshdesk-cec-cpd-hourly'
        AND "cycleDownload" >= ${cycleLabel(shift.observedFrom ?? shift.start)} AND "cycleDownload" <= ${cycleLabel(shift.observedUntil)}
      ORDER BY "cycleDownload" ASC
    `),
    prisma.employeeProfile.findMany({ select: { fullName: true } })
  ]);
  const name = normalizePersonalName(employee.fullName);
  const matchingProfiles = profiles.filter((profile) => normalizePersonalName(profile.fullName) === name).length;
  let previousEnd = shift.observedFrom ?? shift.start;
  const intervals: PersonalInterval[] = [];
  for (const snapshot of snapshots) {
    const at = personalCycleTime(snapshot.cycleDownload);
    if (!Number.isFinite(at) || at < Date.parse(shift.observedFrom ?? shift.start) || at > Date.parse(shift.observedUntil)) continue;
    const end = new Date(at).toISOString();
    const cpd = personalCecCpd(snapshot.rawData, employee.fullName, matchingProfiles);
    intervals.push({ start: previousEnd, end, cycle: snapshot.cycleDownload, metrics: null, cpd,
      status: cpd === null ? "unavailable" : "complete", capturedMs: null });
    previousEnd = end;
  }
  const last = intervals[intervals.length - 1];
  const snapshot = snapshots.find((item) => item.cycleDownload === last?.cycle);
  return {
    start: personalObservationStart(shift, intervals),
    intervals,
    productivity: {
      status: last?.status ?? "unavailable" as const, metrics: null, cpd: last?.cpd ?? null,
      lastCycle: last?.cycle ?? null, importedAt: snapshot?.importedAt.toISOString() ?? null,
      ...(matchingProfiles !== 1 ? { message: "Não foi possível identificar seu nome de forma inequívoca na fonte CEC. Peça ao supervisor para conferir o vínculo." } : {})
    }
  };
}

export async function getMyRealtime(actor: Actor, now = new Date()): Promise<MyRealtimePayload | { error: string; status: number }> {
  if (!actor.email) return { error: "Entre novamente para consultar seu Real Time.", status: 401 };
  if (!canAccessOwnRealtimeHours({ ...actor, status: "ACTIVE" })) return { error: "Você não tem permissão para consultar seu Real Time.", status: 403 };
  const email = actor.email.trim().toLowerCase();
  // A linked account takes precedence. The legacy WB fallback applies only to
  // profiles without a linked user, never a profile linked to another account.
  const candidates = await prisma.employeeProfile.findMany({ where: { deletedAt: null, OR: [
    { user: { email: { equals: email, mode: "insensitive" } } },
    { userId: null, wbLogin: { equals: email.split("@")[0], mode: "insensitive" } }
  ] }, select: employeeSelect });
  const linked = candidates.filter((profile) => profile.user?.email?.trim().toLowerCase() === email);
  const matches = linked.length ? linked : candidates;
  if (matches.length !== 1) return { error: "Não foi possível identificar seu cadastro de forma inequívoca. Peça ao supervisor para conferir seu vínculo.", status: 404 };
  const employee = matches[0];
  const lob = employee.lob.name.trim().toUpperCase();
  if (!["ADS", "VIDEO", "VÍDEO", "TNS", "CEC"].includes(lob)) return { error: "Meu Real Time está disponível para ADS, Vídeo e CEC.", status: 403 };
  const today = saoPauloDateKey(now);
  const schedules = await prisma.schedule.findMany({ where: { employeeId: employee.id, deletedAt: null,
    // Adjacent days also delimit overtime across midnight and prevent sharing
    // production between a previous shift's extension and the next one's start.
    date: { in: [-2, -1, 0, 1, 2].map((offset) => new Date(`${addDateKeyDays(today, offset)}T00:00:00Z`)) } },
    select: { id: true, employeeId: true, date: true, startsAt: true, endsAt: true, status: true,
      shift: { select: { name: true, startsAt: true, endsAt: true } } }
  });
  const resolution = resolvePersonalShift(schedules, now);
  const payload: MyRealtimePayload = {
    success: true, queriedAt: now.toISOString(), employee: { fullName: employee.fullName, wbLogin: employee.wbLogin, lob: employee.lob.name },
    kind: lob === "CEC" ? "cec" : "moderation", ...resolution,
    productivity: { status: "unavailable", metrics: null, cpd: null, lastCycle: null, importedAt: null },
    capture: { status: "unavailable", capturedMs: null, lastSeenAt: null }, intervals: []
  };
  const shift = resolution.shift;
  if (!shift) return payload;
  const [production, capture] = await Promise.allSettled([
    lob === "CEC" ? readCec(employee, shift) : readModeration(employee, shift),
    myRealtimeData.timeline({ date: shift.date, employeeId: employee.id, wbLogin: employee.wbLogin })
  ]);
  const observedShift = { ...shift, start: production.status === "fulfilled" ? production.value.start
    : new Date(Math.min(Date.parse(shift.start), now.getTime())).toISOString() };
  if (production.status === "fulfilled") {
    payload.productivity = production.value.productivity;
    const hourly = personalHourlyIntervals(observedShift, production.value.intervals, payload.kind);
    payload.intervals = hourly.intervals;
    if (hourly.unallocated) payload.productivity.message = "Trechos observados sem leitura na virada da hora entram no total do Shift Date, sem rateio entre horas.";
  } else {
    console.error("[my-realtime] Falha na leitura de produtividade", production.reason);
    payload.productivity.message = "Não foi possível consultar a produtividade. Tente atualizar novamente.";
    payload.intervals = personalHourlyIntervals(observedShift, [], payload.kind).intervals;
  }
  if (capture.status === "fulfilled") {
    const canonical = canonicalPersonalCapture(capture.value.rows, employee, shift.date, { start: observedShift.start, end: shift.observedUntil });
    payload.capture = canonical.summary;
    // Production and capture include anticipation/overtime assigned to the same
    // Shift Date; retain Captura's exact scalar and hourly reconciliation.
    const hourly = personalHourlyIntervals({ ...shift, start: canonical.start, observedUntil: canonical.end },
      production.status === "fulfilled" ? production.value.intervals : [], payload.kind);
    const allocated = allocateCapturedHours(canonical.rows, hourly.intervals);
    payload.intervals = allocated.intervals.map((interval) => ({ ...interval,
      captureOnly: !interval.metrics && interval.cpd === null
        && (Date.parse(interval.end) <= Date.parse(shift.start) || Date.parse(interval.start) >= Date.parse(shift.end)) }));
    if (!allocated.complete) payload.capture.message = "Total da Captura de Horas disponível; o detalhamento por hora não pôde ser conciliado com os segmentos desta leitura.";
  } else {
    console.error("[my-realtime] Falha na leitura de captura", capture.reason);
    payload.capture.message = "Não foi possível consultar a captura. Tente atualizar novamente.";
  }
  return payload;
}
