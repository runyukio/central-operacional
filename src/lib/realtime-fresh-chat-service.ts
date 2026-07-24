import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

const freshChatRetentionDays = Number.parseInt(process.env.REALTIME_RETENTION_DAYS ?? "3", 10) || 3;
const freshChatStaleMinutes = Number.parseInt(process.env.FRESHCHAT_STALE_MINUTES ?? "15", 10) || 15;

type FreshChatRowInput = Record<string, unknown> | string | number | boolean | null | unknown[];

export type RealtimeFreshChatImportInput = {
  cycleDownload: string;
  fileName?: string;
  source?: string;
  generatedDate?: string | null;
  rows?: FreshChatRowInput[];
  tickets?: FreshChatRowInput[];
  rawText?: string;
};

function freshChatRetentionCutoff() {
  return new Date(Date.now() - freshChatRetentionDays * 24 * 60 * 60 * 1000);
}

export function getFreshChatSnapshotFreshness(
  snapshot: { generatedDate?: string | null; importedAt: Date | string },
  now = Date.now(),
  staleAfterMinutes = freshChatStaleMinutes
) {
  const importedAt = new Date(snapshot.importedAt);
  const generatedAt = snapshot.generatedDate ? new Date(snapshot.generatedDate) : null;
  const observedAt = generatedAt && Number.isFinite(generatedAt.getTime()) ? generatedAt : importedAt;
  const ageMinutes = Number.isFinite(observedAt.getTime())
    ? Math.max(0, Math.floor((now - observedAt.getTime()) / 60_000))
    : Number.POSITIVE_INFINITY;

  return {
    observedAt: Number.isFinite(observedAt.getTime()) ? observedAt.toISOString() : null,
    ageMinutes: Number.isFinite(ageMinutes) ? ageMinutes : null,
    staleAfterMinutes,
    isStale: ageMinutes > staleAfterMinutes
  };
}

function normalizeFreshChatStatus(value: unknown) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s_-]+/g, " ");
}

function isAssignedStatus(status: string) {
  return ["assigned", "atribuido", "atribuida"].includes(status);
}

function isNewStatus(status: string) {
  return ["new", "novo", "nova"].includes(status);
}

function isFreshChatBacklogStatus(value: unknown) {
  const status = normalizeFreshChatStatus(value);
  return isAssignedStatus(status) || isNewStatus(status);
}

