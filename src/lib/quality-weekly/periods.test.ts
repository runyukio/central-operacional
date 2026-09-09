import test from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { writeFile } from 'node:fs/promises';
import { analyze, buildUploadTrend, casesInReportingWeek, FIELDS, isReportingDay, RULE_VERSION } from './domain';
import type { Cell, MappingEntry, Snapshot } from './domain';
import { createQualityWeeklyService, sha256 } from './service';
import { renderQualityWord } from './document';
import { chartSpec } from './charts';

const keys = Object.keys(FIELDS);
const headers = keys.map(k => FIELDS[k][0]);
const mapping: MappingEntry[] = [{ queueId: 'q', queueName: 'Synthetic queue', section: 'MATERIAL', industry: null, category: 'Recall' }];
const row = (date: string, id: string, result = 'Correct') => {
  const values: Record<string, Cell> = { date, qaId: id, auditId: 'audit', agentId: 'agent', agentName: 'Synthetic agent',
    queueId: 'q', sampling: 1, allow: 1, labeled: 0, result, leakage: Number(result === 'Leakage'),
    falsePositive: Number(result === 'False_Positive'), mislabeled: Number(result === 'Mislabeled') };
  return keys.map(k => values[k]);
};
function analysis(rows: Cell[][]) {
  return analyze({ sheet: 'Data', headers, rows, rowNumbers: rows.map((_, i) => i + 2) }, mapping);
}
function workbook(rows: Cell[][]) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([headers, ...rows]), 'Data');
  return new Uint8Array(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
}

test('week selection includes Monday and Friday, excludes weekends without changing reconciliation', () => {
  const rows = ['2026-08-28', '2026-08-29', '2026-08-30', '2026-08-31', '2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07'].map(d => row(d, d));
  const data = analysis(rows);
  assert.equal(data.valid, true);
  assert.equal(data.distinctCounts?.n, 8);
  assert.equal(data.weekendCases, 4);
  assert.deepEqual(data.dates.map(d => [d.start, d.end, d.count]), [
    ['2026-08-24', '2026-08-28', 1], ['2026-08-31', '2026-09-04', 2], ['2026-09-07', '2026-09-11', 1],
  ]);
  assert.equal(casesInReportingWeek(data.cases, '2026-08-31').length, 2);
  assert.equal(isReportingDay('2026-09-06'), false);
  assert.deepEqual(analysis([row('2026-09-06', 'weekend-only')]).dates, []);
});

test('periods cross month, leap-day and year boundaries without inventing week numbers', () => {
  const data = analysis([row('2028-02-29', 'leap'), row('2026-12-31', 'dec'), row('2027-01-01', 'jan')]);
  assert.equal(data.valid, true);
  assert.deepEqual(data.dates.map(d => [d.start, d.end]), [['2026-12-28', '2027-01-01'], ['2028-02-28', '2028-03-03']]);
  const trend = buildUploadTrend(data.cases, '2027-01-04', 2);
  assert.equal(trend.at(-2)?.CD?.n, 2);
  assert.equal(trend.at(-2)?.weekNumber, null);
  assert.equal(trend.at(-1)?.weekNumber, 2);
});

test('history comes from the same upload with gaps and section precedence, not from row order', () => {
  const rows = [row('2026-07-31', 'old'), row('2026-08-28', 'prior', 'Leakage'), row('2026-08-31', 'current'),
    row('2026-09-04', 'friday'), row('2026-09-04', 'friday'), row('2026-09-04', 'friday', 'Mislabeled'), row('2026-09-05', 'weekend')];
  const data = analysis(rows);
  const trend = buildUploadTrend(data.cases, '2026-08-31', 36);
  assert.equal(trend.length, 7);
  assert.equal(trend[1].source, 'upload');
  assert.equal(trend[1].CD?.n, 1);
  assert.equal(trend[2].source, 'missing');
  assert.equal(trend[2].CD, null);
  assert.equal(trend[5].CD?.accuracy, 0);
  assert.equal(trend[6].CD?.n, 2);
  assert.equal(trend[6].CD?.correct, 2);
  assert.equal(trend[6].CD?.mislabeled, 1);
  assert.equal(trend[6].RECALL?.n, 0, 'explicit Material section wins over category Recall');
  assert.deepEqual(trend[6].observedDays, ['2026-08-31', '2026-09-04']);
  assert.deepEqual(buildUploadTrend(analysis([...rows].reverse()).cases, '2026-08-31', 36), trend);
});

