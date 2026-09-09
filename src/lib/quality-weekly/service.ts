import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { QualityWeeklyError as ErrorWithStatus } from "./access";
import { aggregate, analyze, buildAgents, buildSections, dayAdd, dateValue, mappingPending, parseMapping, RULE_VERSION, RULE_DEFINITION, trendPoint, weekStart } from "./domain";
import type { MappingEntry, Snapshot, Validation } from "./domain";
import { QUEUE_REPORT_METADATA } from "../queue-report-metadata";
import { readTables, selectTable, MAX_UPLOAD } from "./workbook";
import type { QualityStorage } from "./storage";

export type QualityAuthor = { id: string; name: string };
const asJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
// Store the canonical snapshot as text to avoid JSONB/driver floating-point reserialization.
const snapshotOf = (value: string) => JSON.parse(value) as Snapshot;
const entriesOf = (value: Prisma.JsonValue) => value as unknown as MappingEntry[];
// Reuse registered names only. Operational LOB/department never determines a quality section.
const queueNames = Object.fromEntries(Object.entries(QUEUE_REPORT_METADATA)
  .filter(([, value]) => value.queueName && value.queueName !== "Fila não mapeada")
  .map(([id, value]) => [id, value.queueName]));
const LOCK_ID = 721806923; // Only Weekly Quality publishing/mapping operations share this lock.

