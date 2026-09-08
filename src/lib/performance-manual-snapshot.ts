import { AuditAction } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { Actor } from "@/lib/mock-db";
import type { prepareCecFrtSnapshot } from "@/lib/cec-frt-service";
import { performanceManualBases, type OperationalManualBase, type ManualImportResult } from "@/lib/performance-manual-bases";
import { authorizePerformanceImport, PerformanceError, prepareManualOperationalRows, writeManualOperationalRows, type PerformancePreviewRow } from "@/lib/performance-service";

export type ManualSnapshotFiles = Partial<Record<OperationalManualBase, { fileName: string; rows: PerformancePreviewRow[] }>> & {
  cecFrt?: Awaited<ReturnType<typeof prepareCecFrtSnapshot>> & { fileName: string };
};

/** Replace only selected datasets. Parsing and lookups finish before the write transaction starts. */
export async function replaceSelectedManualSnapshots(actor: Actor, files: ManualSnapshotFiles): Promise<ManualImportResult> {
  const user = await authorizePerformanceImport(actor);
  const selectedBases = performanceManualBases.map((base) => base.key).filter((key) => files[key]);
  if (!selectedBases.length) throw new PerformanceError("Selecione pelo menos uma base para atualizar.", 400);
  const operational = selectedBases.filter((key): key is OperationalManualBase => key !== "cecFrt").map((key) => ({
    key, fileName: files[key]!.fileName, ...prepareManualOperationalRows(key, files[key]!.rows)
  }));
  if (files.cecFrt && !files.cecFrt.rows.length) throw new PerformanceError("A base SLA/FRT CEC está vazia. Nenhuma base foi alterada.", 400);
  const result: ManualImportResult = { selectedBases, rowsError: operational.reduce((sum, base) => sum + base.errorCount, 0) };

  await prisma.$transaction(async (tx) => {
    // Consistent lock order for concurrent manual imports. No reads observe a half-published selection.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('performance-manual-snapshot'))::text`;
    if (files.cecFrt) await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('performance-cec-frt-snapshot'))::text`;
    const previousBatches = operational.length ? await tx.performanceImportBatch.findMany({
      where: { type: "PRODUCTION", status: { not: "PROCESSING" } }, select: { id: true }
    }) : [];
    const batchIds: string[] = [];
    for (const base of operational) {
      const batch = await tx.performanceImportBatch.create({ data: {
        type: "PRODUCTION", fileName: base.fileName, importedById: user.id,
        status: base.errorCount ? "PARTIAL" : "SUCCESS", rowsTotal: base.totalCount,
        rowsValid: base.validCount, rowsError: base.errorCount, rowsInserted: base.rows.length
      } });
      batchIds.push(batch.id);
      await writeManualOperationalRows(tx, base.key, base.rows, batch.id);
      const where = { OR: [{ importBatchId: null }, { importBatchId: { not: batch.id } }] };
      if (base.key === "production") await tx.productionRecord.deleteMany({ where });
      if (base.key === "volume") await tx.performanceQueueVolumeRecord.deleteMany({ where });
      if (base.key === "cecCpd") await tx.performanceCecCpdRecord.deleteMany({ where });
      const definition = performanceManualBases.find((item) => item.key === base.key)!;
      result[definition.resultKey] = base.validCount;
    }
    if (files.cecFrt) {
      const frt = files.cecFrt;
      const batch = await tx.performanceImportBatch.create({ data: {
        type: "CEC_FRT", fileName: frt.fileName, importedById: user.id, status: "SUCCESS",
        rowsTotal: frt.rows.length, rowsValid: frt.rows.length, rowsInserted: frt.rows.length
      } });
      batchIds.push(batch.id);
      for (let i = 0; i < frt.rows.length; i += 1500) {
        await tx.performanceCecFrtRecord.createMany({ data: frt.rows.slice(i, i + 1500).map((row) => ({ ...row, importBatchId: batch.id })) });
      }
      await tx.performanceImportBatch.deleteMany({ where: { type: "CEC_FRT", status: { not: "PROCESSING" }, id: { not: batch.id } } });
      Object.assign(result, frt.summary);
    }
    if (previousBatches.length) {
      // Legacy batches may contain all three bases. Never delete metadata still referenced by an unselected base.
      await tx.performanceImportBatch.deleteMany({ where: {
        id: { in: previousBatches.map((batch) => batch.id) }, type: "PRODUCTION", status: { not: "PROCESSING" },
        productionRecords: { none: {} }, queueVolumeRecords: { none: {} }, cecCpdRecords: { none: {} },
        cecFrtRecords: { none: {} }, qualityRecords: { none: {} }, tnsQualityRecords: { none: {} }, cecQualityRecords: { none: {} }
      } });
    }
    await tx.auditLog.create({ data: { actorId: user.id, action: AuditAction.IMPORTACAO, entity: "PerformanceImportBatch",
      entityId: batchIds[0], after: { batchIds, ...result }, reason: "PERFORMANCE_SELECTED_BASES_IMPORT" } });
  }, { timeout: 120000, maxWait: 10000 });
  return result;
}