function harness() {
  let bytes = new Uint8Array();
  const drafts: { id: string; snapshot: string; contentHash: string; expectations: Record<string, string | null> }[] = [];
  const tx = {
    qualityWeeklyHead: { findMany: async (input: { where: { weekStart: { in: string[] } } }) => {
      assert.deepEqual(input.where.weekStart.in, ['2026-08-31']);
      return [];
    } },
    qualityWeeklyReport: { aggregate: async () => ({ _max: { version: null } }) },
    qualityWeeklyDraft: { create: async ({ data }: { data: typeof drafts[number] }) => { drafts.push(data); return data; } },
  };
  const db = {
    qualityWeeklyImport: { findUnique: async () => ({ id: 'import', mappingId: 'mapping', validation: { valid: true },
      digest: sha256(bytes), sheet: 'Data', mapping: { entries: mapping }, asset: { objectPath: 'source', filename: 'synthetic.xlsx' } }) },
    $transaction: async (callback: (value: typeof tx) => unknown) => callback(tx),
  } as unknown as PrismaClient;
  const service = createQualityWeeklyService(db, { read: async () => bytes, write: async () => undefined });
  return {
    drafts: () => drafts,
    preview: async (rows: Cell[][], start = '2026-08-31') => {
      bytes = workbook(rows);
      return service.preview({ uploadId: 'import', start, weekNumber: 36, complete: true }, { id: 'qa-only', name: 'Synthetic reviewer' });
    },
  };
}

test('server preview uses Friday, automatically adds history, and versions historical-only changes', async () => {
  const h = harness();
  const rows = [row('2026-08-28', 'prior'), row('2026-08-31', 'current'), row('2026-09-05', 'weekend')];
  const a = await h.preview(rows);
  assert.equal(a.snapshot.ruleVersion, RULE_VERSION);
  assert.equal(a.snapshot.end, '2026-09-04');
  assert.equal(a.snapshot.metrics.n, 1);
  assert.equal(a.snapshot.trend.at(-2)?.CD?.n, 1);
  assert.equal(a.snapshot.trend.at(-2)?.reportId, null);
  await h.preview([...rows].reverse());
  assert.equal(h.drafts()[0].contentHash, h.drafts()[1].contentHash);
  await h.preview([row('2026-08-28', 'prior', 'Leakage'), ...rows.slice(1)]);
  assert.notEqual(h.drafts()[0].contentHash, h.drafts()[2].contentHash);
  assert.deepEqual(h.drafts()[0].expectations, { '2026-08-31': null });
  await assert.rejects(() => h.preview(rows, '2026-09-05'), /Select a Monday/);
  await assert.rejects(() => h.preview([row('2026-09-05', 'weekend')]), /No valid cases/);
});

test('CD chart compares four weeks while full history retains seven periods; legacy layouts still work', async () => {
  const snapshot = (await harness().preview([row('2026-08-28', 'prior', 'Leakage'), row('2026-08-31', 'current')])).snapshot;
  const spec = chartSpec(snapshot, 'CD');
  assert.equal(spec.labels.length, 4);
  assert.deepEqual(spec.labels, ['Week 33', 'Week 34', 'Week 35', 'Week 36']);
  assert.equal(chartSpec(snapshot, 'ACCOUNTS').labels.length, 7);
  assert.equal(spec.series[0].values.at(-2), 0);
  assert.equal(spec.series[0].values.at(-1), 1);
  // Material cases also feed the separate CD rollup, without changing global totals.
  const word = await renderQualityWord(snapshot, 'https://example.invalid');
  const zip = await JSZip.loadAsync(word);
  const xml = await zip.file('word/document.xml')!.async('string');
  assert.match(xml, /04\/09\/2026/);
  assert.match(xml, /Monday–Friday/);
  assert.match(xml, /2026-07-20/);
  assert.match(xml, /2026-08-24/);
  assert.match(xml, /\+100.00 pp/);
  if (process.env.QUALITY_PERIOD_OUTPUT) {
    await writeFile(`${process.env.QUALITY_PERIOD_OUTPUT}/periods-synthetic.docx`, word);
    await writeFile(`${process.env.QUALITY_PERIOD_OUTPUT}/snapshot.json`, JSON.stringify(snapshot));
  }
  const old = { ...snapshot, ruleVersion: 'quality-weekly-v4', end: '2026-09-06', trend: snapshot.trend.slice(-4).map(({ source: _s, end: _e, observedDays: _d, ...t }) => t) } as Snapshot;
  const oldXml = await (await JSZip.loadAsync(await renderQualityWord(old, 'https://example.invalid'))).file('word/document.xml')!.async('string');
  assert.match(oldXml, /06\/09\/2026/);
  assert.doesNotMatch(oldXml, /Monday–Friday/);
});
