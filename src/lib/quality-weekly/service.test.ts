import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { hasQualityWeeklyAccess, QualityWeeklyError } from "./access";
import { canAccessPathForRole, getNavItems } from "../navigation";
import { FIELDS, type Cell } from "./domain";
import { createQualityWeeklyService } from "./service";
import { readTables } from "./workbook";
import { renderQualityWord } from "./document";

const author = { id: "quality-qa-only", name: "QA synthetic reviewer" };
function excel(rows: Cell[][]) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "Details");
  return new Uint8Array(XLSX.write(book, { type: "buffer", bookType: "xlsx" }));
}
const maps: Cell[][] = [["queue_id", "queue_name", "section", "industry"],
  ["qa-cd", "QA CD Sampling", "CD", ""], ["qa-a", "QA Accounts A", "ACCOUNTS", "A"],
  ["qa-b", "QA Accounts B", "ACCOUNTS", "B"], ["qa-m", "QA Material and Unit", "MATERIAL", ""]];
const keys = Object.keys(FIELDS);
function fixture(date: string, alter = 0) {
  return excel([keys.map(key => FIELDS[key][0]), ...Array.from({ length: 180 }, (_, i) => {
    const result = i === alter && alter ? "Leakage" : i % 37 === 0 ? "Leakage" : i % 29 === 0 ? "Mislabeled" : i % 17 === 0 ? "False_Positive" : "Correct";
    const values: Record<string, Cell> = { qaId: `${date}-${i}`, auditId: `audit-${i}`, date, agentId: String(i), agentName: `QA Agent ${String(i).padStart(3, "0")}`,
      queueId: i < 20 ? "qa-cd" : i < 80 ? "qa-a" : i < 140 ? "qa-b" : "qa-m", sampling: 1, allow: i % 3 ? 1 : 0, labeled: i % 3 ? 0 : 1,
      leakage: Number(result === "Leakage"), falsePositive: Number(result === "False_Positive"), mislabeled: Number(result === "Mislabeled"), result };
    return keys.map(key => values[key]);
  })]);
}

test("only active ADM/WFM can access the page, APIs and shared reports", () => {
  for (const role of ["ADMIN", "WFM", "SUPERVISOR", "GESTOR", "QUALIDADE", "COLABORADOR", "POC", "CLIENT", "FINANCEIRO"]) {
    const expected = role === "ADMIN" || role === "WFM";
    assert.equal(hasQualityWeeklyAccess({ ...author, email: "qa@example.invalid", role, status: "ACTIVE" }), expected);
    assert.equal(canAccessPathForRole("/api/quality-weekly/reports/any/document", { role, status: "ACTIVE" }), expected);
    assert.equal(getNavItems({ role, status: "ACTIVE" }).some(item => item.href === "/weekly-quality-report"), expected);
  }
  assert.equal(hasQualityWeeklyAccess({ ...author, email: "qa@example.invalid", role: "ADMIN", status: "INACTIVE" }), false);
  assert.equal(hasQualityWeeklyAccess({ ...author, email: "qa@example.invalid", role: "WFM", status: "ACTIVE", deletedAt: new Date() }), false);
});

