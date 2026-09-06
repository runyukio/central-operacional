import { Prisma } from "@prisma/client";

import { buildCecHourlyCpd, normalizeCecTicket, type CecAgentCpd } from "@/lib/realtime-cec-cpd";
import type { Actor } from "@/lib/mock-db";
import { canAccessRealTime } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { fetchRealtimeCecFromFreshdesk, getCurrentCecCycle } from "@/lib/realtime-cec-freshdesk";

const cecRetentionDays = Number.parseInt(process.env.REALTIME_RETENTION_DAYS ?? "3", 10) || 3;
const saoPauloTimeZone = "America/Sao_Paulo";
const cecCpdSource = "freshdesk-cec-cpd-hourly";

export type RealtimeCecGroupInput = {
  key: string;
  label: string;
  backlog: number;
  onHold: number;
  open: number;
  new: number;
};

export type RealtimeCecDepartmentInput = {
  name: string;
  group: string;
  backlog: number;
  percent: number | null;
};

export type RealtimeCecTicketInput = {
  ticket: string;
  agentName: string;
  status: string;
  groupId?: string | null;
  groupName?: string | null;
};

export type RealtimeCecImportInput = {
  cycleDownload: string;
  fileName: string;
  source?: string;
  generatedDate?: string | null;
  groups?: RealtimeCecGroupInput[];
  departments?: RealtimeCecDepartmentInput[];
  tickets?: RealtimeCecTicketInput[];
  rawText?: string;
};

type RealtimeCecSnapshotRecord = Awaited<ReturnType<typeof prisma.realTimeCecSnapshot.findFirst>>;

type RealtimeCecRawData = {
  source?: string;
  fileName?: string;
  cycleDownload?: string;
  generatedDate?: string | null;
  agents?: CecAgentCpd[];
  tickets?: RealtimeCecTicketInput[];
  rawText?: string;
};

function realtimeCecRetentionCutoff() {
  return new Date(Date.now() - cecRetentionDays * 24 * 60 * 60 * 1000);
}

function normalizedTickets(input: RealtimeCecTicketInput[] | undefined) {
  return (input || [])
    .map((ticket) => normalizeCecTicket({
      ...ticket,
      groupId: ticket.groupId ? String(ticket.groupId).trim() : null,
      groupName: ticket.groupName ? String(ticket.groupName).trim() : null
    }))
    .filter((ticket) => Boolean(ticket.ticket));
}

function buildRawData(input: RealtimeCecImportInput, agents: CecAgentCpd[], tickets: RealtimeCecTicketInput[]) {
  return {
    source: input.source || cecCpdSource,
    fileName: input.fileName,
    cycleDownload: input.cycleDownload,
    generatedDate: input.generatedDate || null,
    agents,
    tickets,
    rawText: input.rawText || ""
  };
}

async function pruneRealtimeCecHistory(currentId?: string) {
  try {
    await prisma.realTimeCecSnapshot.deleteMany({
      where: {
        importedAt: { lt: realtimeCecRetentionCutoff() },
        ...(currentId ? { id: { not: currentId } } : {})
      }
    });
  } catch (error) {
    console.warn("[realtime/cec] Não foi possível limpar histórico antigo.", error);
  }
}

export async function importRealtimeCecSnapshot(input: RealtimeCecImportInput) {
  const cycleDownload = input.cycleDownload.trim();
  const fileName = input.fileName.trim() || "cec_cpd_hourly.csv";
  const source = input.source?.trim() || cecCpdSource;
  const tickets = normalizedTickets(input.tickets);
  const cpd = buildCecHourlyCpd(tickets);

  if (!cycleDownload) return { error: "cycleDownload é obrigatório para importar CEC.", status: 400 };
  if (!tickets.length) return { error: "O snapshot CEC não possui Ticket IDs válidos.", status: 400 };

  const rawData = buildRawData(input, cpd.agents, cpd.tickets as RealtimeCecTicketInput[]);
  const legacySummary = {
    totalBacklog: cpd.totalCpd,
    normalBacklog: cpd.totalCpd,
    p0Backlog: 0,
    p0L2Backlog: 0,
    onHoldCount: 0,
    openCount: 0,
    newCount: 0
  };

  const snapshot = await prisma.realTimeCecSnapshot.upsert({
    where: { cycleDownload },
    create: {
      cycleDownload,
      fileName,
      source,
      generatedDate: input.generatedDate || null,
      ...legacySummary,
      rawData: rawData as Prisma.InputJsonValue
    },
    update: {
      fileName,
      source,
      generatedDate: input.generatedDate || null,
      ...legacySummary,
      rawData: rawData as Prisma.InputJsonValue,
      importedAt: new Date()
    }
  });

  await pruneRealtimeCecHistory(snapshot.id);

  return {
    success: true,
    snapshotId: snapshot.id,
    cycleDownload: snapshot.cycleDownload,
    fileName: snapshot.fileName,
    totalCpd: cpd.totalCpd,
    activeAgents: cpd.activeAgents,
    averageCpd: cpd.averageCpd,
    importedAt: snapshot.importedAt.toISOString()
  };
}