function tokenizeFreshChatText(value: unknown) {
  return String(value ?? "")
    .split(/\r?\n|[,;\t|]/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function extractStatusCandidatesFromText(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return [];

  const tokens = tokenizeFreshChatText(raw);
  const exactMatches = tokens.filter(isFreshChatBacklogStatus);
  if (exactMatches.length) return exactMatches;

  const normalized = normalizeFreshChatStatus(raw);
  if (isFreshChatBacklogStatus(normalized)) return [raw];
  return [];
}

function getRowStatuses(row: FreshChatRowInput): unknown[] {
  if (typeof row === "string" || typeof row === "number" || typeof row === "boolean") {
    return extractStatusCandidatesFromText(row);
  }
  if (!row) return [];

  if (Array.isArray(row)) {
    return row.flatMap((value) => extractStatusCandidatesFromText(value));
  }

  const explicitStatusKeys = [
    "status",
    "Status",
    "STATUS",
    "ticket_status",
    "ticketStatus",
    "Ticket Status",
    "Ticket status",
    "STATUS - NEW & OPEN&On-Hold"
  ];
  const explicitStatuses = explicitStatusKeys.flatMap((key) => extractStatusCandidatesFromText(row[key]));
  if (explicitStatuses.length) return explicitStatuses;

  return Object.values(row).flatMap((value) => {
    if (Array.isArray(value)) return value.flatMap((item) => extractStatusCandidatesFromText(item));
    if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).flatMap((item) => extractStatusCandidatesFromText(item));
    return extractStatusCandidatesFromText(value);
  });
}

function extractRawTextStatuses(rawText?: string) {
  return String(rawText ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => extractStatusCandidatesFromText(line))
    .filter((status) => {
      const normalized = normalizeFreshChatStatus(status);
      return normalized !== "status" && normalized !== "ticket status";
    });
}

function summarizeStatuses(statuses: unknown[]) {
  return statuses.reduce<{ assignedCount: number; newCount: number }>(
    (summary, rawStatus) => {
      const status = normalizeFreshChatStatus(rawStatus);
      if (isAssignedStatus(status)) summary.assignedCount += 1;
      if (isNewStatus(status)) summary.newCount += 1;
      return summary;
    },
    { assignedCount: 0, newCount: 0 }
  );
}

export function countFreshChatBacklog(rows: FreshChatRowInput[], rawText?: string) {
  const rowSummary = summarizeStatuses(rows.flatMap(getRowStatuses));
  if (rowSummary.assignedCount + rowSummary.newCount > 0 || !String(rawText ?? "").trim()) return rowSummary;
  return summarizeStatuses(extractRawTextStatuses(rawText));
}

async function pruneFreshChatHistory(currentId?: string) {
  try {
    await prisma.realTimeFreshChatSnapshot.deleteMany({
      where: {
        importedAt: { lt: freshChatRetentionCutoff() },
        ...(currentId ? { id: { not: currentId } } : {})
      }
    });
  } catch (error) {
    console.warn("[realtime/fresh-chat] Não foi possível limpar histórico antigo.", error);
  }
}

export async function importRealtimeFreshChatSnapshot(input: RealtimeFreshChatImportInput) {
  const cycleDownload = String(input.cycleDownload ?? "").trim();
  if (!cycleDownload) return { error: "cycleDownload é obrigatório para importar Fresh Chat.", status: 400 };

  const rows = Array.isArray(input.rows) ? input.rows : Array.isArray(input.tickets) ? input.tickets : [];
  const fileName = String(input.fileName ?? "fresh_chat_backlog.json").trim() || "fresh_chat_backlog.json";
  const source = String(input.source ?? "fresh-chat").trim() || "fresh-chat";
  const { assignedCount, newCount } = countFreshChatBacklog(rows, input.rawText);
  const totalBacklog = assignedCount + newCount;
  console.info("[realtime/fresh-chat] snapshot processado", {
    cycleDownload,
    rowsTotal: rows.length,
    firstRowType: Array.isArray(rows[0]) ? "array" : typeof rows[0],
    rawTextLength: String(input.rawText ?? "").length,
    assignedCount,
    newCount,
    totalBacklog
  });
  const rawData = {
    source,
    fileName,
    cycleDownload,
    generatedDate: input.generatedDate || null,
    assignedCount,
    newCount,
    totalBacklog,
    rowsTotal: rows.length,
    rows,
    rawText: input.rawText || ""
  };

  const snapshot = await prisma.realTimeFreshChatSnapshot.upsert({
    where: { cycleDownload },
    create: {
      cycleDownload,
      source,
      fileName,
      generatedDate: input.generatedDate || null,
      assignedCount,
      newCount,
      totalBacklog,
      rowsTotal: rows.length,
      rawData: rawData as Prisma.InputJsonValue
    },
    update: {
      source,
      fileName,
      generatedDate: input.generatedDate || null,
      assignedCount,
      newCount,
      totalBacklog,
      rowsTotal: rows.length,
      rawData: rawData as Prisma.InputJsonValue,
      importedAt: new Date()
    }
  });

  await pruneFreshChatHistory(snapshot.id);

  return {
    success: true,
    snapshotId: snapshot.id,
    cycleDownload: snapshot.cycleDownload,
    fileName: snapshot.fileName,
    assignedCount: snapshot.assignedCount,
    newCount: snapshot.newCount,
    totalBacklog: snapshot.totalBacklog,
    rowsTotal: snapshot.rowsTotal,
    importedAt: snapshot.importedAt.toISOString()
  };
}

export async function getRealtimeFreshChatSnapshot(cycleDownload?: string) {
  const requestedCycle = String(cycleDownload ?? "").trim();
  const latestSnapshot = await prisma.realTimeFreshChatSnapshot.findFirst({
    where: { importedAt: { gte: freshChatRetentionCutoff() } },
    orderBy: { importedAt: "desc" }
  });

  const requestedSnapshot = requestedCycle
      ? await prisma.realTimeFreshChatSnapshot.findFirst({
          where: { cycleDownload: requestedCycle },
          orderBy: { importedAt: "desc" }
        })
    : null;

  const snapshot = [requestedSnapshot, latestSnapshot]
    .filter((item): item is NonNullable<typeof latestSnapshot> => Boolean(item))
    .sort((a, b) => b.importedAt.getTime() - a.importedAt.getTime())[0];

  if (!snapshot) return null;
  const freshness = getFreshChatSnapshotFreshness(snapshot);

  return {
    cycleDownload: snapshot.cycleDownload,
    source: snapshot.source,
    fileName: snapshot.fileName,
    generatedDate: snapshot.generatedDate,
    assignedCount: snapshot.assignedCount,
    newCount: snapshot.newCount,
    totalBacklog: snapshot.totalBacklog,
    rowsTotal: snapshot.rowsTotal,
    importedAt: snapshot.importedAt.toISOString(),
    ...freshness
  };
}