test("actual worksheet cells are read after patching the declared dimension to A1", async () => {
  const zip = await JSZip.loadAsync(fixture("2030-12-23"));
  const xml = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  zip.file("xl/worksheets/sheet1.xml", xml.replace(/<dimension ref="[^"]+"\s*\/>/, '<dimension ref="A1"/>'));
  const table = readTables(await zip.generateAsync({ type: "uint8array" }), "fixture.xlsx")[0];
  assert.equal(table.rows.length, 180);
});

test("PostgreSQL full flow: immutable mapping, source, preview, Word, idempotency and concurrent revisions", { skip: !process.env.QUALITY_QA_DATABASE_URL }, async () => {
  const url = new URL(process.env.QUALITY_QA_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "Synthetic integration tests must NEVER target a remote database");
  assert.match(url.pathname, /quality_qa/);
  const db = new PrismaClient({ datasourceUrl: url.toString() });
  await db.$executeRawUnsafe('TRUNCATE "QualityWeeklyHead", "QualityWeeklyReport", "QualityWeeklyDraft", "QualityWeeklyImport", "QualityWeeklyMapping", "QualityWeeklyAsset"');
  const blobs = new Map<string, Uint8Array>();
  const store = { read: async (path: string) => { const value = blobs.get(path); if (!value) throw new Error("Missing object"); return new Uint8Array(value); },
    write: async (path: string, data: Uint8Array) => { if (blobs.has(path)) throw new Error("Immutable object already exists"); blobs.set(path, new Uint8Array(data)); } };
  const service = createQualityWeeklyService(db, store);
  async function source(bytes: Uint8Array, kind: "source" | "mapping" = "source") {
    const asset = await service.transfer(`QA synthetic ${kind}.xlsx`, bytes.length, kind, author);
    await store.write(asset.objectPath, bytes);
    return asset;
  }
  async function upload(date: string, alter = 0) {
    const asset = await source(fixture(date, alter));
    const imported = await service.importAsset(asset.id, author);
    assert.equal(imported.validation.valid, true);
    return imported;
  }
  async function preview(date: string, alter = 0) {
    const imported = await upload(date, alter);
    return service.preview({ uploadId: imported.id, start: date, weekNumber: 52, complete: true }, author);
  }
  const isStatus = (status: number) => (error: unknown) => error instanceof QualityWeeklyError && error.status === status;
  try {
    const mapAsset = await source(excel(maps), "mapping");
    const firstMap = await service.mapping(mapAsset.id, author);
    const sameMap = await service.mapping((await source(excel(maps), "mapping")).id, author);
    assert.equal(sameMap.unchanged, true); assert.equal(sameMap.id, firstMap.id);
    const incompleteRows: Cell[][] = [maps[0], ["qa-a", "QA Accounts A", "ACCOUNTS", ""], ["qa-u", "QA Unit", "Unit", ""]];
    const incomplete = await service.mapping((await source(excel(incompleteRows), "mapping")).id, author);
    assert.equal(incomplete.pendingCount, 1);
    assert.equal(incomplete.entries.find(m => m.queueId === "qa-u")?.category, "Unit");
    const repeatIncomplete = await service.mapping((await source(excel(incompleteRows), "mapping")).id, author);
    assert.equal(repeatIncomplete.id, incomplete.id);
    const pendingSource = await service.importAsset((await source(fixture("2030-12-23"))).id, author);
    assert.equal(pendingSource.validation.valid, false);
    await assert.rejects(() => service.preview({ uploadId: pendingSource.id, start: "2030-12-23", weekNumber: 52, complete: true }, author), isStatus(422));
    const conflict = await source(excel([maps[0], ["qa-u", "QA Unit", "Unit", ""], ["qa-u", "QA Unit", "Material", ""]]), "mapping");
    await assert.rejects(() => service.mapping(conflict.id, author), isStatus(422));
    assert.equal((await service.currentMapping())?.id, incomplete.id);
    const optionalRows = maps.map(row => row[0] === 'qa-m' ? [row[0], 'QA queue without classification', '', ''] : row);
    const optionalMap = await service.mapping((await source(excel(optionalRows), 'mapping')).id, author);
    assert.equal(optionalMap.pendingCount, 0);
    const optionalImport = await upload('2030-12-23');
    const optionalPreview = await service.preview({ uploadId: optionalImport.id, start: '2030-12-23', weekNumber: 52, complete: true }, author);
    assert.equal(optionalPreview.snapshot.metrics.n, 180);
    assert.equal(optionalPreview.snapshot.sections.OTHER?.metrics.n, 40);
    assert.equal(optionalPreview.snapshot.sections.MATERIAL.metrics.n, 0);
    assert.equal(optionalPreview.snapshot.mappings.find(m => m.queueId === 'qa-m')?.section, null);
    const optionalWord = await JSZip.loadAsync(await renderQualityWord(optionalPreview.snapshot, 'https://eastriverbrasil.com'));
    assert.match(await optionalWord.file('word/document.xml')!.async('string'), /Other queues Review/);
    assert.match(await optionalWord.file('word/document.xml')!.async('string'), /QA queue without classification/);
    assert.match(await optionalWord.file('word/_rels/document.xml.rels')!.async('string'), /section=OTHER/);
    await service.mapping((await source(excel(maps), "mapping")).id, author);
    await assert.rejects(() => service.inspect(mapAsset.id, { id: "other", name: "Other" }), isStatus(404));
    const legacyPath = process.env.QA_SOURCE;
    if (legacyPath) {
      const legacy = await service.importAsset((await source(new Uint8Array(await readFile(legacyPath)))).id, author);
      assert.equal(legacy.validation.rows, 9291); assert.equal(legacy.validation.valid, false);
      await assert.rejects(() => service.preview({ uploadId: legacy.id, start: "2026-08-24", weekNumber: 34, complete: true }, author), isStatus(422));
    }
    const date = "2030-12-23";
    const prior = await preview("2030-12-16");
    await service.commit({ draftId: prior.draftId, complete: true, replace: false }, author);
    const draft = await preview(date);
    assert.equal(draft.snapshot.metrics.n, 180); assert.equal(draft.snapshot.trend[0].CD, null);
    assert.equal(draft.snapshot.sections.ACCOUNTS.agents.length, 120);
    await assert.rejects(() => service.commit({ draftId: draft.draftId, complete: false, replace: false }, author), isStatus(400));
    await assert.rejects(() => service.commit({ draftId: draft.draftId, complete: true, replace: false }, { id: "other", name: "Other" }), isStatus(404));
    const first = await service.commit({ draftId: draft.draftId, complete: true, replace: false }, author);
    const saved = (await service.report(first.id)).snapshot;
    assert.deepEqual(saved, draft.snapshot);
    const same = await preview(date);
    assert.equal(same.unchanged, true);
    assert.equal((await service.commit({ draftId: same.draftId, complete: true, replace: false }, author)).id, first.id);
    const [a, b] = await Promise.all([preview(date, 1), preview(date, 2)]);
    await assert.rejects(() => service.commit({ draftId: a.draftId, complete: true, replace: false }, author), isStatus(409));
    const race = await Promise.allSettled([service.commit({ draftId: a.draftId, complete: true, replace: true }, author), service.commit({ draftId: b.draftId, complete: true, replace: true }, author)]);
    assert.equal(race.filter(r => r.status === "fulfilled").length, 1);
    const rejected = race.find(r => r.status === "rejected") as PromiseRejectedResult;
    assert.equal(rejected.reason.status, 409);
    const active = (await service.history()).reports.find(r => r.weekStart === date && r.active)!.id;
    await service.commit({ draftId: draft.draftId, complete: true, replace: true }, author);
    assert.equal((await service.history()).reports.find(r => r.weekStart === date && r.active)!.id, active);
    assert.deepEqual((await service.report(saved.id)).snapshot, saved);
    const staleContext = await preview(date, 3);
    const priorUpdate = await preview("2030-12-16", 4);
    await service.commit({ draftId: priorUpdate.draftId, complete: true, replace: true }, author);
    await assert.rejects(() => service.commit({ draftId: staleContext.draftId, complete: true, replace: true }, author), isStatus(409));
    await service.mapping((await source(excel(maps.map((row, i) => i ? [row[0], `${row[1]} renamed`, row[2], row[3]] : row)), "mapping")).id, author);
    const revalidated = await service.revalidate(saved.uploadId, author);
    assert.notEqual(revalidated.mappingId, saved.mappingId);
    assert.deepEqual((await service.report(saved.id)).snapshot, saved);
    const word = await renderQualityWord(saved, "https://eastriverbrasil.com");
    const zip = await JSZip.loadAsync(word);
    const xml = await zip.file("word/document.xml")!.async("string");
    assert.match(xml, /QA Agent 020/); assert.match(xml, /QA Agent 139/); assert.doesNotMatch(xml, /RCA|Root Cause/);
    const links = await zip.file("word/_rels/document.xml.rels")!.async("string");
    assert.match(links, new RegExp(`weekly-quality-report\\?report=${saved.id}`));
    assert.match(links, /section=CD/); assert.match(links, /section=MATERIAL/);
    assert.equal(Object.keys(zip.files).filter(name => /^word\/media\/.+png$/.test(name)).length, 2);
    if (process.env.QUALITY_QA_OUTPUT) {
      await writeFile(`${process.env.QUALITY_QA_OUTPUT}/quality-weekly-synthetic.docx`, word);
      await writeFile(`${process.env.QUALITY_QA_OUTPUT}/snapshot.json`, JSON.stringify(saved));
      await writeFile(`${process.env.QUALITY_QA_OUTPUT}/source-fixture.xlsx`, fixture(date));
      await writeFile(`${process.env.QUALITY_QA_OUTPUT}/mapping-fixture.xlsx`, excel(maps));
    }
    // Cursor traverses history beyond the first 50; older reports are never silently truncated.
    await db.qualityWeeklyReport.createMany({ data: Array.from({ length: 55 }, (_, i) => ({ id: randomUUID(), weekStart: "2031-01-06", weekNumber: 1, version: i + 1,
      importId: saved.uploadId, snapshot: JSON.stringify(saved), contentHash: `qa-${i}`, createdById: author.id, createdBy: author.name })) });
    const page = await service.history(); assert.equal(page.reports.length, 50); assert.ok(page.next);
    const next = await service.history(page.next!); assert.ok(next.reports.length > 0);
    assert.equal(page.reports.filter(a => next.reports.some(b => a.id === b.id)).length, 0);
  } finally { await db.$disconnect(); }
});