export async function refreshRealtimeCecFromFreshdesk(options: { force?: boolean } = {}) {
  const currentCycle = getCurrentCecCycle();
  if (!options.force) {
    const existing = await prisma.realTimeCecSnapshot.findUnique({
      where: { cycleDownload: currentCycle },
      select: { id: true, cycleDownload: true, importedAt: true, source: true }
    });
    if (existing && existing.source === cecCpdSource) {
      return {
        success: true,
        refreshed: false,
        snapshotId: existing.id,
        cycleDownload: existing.cycleDownload,
        importedAt: existing.importedAt.toISOString()
      };
    }
  }

  // Share only actual downloads, never an unforced existing-cycle check. A
  // simultaneous explicit Refresh must not inherit a non-forced skipped result.
  if (refreshInFlight) return refreshInFlight;
  const operation = refreshRealtimeCecFromFreshdeskUncached();
  refreshInFlight = operation;
  try { return await operation; } finally {
    if (refreshInFlight === operation) refreshInFlight = null;
  }
}

let refreshInFlight: ReturnType<typeof refreshRealtimeCecFromFreshdeskUncached> | null = null;

async function refreshRealtimeCecFromFreshdeskUncached() {
  const input = await fetchRealtimeCecFromFreshdesk();
  const existingSourceFile = await prisma.realTimeCecSnapshot.findFirst({
    where: {
      source: cecCpdSource,
      fileName: input.fileName
    },
    orderBy: { importedAt: "desc" },
    select: { id: true, cycleDownload: true, importedAt: true }
  });
  if (existingSourceFile) {
    return {
      success: true,
      refreshed: false,
      snapshotId: existingSourceFile.id,
      cycleDownload: existingSourceFile.cycleDownload,
      importedAt: existingSourceFile.importedAt.toISOString(),
      message: "O último arquivo horário do Freshdesk já foi importado."
    };
  }
  const imported = await importRealtimeCecSnapshot(input);
  if ("error" in imported) throw new Error(imported.error);
  return { ...imported, refreshed: true };
}

