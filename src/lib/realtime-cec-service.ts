import { Prisma } from "@prisma/client";

import type { Actor } from "@/lib/mock-db";
import { canAccessRealTime } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const cecRetentionDays = Number.parseInt(process.env.REALTIME_RETENTION_DAYS ?? "3", 10) || 3;
const saoPauloTimeZone = "America/Sao_Paulo";

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

export type RealtimeCecImportInput = {
  cycleDownload: string;
  fileName: string;
  source?: string;
  generatedDate?: string | null;
  groups: RealtimeCecGroupInput[];
  departments?: RealtimeCecDepartmentInput[];
  rawText?: string;
};

type RealtimeCecSnapshotRecord = Awaited<ReturnType<typeof prisma.realTimeCecSnapshot.findFirst>>;

function realtimeCecRetentionCutoff() {
  return new Date(Date.now() - cecRetentionDays * 24 * 60 * 60 * 1000);
}

function clampCount(value: unknown) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return 0;
  return Math.max(0, Math.round(numberValue));
}

function normalizePercent(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function normalizeGroup(input: RealtimeCecGroupInput): RealtimeCecGroupInput {
  return {
    key: String(input.key || "unknown").trim() || "unknown",
    label: String(input.label || input.key || "Unknown").trim() || "Unknown",
    backlog: clampCount(input.backlog),
    onHold: clampCount(input.onHold),
    open: clampCount(input.open),
    new: clampCount(input.new)
  };
}

function normalizeDepartment(input: RealtimeCecDepartmentInput): RealtimeCecDepartmentInput {
  return {
    name: String(input.name || "Unknown").trim() || "Unknown",
    group: String(input.group || "unknown").trim() || "unknown",
    backlog: clampCount(input.backlog),
    percent: normalizePercent(input.percent)
  };
}

function buildRawData(input: RealtimeCecImportInput, groups: RealtimeCecGroupInput[], departments: RealtimeCecDepartmentInput[]) {
  return {
    source: input.source || "freshdesk-pdf",
    fileName: input.fileName,
    cycleDownload: input.cycleDownload,
    generatedDate: input.generatedDate || null,
    groups,
    departments,
    rawText: input.rawText || ""
  };
}

function summarizeGroups(groups: RealtimeCecGroupInput[]) {
  const normal = groups.find((group) => group.key === "normal");
  const p0 = groups.find((group) => group.key === "p0");
  const p0L2 = groups.find((group) => group.key === "p0_l2");
  const countedGroups = groups.filter((group) => group.key !== "p0_l2");

  return {
    totalBacklog: countedGroups.reduce((sum, group) => sum + group.backlog, 0),
    normalBacklog: normal?.backlog ?? 0,
    p0Backlog: p0?.backlog ?? 0,
    p0L2Backlog: p0L2?.backlog ?? 0,
    onHoldCount: countedGroups.reduce((sum, group) => sum + group.onHold, 0),
    openCount: countedGroups.reduce((sum, group) => sum + group.open, 0),
    newCount: countedGroups.reduce((sum, group) => sum + group.new, 0)
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
  const fileName = input.fileName.trim() || "cec_freshdesk_report.pdf";
  const source = input.source?.trim() || "freshdesk-pdf";
  const groups = (input.groups || []).map(normalizeGroup).filter((group) => group.backlog || group.onHold || group.open || group.new);
  const departments = (input.departments || []).map(normalizeDepartment).filter((department) => department.name);

  if (!cycleDownload) return { error: "cycleDownload é obrigatório para importar CEC.", status: 400 };
  if (!groups.length) return { error: "O snapshot CEC não possui grupos válidos.", status: 400 };

  const summary = summarizeGroups(groups);
  const rawData = buildRawData(input, groups, departments);

  const snapshot = await prisma.realTimeCecSnapshot.upsert({
    where: { cycleDownload },
    create: {
      cycleDownload,
      fileName,
      source,
      generatedDate: input.generatedDate || null,
      ...summary,
      rawData: rawData as Prisma.InputJsonValue
    },
    update: {
      fileName,
      source,
      generatedDate: input.generatedDate || null,
      ...summary,
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
    totalBacklog: snapshot.totalBacklog,
    normalBacklog: snapshot.normalBacklog,
    p0Backlog: snapshot.p0Backlog,
    p0L2Backlog: snapshot.p0L2Backlog,
    onHoldCount: snapshot.onHoldCount,
    openCount: snapshot.openCount,
    newCount: snapshot.newCount,
    importedAt: snapshot.importedAt.toISOString()
  };
}

export async function getRealtimeCecReport(actor: Actor, options: { cycleDownload?: string } = {}) {
  if (!canAccessRealTime({ role: actor.role, email: actor.email, name: actor.name, roleTitle: actor.roleTitle, jobTitle: actor.jobTitle, skill: actor.skill, status: "ACTIVE" })) {
    return { error: "Você não tem permissão para acessar Real Time.", status: 403 };
  }

  const snapshots = await prisma.realTimeCecSnapshot.findMany({
    where: { importedAt: { gte: realtimeCecRetentionCutoff() } },
    orderBy: [{ cycleDownload: "desc" }, { importedAt: "desc" }],
    take: 200
  });
  const selected = resolveSelectedSnapshot(snapshots, options.cycleDownload);
  const previous = selected ? snapshots.find((snapshot) => snapshot.cycleDownload < selected.cycleDownload) ?? null : null;

  return {
    data: {
      hasData: Boolean(selected),
      selectedCycle: selected?.cycleDownload ?? "",
      previousCycle: previous?.cycleDownload ?? "",
      cycles: snapshots.map((snapshot) => ({
        value: snapshot.cycleDownload,
        importedAt: snapshot.importedAt.toISOString(),
        importedAtLabel: formatDateTime(snapshot.importedAt),
        rows: extractGroups(snapshot).length
      })),
      snapshot: selected ? serializeSnapshot(selected) : null,
      previous: previous ? serializeSnapshot(previous) : null,
      history: snapshots
        .slice()
        .sort((a, b) => a.cycleDownload.localeCompare(b.cycleDownload))
        .map((snapshot) => ({
          cycleDownload: snapshot.cycleDownload,
          totalBacklog: snapshot.totalBacklog,
          normalBacklog: snapshot.normalBacklog,
          p0Backlog: snapshot.p0Backlog,
          p0L2Backlog: snapshot.p0L2Backlog,
          onHoldCount: snapshot.onHoldCount,
          openCount: snapshot.openCount,
          newCount: snapshot.newCount
        }))
    }
  };
}

function resolveSelectedSnapshot(snapshots: NonNullable<RealtimeCecSnapshotRecord>[], cycleDownload?: string) {
  const requested = cycleDownload?.trim();
  if (requested) {
    return snapshots.find((snapshot) => snapshot.cycleDownload === requested) ?? snapshots.find((snapshot) => snapshot.cycleDownload <= requested) ?? snapshots[0] ?? null;
  }
  return snapshots[0] ?? null;
}

function serializeSnapshot(snapshot: NonNullable<RealtimeCecSnapshotRecord>) {
  return {
    id: snapshot.id,
    cycleDownload: snapshot.cycleDownload,
    fileName: snapshot.fileName,
    source: snapshot.source,
    generatedDate: snapshot.generatedDate,
    importedAt: snapshot.importedAt.toISOString(),
    importedAtLabel: formatDateTime(snapshot.importedAt),
    totalBacklog: snapshot.totalBacklog,
    normalBacklog: snapshot.normalBacklog,
    p0Backlog: snapshot.p0Backlog,
    p0L2Backlog: snapshot.p0L2Backlog,
    onHoldCount: snapshot.onHoldCount,
    openCount: snapshot.openCount,
    newCount: snapshot.newCount,
    groups: extractGroups(snapshot),
    departments: extractDepartments(snapshot)
  };
}

function extractGroups(snapshot: NonNullable<RealtimeCecSnapshotRecord>): RealtimeCecGroupInput[] {
  const rawData = snapshot.rawData as { groups?: RealtimeCecGroupInput[] } | null;
  return Array.isArray(rawData?.groups) ? rawData.groups.map(normalizeGroup) : [];
}

function extractDepartments(snapshot: NonNullable<RealtimeCecSnapshotRecord>): RealtimeCecDepartmentInput[] {
  const rawData = snapshot.rawData as { departments?: RealtimeCecDepartmentInput[] } | null;
  return Array.isArray(rawData?.departments) ? rawData.departments.map(normalizeDepartment) : [];
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
