import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

const freshChatRetentionDays = Number.parseInt(process.env.REALTIME_RETENTION_DAYS ?? "3", 10) || 3;

type FreshChatRowInput = {
  status?: unknown;
  Status?: unknown;
  STATUS?: unknown;
  [key: string]: unknown;
};

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

function normalizeFreshChatStatus(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s_-]+/g, " ");
}

function getRowStatus(row: FreshChatRowInput) {
  return row.status ?? row.Status ?? row.STATUS ?? row["Status"] ?? row["status"] ?? "";
}

function countFreshChatBacklog(rows: FreshChatRowInput[]) {
  return rows.reduce<{ assignedCount: number; newCount: number }>(
    (summary, row) => {
      const status = normalizeFreshChatStatus(getRowStatus(row));
      if (status === "assigned" || status === "atribuido" || status === "atribuida") summary.assignedCount += 1;
      if (status === "new" || status === "novo" || status === "nova") summary.newCount += 1;
      return summary;
    },
    { assignedCount: 0, newCount: 0 }
  );
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
  const { assignedCount, newCount } = countFreshChatBacklog(rows);
  const totalBacklog = assignedCount + newCount;
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
  const snapshot = requestedCycle
    ? await prisma.realTimeFreshChatSnapshot.findFirst({
        where: { cycleDownload: requestedCycle },
        orderBy: { importedAt: "desc" }
      })
    : await prisma.realTimeFreshChatSnapshot.findFirst({
        where: { importedAt: { gte: freshChatRetentionCutoff() } },
        orderBy: { importedAt: "desc" }
      });

  const fallback = snapshot ?? (requestedCycle
    ? await prisma.realTimeFreshChatSnapshot.findFirst({
        where: { importedAt: { gte: freshChatRetentionCutoff() } },
        orderBy: { importedAt: "desc" }
      })
    : null);

  if (!fallback) return null;

  return {
    cycleDownload: fallback.cycleDownload,
    source: fallback.source,
    fileName: fallback.fileName,
    generatedDate: fallback.generatedDate,
    assignedCount: fallback.assignedCount,
    newCount: fallback.newCount,
    totalBacklog: fallback.totalBacklog,
    rowsTotal: fallback.rowsTotal,
    importedAt: fallback.importedAt.toISOString()
  };
}