export async function getRealtimeCecReport(actor: Actor, options: { cycleDownload?: string; forceRefresh?: boolean } = {}) {
  if (!canAccessRealTime({ role: actor.role, email: actor.email, name: actor.name, roleTitle: actor.roleTitle, jobTitle: actor.jobTitle, skill: actor.skill, status: "ACTIVE" })) {
    return { error: "Você não tem permissão para acessar Real Time.", status: 403 };
  }

  let refreshWarning = "";
  try {
    // Ordinary reads use the hourly import. Only the explicit refresh action
    // (and scheduled job) calls Freshdesk, including when viewing old cycles.
    if (options.forceRefresh) await refreshRealtimeCecFromFreshdesk({ force: true });
  } catch (error) {
    refreshWarning = error instanceof Error ? error.message : "Não foi possível consultar o Data Export CEC.";
    console.warn("[realtime/cec] A atualização do CPD falhou; usando o último snapshot CPD válido.", error);
  }

  // Historic cycles need only the stored aggregate + compact agent list, not
  // hundreds of full ticket arrays. Missing legacy aggregates retain a fallback.
  const snapshots = await prisma.$queryRaw<Array<{
    id: string; cycleDownload: string; importedAt: Date; totalBacklog: number;
    rawData: Prisma.JsonValue;
  }>>(Prisma.sql`
    SELECT "id", "cycleDownload", "importedAt", "totalBacklog",
      CASE WHEN jsonb_typeof("rawData"->'agents') = 'array'
        THEN jsonb_build_object('agents', "rawData"->'agents')
        ELSE jsonb_build_object('tickets', "rawData"->'tickets') END AS "rawData"
    FROM "RealTimeCecSnapshot"
    WHERE "importedAt" >= ${realtimeCecRetentionCutoff()} AND "source" = ${cecCpdSource}
    ORDER BY "cycleDownload" DESC, "importedAt" DESC LIMIT 200
  `);
  const selected = resolveSelectedSnapshot(snapshots, options.cycleDownload);
  const previous = selected ? snapshots.find((snapshot) => snapshot.cycleDownload < selected.cycleDownload) ?? null : null;
  const details = selected ? await prisma.realTimeCecSnapshot.findMany({
    where: { id: { in: [selected.id, ...(previous ? [previous.id] : [])] } }
  }) : [];
  const selectedDetail = details.find((row) => row.id === selected?.id);
  const previousDetail = details.find((row) => row.id === previous?.id);
  const summaries = new Map(snapshots.map((snapshot) => [snapshot.id, compactCpd(snapshot)]));

  return {
    data: {
      hasData: Boolean(selectedDetail),
      refreshWarning,
      selectedCycle: selected?.cycleDownload ?? "",
      previousCycle: previous?.cycleDownload ?? "",
      cycles: snapshots.map((snapshot) => ({
        value: snapshot.cycleDownload,
        importedAt: snapshot.importedAt.toISOString(),
        importedAtLabel: formatDateTime(snapshot.importedAt),
        rows: summaries.get(snapshot.id)!.activeAgents
      })),
      snapshot: selectedDetail ? serializeSnapshot(selectedDetail) : null,
      previous: previousDetail ? serializeSnapshot(previousDetail) : null,
      history: snapshots
        .slice()
        .sort((left, right) => left.cycleDownload.localeCompare(right.cycleDownload))
        .map((snapshot) => {
          const cpd = summaries.get(snapshot.id)!;
          return {
            cycleDownload: snapshot.cycleDownload,
            totalCpd: cpd.totalCpd,
            activeAgents: cpd.activeAgents,
            averageCpd: cpd.averageCpd
          };
        })
    }
  };
}

function resolveSelectedSnapshot<T extends { cycleDownload: string }>(snapshots: T[], cycleDownload?: string) {
  const requested = cycleDownload?.trim();
  if (requested) {
    return snapshots.find((snapshot) => snapshot.cycleDownload === requested)
      ?? snapshots.find((snapshot) => snapshot.cycleDownload <= requested)
      ?? snapshots[0]
      ?? null;
  }
  return snapshots[0] ?? null;
}

function compactCpd(snapshot: { rawData: Prisma.JsonValue }) {
  const raw = snapshot.rawData as RealtimeCecRawData | null;
  if (!Array.isArray(raw?.agents)) return buildCecHourlyCpd(extractTickets(snapshot));
  const activeAgents = raw.agents.length;
  const totalCpd = raw.agents.reduce((sum, agent) => sum + Math.max(0, Number(agent.cpd) || 0), 0);
  return { totalCpd, activeAgents, averageCpd: activeAgents ? Math.round(totalCpd / activeAgents * 100) / 100 : 0 };
}

function extractTickets(snapshot: { rawData: Prisma.JsonValue }) {
  const rawData = snapshot.rawData as RealtimeCecRawData | null;
  return normalizedTickets(Array.isArray(rawData?.tickets) ? rawData.tickets : []);
}

function extractCpd(snapshot: NonNullable<RealtimeCecSnapshotRecord>) {
  return buildCecHourlyCpd(extractTickets(snapshot));
}

function serializeSnapshot(snapshot: NonNullable<RealtimeCecSnapshotRecord>) {
  const cpd = extractCpd(snapshot);
  return {
    id: snapshot.id,
    cycleDownload: snapshot.cycleDownload,
    fileName: snapshot.fileName,
    source: snapshot.source,
    generatedDate: snapshot.generatedDate,
    importedAt: snapshot.importedAt.toISOString(),
    importedAtLabel: formatDateTime(snapshot.importedAt),
    totalCpd: cpd.totalCpd,
    activeAgents: cpd.activeAgents,
    averageCpd: cpd.averageCpd,
    agents: cpd.agents,
    tickets: cpd.tickets
  };
}

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: saoPauloTimeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(value);
}
