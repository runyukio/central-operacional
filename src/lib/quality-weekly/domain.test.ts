import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import {
  aggregate,
  analyze,
  buildSections,
  dateValue,
  dayAdd,
  FIELDS,
  metrics,
  emptyCounts,
  parseMapping,
  rate,
  weekStart,
  change,
} from './domain';
import type { Cell, Mapping, SourceTable } from './domain';
import { readTables, selectTable } from './workbook';

const keys = Object.keys(FIELDS),
  headers = keys.map((k) => FIELDS[k][0]);
const mapping: Mapping[] = [
  {
    queueId: 'q1',
    queueName: 'Material Brazil',
    section: 'MATERIAL',
    industry: null,
  },
  { queueId: 'a', queueName: 'Accounts A', section: 'ACCOUNTS', industry: 'A' },
  { queueId: 'b', queueName: 'Accounts B', section: 'ACCOUNTS', industry: 'B' },
];
const record = (overrides: Record<string, Cell> = {}) => {
  const base: Record<string, Cell> = {
    qaId: 'qa1',
    auditId: 'audit1',
    date: '2026-08-24',
    agentId: '17',
    agentName: 'Agent A',
    queueId: 'q1',
    sampling: 1,
    allow: 1,
    labeled: 0,
    leakage: 0,
    falsePositive: 0,
    mislabeled: 0,
    result: 'Correct',
    ...overrides,
  };
  return keys.map((k) => base[k]);
};
const table = (rows: Cell[][]): SourceTable => ({
  sheet: 'Data',
  headers,
  rows,
  rowNumbers: rows.map((_, i) => i + 2),
});
void test('official distinct pair count and adjusted accuracy preserve mislabeled denominator', () => {
  const result = analyze(
    table([
      record(),
      record({ qaId: 'qa2', result: 'Mislabeled', mislabeled: 1 }),
      record({ qaId: 'qa3', result: 'Leakage', leakage: 1 }),
    ]),
    mapping,
  );
  assert.equal(result.valid, true);
  const m = aggregate(result.cases);
  assert.equal(m.n, 3);
  assert.equal(m.accuracy, 1 / 3);
  assert.equal(m.adjustedAccuracy, 2 / 3);
  assert.equal(m.leakageRate, 1 / 3);
  assert.equal(m.falsePositiveRate, null);
});
void test('identical duplicates count once, different audit IDs remain different cases', () => {
  const result = analyze(
    table([record(), record(), record({ auditId: 'audit2' })]),
    mapping,
  );
  assert.equal(result.valid, true);
  assert.equal(result.duplicates, 1);
  assert.equal(result.cases.length, 2);
});
void test('conflicting results for a pair block generation', () => {
  const result = analyze(
    table([record(), record({ result: 'Leakage', leakage: 1 })]),
    mapping,
  );
  assert.equal(result.valid, false);
  assert.match(result.issues[0].message, /conflicting/);
});
void test('concatenation collisions are rejected', () => {
  const result = analyze(
    table([
      record({ qaId: '12', auditId: '3' }),
      record({ qaId: '1', auditId: '23' }),
    ]),
    mapping,
  );
  assert.equal(result.valid, false);
  assert.match(result.issues[0].message, /collision/);
});
void test('missing IDs and long imprecise numeric IDs are rejected', () => {
  for (const bad of ['', null, 'null', 9007199254740992]) {
    assert.equal(analyze(table([record({ qaId: bad })]), mapping).valid, false);
  }
});
void test('long IDs stored as strings are preserved exactly', () => {
  const id = '123456789012345678901';
  const r = analyze(table([record({ qaId: id })]), mapping);
  assert.equal(r.valid, true);
  assert.equal(r.cases[0].qaId, id);
});
void test('both required new columns block legacy exports', () => {
  const t = table([record()]);
  for (const k of ['qaId', 'auditId', 'date']) {
    const i = keys.indexOf(k);
    const altered = {
      ...t,
      headers: t.headers.filter((_, j) => i !== j),
      rows: t.rows.map((r) => r.filter((_, j) => i !== j)),
    };
    assert.equal(analyze(altered, mapping).valid, false);
  }
});
void test('null agent IDs do not merge different names', () => {
  const r = analyze(
    table([
      record({ agentId: 'null', agentName: 'Agent A' }),
      record({ qaId: '2', agentId: 'null', agentName: 'Agent B' }),
    ]),
    mapping,
  );
  assert.equal(r.valid, true);
  assert.equal(buildSections(r.cases).MATERIAL.agents.length, 2);
});
void test('False Positive on Allow stays in the numerator even with a zero row denominator', () => {
  const r = analyze(
    table([
      record({ result: 'False_Positive', falsePositive: 1 }),
      record({ qaId: '2', allow: 0, labeled: 1 }),
    ]),
    mapping,
  );
  assert.equal(r.valid, true);
  assert.equal(aggregate(r.cases).falsePositiveRate, 1);
});
void test('rates use total counts instead of an average of subgroup rates', () => {
  const rows = [
    record({ queueId: 'a', result: 'Leakage', leakage: 1 }),
    ...Array.from({ length: 9 }, (_, i) =>
      record({ queueId: 'b', qaId: 'b' + i }),
    ),
  ];
  const r = analyze(table(rows), mapping),
    s = buildSections(r.cases);
  assert.equal(s.ACCOUNTS.metrics.accuracy, 0.9);
  assert.notEqual(s.ACCOUNTS.metrics.accuracy, 0.5);
});
void test('zero denominators give N/A and zero numerators with volume stay zero', () => {
  assert.equal(rate(metrics(emptyCounts()).accuracy), 'N/A');
  assert.equal(
    rate(aggregate(analyze(table([record()]), mapping).cases).leakageRate),
    '0.00%',
  );
});
void test('summary is excluded and matched to deduplicated totals', () => {
  const summary = record({
    agentId: '汇总',
    qaId: '',
    auditId: '',
    date: '',
    agentName: '',
    queueId: '',
    result: '',
  });
  const r = analyze(table([summary, record(), record()]), mapping);
  assert.equal(r.valid, true);
  assert.equal(r.summaryRows, 1);
  assert.equal(r.cases.length, 1);
  assert.equal(r.controlTotals[0].n, 1);
});
void test('mismatching control totals block an incomplete export', () => {
  const r = analyze(
    table([record({ agentId: '汇总', qaId: '', sampling: 5 }), record()]),
    mapping,
  );
  assert.equal(r.valid, false);
  assert.ok(r.issues.some((i) => i.field === 'summary'));
});
void test('blank required numeric amounts are not interpreted as zero', () => {
  assert.equal(
    analyze(table([record({ leakage: null })]), mapping).valid,
    false,
  );
});
void test('unknown outcomes and inconsistent amounts are rejected', () => {
  assert.equal(
    analyze(table([record({ result: 'Pending' })]), mapping).valid,
    false,
  );
  assert.equal(
    analyze(table([record({ result: 'Correct', leakage: 1 })]), mapping).valid,
    false,
  );
  assert.equal(
    analyze(table([record({ allow: 1, labeled: 1 })]), mapping).valid,
    false,
  );
});
void test('unmapped queue IDs block reporting', () => {
  const r = analyze(table([record({ queueId: 'unknown' })]), mapping);
  assert.equal(r.valid, false);
  assert.deepEqual(r.unknownQueues, ['unknown']);
});
void test('dates handle Sunday, Monday and year boundaries without ISO numbering', () => {
  assert.equal(weekStart('2026-08-30'), '2026-08-24');
  assert.equal(weekStart('2026-08-31'), '2026-08-31');
  assert.equal(weekStart('2027-01-01'), '2026-12-28');
  assert.equal(dayAdd('2026-12-28', 6), '2027-01-03');
  assert.equal(dateValue('30/08/2026'), '2026-08-30');
  assert.equal(dateValue('2026-02-30'), '');
  assert.equal(dateValue('2026-08-30T23:59:00-03:00'), '2026-08-30');
  assert.equal(change(0.97, 0.965), '+0.50 pp');
});
void test('sparse week exposes observed days for explicit completeness confirmation', () => {
  const r = analyze(
    table([record(), record({ qaId: '2', date: '2026-08-30' })]),
    mapping,
  );
  assert.deepEqual(r.dates[0].days, ['2026-08-24', '2026-08-30']);
});
void test('mapping requires unique queue classifications and Accounts industry', () => {
  const t: SourceTable = {
    sheet: 'Map',
    headers: ['queue_id', 'queue_name', 'section', 'industry'],
    rows: [
      ['1', 'Recall', 'CD', ''],
      ['1', 'Recall', 'MATERIAL', ''],
    ],
    rowNumbers: [2, 3],
  };
  assert.equal(parseMapping(t).issues.length, 1);
  t.rows = [['1', 'Accounts', 'ACCOUNTS', '']];
  assert.equal(parseMapping(t).issues.length, 1);
  t.rows = [['1', 'Accounts', 'ER Accounts', 'Industry A']];
  assert.equal(parseMapping(t).mappings[0].industry, 'A');
});
void test('duplicate normalized headers are rejected', () => {
  const t = table([record()]);
  t.headers.push('final_result');
  assert.equal(analyze(t, mapping).valid, false);
});
void test('parser reads actual cells when a workbook declares A1 only', () => {
  const w = XLSX.utils.book_new();
  const s = XLSX.utils.aoa_to_sheet([headers, record(), record({ qaId: '2' })]);
  XLSX.utils.book_append_sheet(w, s, 'Data');
  const bytes = XLSX.write(w, { type: 'buffer', bookType: 'xlsx' });
  const parsed = selectTable(readTables(bytes, 'fixture.xlsx'));
  assert.equal(parsed.rows.length, 2);
});
void test('row references include leading blank rows', () => {
  const w = XLSX.utils.book_new();
  const s = XLSX.utils.aoa_to_sheet([[], [], headers, record()]);
  XLSX.utils.book_append_sheet(w, s, 'Data');
  const parsed = selectTable(
    readTables(
      XLSX.write(w, { type: 'buffer', bookType: 'xlsx' }),
      'fixture.xlsx',
    ),
  );
  assert.equal(parsed.rowNumbers[0], 4);
});
void test('1904 Excel date system is normalized when cells are dates', () => {
  const w = XLSX.utils.book_new();
  const s = XLSX.utils.aoa_to_sheet([headers, record({ date: 44796 })]);
  const cell = s[XLSX.utils.encode_cell({ r: 1, c: keys.indexOf('date') })];
  cell.z = 'yyyy-mm-dd';
  w.Workbook = { WBProps: { date1904: true } };
  XLSX.utils.book_append_sheet(w, s, 'Data');
  const parsed = selectTable(
    readTables(
      XLSX.write(w, { type: 'buffer', bookType: 'xlsx' }),
      'fixture.xlsx',
    ),
  );
  assert.equal(parsed.rows[0][keys.indexOf('date')], 46258);
});
void test(
  'provided export reconciles all 9291 cases despite incorrect dimensions',
  { skip: !process.env.QA_SOURCE },
  () => {
    const data = readFileSync(process.env.QA_SOURCE!);
    const t = selectTable(readTables(data, 'kwai.xlsx'));
    assert.equal(t.rows.length, 9292);
    const r = analyze(t, []);
    assert.equal(r.rows, 9291);
    assert.equal(r.summaryRows, 1);
    assert.deepEqual(r.sourceCounts, {
      n: 9291,
      correct: 8781,
      allow: 6392,
      labeled: 2899,
      leakage: 182,
      falsePositive: 44,
      mislabeled: 284,
    });
    assert.equal(rate(metrics(r.sourceCounts).accuracy), '94.51%');
    assert.equal(rate(metrics(r.sourceCounts).adjustedAccuracy), '97.57%');
    assert.equal(r.valid, false);
    assert.ok(r.issues.some((i) => i.field === 'date'));
    assert.ok(r.issues.some((i) => i.field === 'auditId'));
  },
);