export function createQualityWeeklyService(db: PrismaClient, storage: QualityStorage) {
  const currentMapping = () => db.qualityWeeklyMapping.findFirst({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: { asset: true } });
  async function asset(id: string, author?: QualityAuthor) {
    const row = await db.qualityWeeklyAsset.findUnique({ where: { id } });
    if (!row || (author && row.createdById !== author.id)) throw new ErrorWithStatus("Upload not found.", 404);
    const bytes = await storage.read(row.objectPath);
    if (bytes.length !== row.declaredSize || bytes.length > MAX_UPLOAD) throw new ErrorWithStatus("The uploaded file size does not match. Upload the complete file again.", 422);
    return { row, bytes };
  }
  function tables(bytes: Uint8Array, filename: string) {
    try { return readTables(bytes, filename); }
    catch (error) { throw new ErrorWithStatus(error instanceof Error ? error.message : "Invalid workbook.", 422); }
  }
  function table(bytes: Uint8Array, filename: string, sheet?: string) {
    try { return selectTable(tables(bytes, filename), sheet); }
    catch (error) { throw new ErrorWithStatus(error instanceof Error ? error.message : "Select a worksheet.", 422); }
  }
  async function importAsset(assetId: string, author: QualityAuthor, sheet?: string, dateColumn?: string, shared = false) {
    const { row, bytes } = await asset(assetId, shared ? undefined : author);
    if (row.kind !== "source") throw new ErrorWithStatus("Select a KwaiBI source export.");
    const mapping = await currentMapping();
    const selected = table(bytes, row.filename, sheet);
    const { cases: _cases, ...validation } = analyze(selected, mapping ? entriesOf(mapping.entries) : [], dateColumn);
    const saved = await db.qualityWeeklyImport.create({ data: {
      id: randomUUID(), assetId, mappingId: mapping?.id, digest: sha256(bytes), sheet: selected.sheet,
      dateColumn, validation: asJson(validation), createdById: author.id, createdBy: author.name
    } });
    return { id: saved.id, filename: row.filename, mappingId: saved.mappingId, sheet: saved.sheet, dateColumn, validation };
  }
  return {
    currentMapping,
    async transfer(filename: string, size: number, kind: string, author: QualityAuthor) {
      if (!Number.isInteger(size) || size <= 0 || size > MAX_UPLOAD || filename.length > 240
        || !/\.(xlsx|csv)$/i.test(filename) || (kind !== "source" && kind !== "mapping")
        || (kind === "source" && !/\.xlsx$/i.test(filename))) throw new ErrorWithStatus("Use an XLSX export or XLSX/CSV mapping up to 10 MB.");
      const id = randomUUID();
      return db.qualityWeeklyAsset.create({ data: { id, filename, declaredSize: size, kind, objectPath: `sources/${id}`, createdById: author.id } });
    },
    async inspect(assetId: string, author: QualityAuthor) {
      const { row, bytes } = await asset(assetId, author);
      return { sheets: tables(bytes, row.filename).map(t => ({ name: t.sheet, headers: t.headers, rows: t.rows.length })) };
    },
    async mapping(assetId: string, author: QualityAuthor, sheet?: string) {
      const { row, bytes } = await asset(assetId, author);
      if (row.kind !== "mapping") throw new ErrorWithStatus("Select a queue mapping file.");
      const parsed = parseMapping(table(bytes, row.filename, sheet), { allowIncomplete: true, queueNames });
      if (parsed.issues.some(issue => issue.severity === "error")) throw new ErrorWithStatus("Resolve the mapping issues before saving.", 422, { issues: parsed.issues });
      const entries = parsed.mappings.sort((a, b) => a.queueId.localeCompare(b.queueId));
      const pendingCount = entries.filter(entry => mappingPending(entry).length).length;
      return db.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_ID})`;
        const previous = await tx.qualityWeeklyMapping.findFirst({ orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
        const canonicalMapping = (items: MappingEntry[]) => items.map(m => [m.queueId, m.queueName, m.section, m.industry, m.category || null]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
        if (previous && JSON.stringify(canonicalMapping(entriesOf(previous.entries))) === JSON.stringify(canonicalMapping(entries))) return { id: previous.id, entries, unchanged: true, pendingCount };
        const mapping = await tx.qualityWeeklyMapping.create({ data: { id: randomUUID(), assetId, digest: sha256(bytes), entries: asJson(entries), createdById: author.id, createdBy: author.name } });
        return { id: mapping.id, entries, unchanged: false, pendingCount };
      });
    },
    importAsset,
    async revalidate(id: string, author: QualityAuthor, dateColumn?: string) {
      const previous = await db.qualityWeeklyImport.findUnique({ where: { id } });
      if (!previous) throw new ErrorWithStatus("Import not found.", 404);
      return importAsset(previous.assetId, author, previous.sheet, dateColumn || previous.dateColumn || undefined, true);
    },
    async preview(input: { uploadId: string; start: string; weekNumber: number; complete: boolean }, author: QualityAuthor) {
      if (dateValue(input.start) !== input.start || weekStart(input.start) !== input.start) throw new ErrorWithStatus("Select a Monday. The reporting period ends on Sunday.");
      if (!Number.isInteger(input.weekNumber) || input.weekNumber < 1 || input.weekNumber > 53) throw new ErrorWithStatus("Enter the operation's week number (1–53).");
      if (!input.complete) throw new ErrorWithStatus("Confirm that this is the complete weekly export.");
      const imported = await db.qualityWeeklyImport.findUnique({ where: { id: input.uploadId }, include: { mapping: true, asset: true } });
      if (!imported) throw new ErrorWithStatus("Import not found.", 404);
      if (!(imported.validation as unknown as Validation).valid || !imported.mapping) throw new ErrorWithStatus("Resolve all validation issues and provide the queue mapping before generating a report.", 422);
      const bytes = await storage.read(imported.asset.objectPath);
      if (sha256(bytes) !== imported.digest) throw new ErrorWithStatus("The preserved source failed its integrity check. Upload it again.", 422);
      // Revalidate on the server, with the exact frozen mapping; never trust client metrics.
      const analysis = analyze(table(bytes, imported.asset.filename, imported.sheet), entriesOf(imported.mapping.entries), imported.dateColumn || undefined);
      if (!analysis.valid) throw new ErrorWithStatus("Source validation failed. Revalidate the import.", 422);
      const cases = analysis.cases.filter(c => weekStart(c.date) === input.start);
      if (!cases.length) throw new ErrorWithStatus("No valid cases exist in the selected moderation week.", 422);
      return db.$transaction(async tx => {
        const starts = [3, 2, 1, 0].map(i => dayAdd(input.start, -7 * i));
        const heads = await tx.qualityWeeklyHead.findMany({ where: { weekStart: { in: starts } }, include: { report: true } });
        const expectations = Object.fromEntries(starts.map(start => [start, heads.find(h => h.weekStart === start)?.reportId ?? null]));
        const previousRow = heads.find(h => h.weekStart === input.start)?.report;
        const previous = previousRow ? snapshotOf(previousRow.snapshot) : null;
        const max = await tx.qualityWeeklyReport.aggregate({ where: { weekStart: input.start }, _max: { version: true } });
        const snapshot: Snapshot = {
          id: randomUUID(), start: input.start, end: dayAdd(input.start, 6), weekNumber: input.weekNumber,
          version: (max._max.version ?? 0) + 1, createdAt: new Date().toISOString(), createdBy: author.name,
          ruleVersion: RULE_VERSION, ruleDefinition: RULE_DEFINITION, uploadId: imported.id, mappingId: imported.mappingId!, mappings: entriesOf(imported.mapping!.entries),
          filename: imported.asset.filename, digest: imported.digest, metrics: aggregate(cases), sections: buildSections(cases), agents: buildAgents(cases),
          trend: starts.slice(0, 3).map(start => {
            const head = heads.find(h => h.weekStart === start);
            if (!head) return { start, weekNumber: null, reportId: null, CD: null, ACCOUNTS: null, MATERIAL: null, industryA: null, industryB: null };
            const prior = snapshotOf(head.report.snapshot);
            // Legacy Material totals include Unit and are not comparable to the new separate section.
            return { ...trendPoint(prior), ...(prior.ruleVersion === 'quality-weekly-v1' ? { MATERIAL: null } : {}) };
          })
        };
        snapshot.trend.push(trendPoint(snapshot));
        const canonicalCases = cases.map(({ sourceRow: _row, ...rest }) => rest).sort((a, b) => JSON.stringify([a.qaId, a.auditId]).localeCompare(JSON.stringify([b.qaId, b.auditId])));
        const contentHash = sha256(JSON.stringify({ start: input.start, weekNumber: input.weekNumber, rules: RULE_VERSION,
          mapping: snapshot.mappings, cases: canonicalCases, previousWeeks: snapshot.trend.slice(0, 3).map(t => t.reportId) }));
        await tx.qualityWeeklyDraft.create({ data: { id: snapshot.id, importId: imported.id, snapshot: JSON.stringify(snapshot), expectations: asJson(expectations), contentHash, createdById: author.id } });
        const unchanged = previousRow?.contentHash === contentHash;
        return { draftId: snapshot.id, snapshot, previous, unchanged, existingId: unchanged ? previousRow!.id : null };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 });
    },
    async commit(input: { draftId: string; complete: boolean; replace: boolean }, author: QualityAuthor) {
      if (!input.complete) throw new ErrorWithStatus("Confirm the complete weekly export.");
      return db.$transaction(async tx => {
        // Serialize only the small publication transaction, never file parsing or Word rendering.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_ID})`;
        const draft = await tx.qualityWeeklyDraft.findUnique({ where: { id: input.draftId } });
        if (!draft || draft.createdById !== author.id) throw new ErrorWithStatus("Create your own preview before confirming this report.", 404);
        const completed = await tx.qualityWeeklyReport.findUnique({ where: { id: input.draftId } });
        if (completed) return { id: completed.id, version: completed.version, unchanged: true };
        const snapshot = snapshotOf(draft.snapshot);
        if (snapshot.ruleVersion !== RULE_VERSION) throw new ErrorWithStatus("The calculation rules changed. Create a new preview and review the results before saving.", 409);
        const expected = draft.expectations as Record<string, string | null>;
        const heads = await tx.qualityWeeklyHead.findMany({ where: { weekStart: { in: Object.keys(expected) } }, include: { report: true } });
        const current = heads.find(h => h.weekStart === snapshot.start)?.report;
        if (current?.contentHash === draft.contentHash) return { id: current.id, version: current.version, unchanged: true };
        if (expected[snapshot.start] && !input.replace) throw new ErrorWithStatus("Review the comparison and confirm replacement of the active week.", 409);
        if (Object.entries(expected).some(([start, id]) => (heads.find(h => h.weekStart === start)?.reportId ?? null) !== id))
          throw new ErrorWithStatus("Another person updated a week used by this preview. Refresh the preview and review the comparison again.", 409);
        await tx.qualityWeeklyReport.create({ data: { id: snapshot.id, weekStart: snapshot.start, weekNumber: snapshot.weekNumber, version: snapshot.version,
          importId: draft.importId, snapshot: draft.snapshot, contentHash: draft.contentHash, createdById: author.id, createdBy: author.name } });
        await tx.qualityWeeklyHead.upsert({ where: { weekStart: snapshot.start }, create: { weekStart: snapshot.start, reportId: snapshot.id }, update: { reportId: snapshot.id } });
        return { id: snapshot.id, version: snapshot.version, unchanged: false };
      }, { timeout: 15000 });
    },
    async report(id: string) {
      const row = await db.qualityWeeklyReport.findUnique({ where: { id }, include: { import: { include: { asset: true, mapping: { include: { asset: true } } } } } });
      if (!row) throw new ErrorWithStatus("Report version not found.", 404);
      return { row, snapshot: snapshotOf(row.snapshot) };
    },
    async history(before?: string) {
      const cursor = before ? await db.qualityWeeklyReport.findUnique({ where: { id: before }, select: { createdAt: true, id: true } }) : null;
      if (before && !cursor) throw new ErrorWithStatus("History cursor not found. Refresh the history.");
      const rows = await db.qualityWeeklyReport.findMany({ where: cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {},
        orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 51,
        select: { id: true, weekStart: true, weekNumber: true, version: true, createdBy: true, createdAt: true, head: { select: { reportId: true } } } });
      return { reports: rows.slice(0, 50).map(({ head, ...row }) => ({ ...row, active: Boolean(head) })), next: rows.length > 50 ? rows[49].id : null };
    }
  };
}
