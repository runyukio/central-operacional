import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import {
  aggregate,
  analyze,
  buildSections,
  buildAgents,
  dateValue,
  dayAdd,
  FIELDS,
  metrics,
  emptyCounts,
  parseMapping,
  rate,
  weekStart,
  change,
  RULE_VERSION,
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
  headers: [...headers],
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
void test('Correct counts once whenever present, before or after another result', () => {
  const rows = [record(), record({ result: 'Leakage', leakage: 1 })];
  for (const ordered of [rows, [...rows].reverse()]) {
    const result = analyze(table(ordered), mapping);
    assert.equal(result.valid, true);
    assert.equal(result.errorCount, 0);
    assert.equal(result.resultVariations, 1);
    assert.match(result.issues[0].message, /regardless of Excel row order/);
    assert.deepEqual(result.cases[0].results, ['Correct', 'Leakage']);
    assert.equal(result.cases[0].result, 'Correct');
    const m = aggregate(result.cases);
    assert.equal(m.n, 1);
    assert.equal(m.correct, 1);
    assert.equal(m.leakage, 1);
    assert.equal(m.allow, 1);
    assert.equal(m.accuracy, 1);
  }
});
void test('each outcome is distinct per key even with repeated and interleaved result rows', () => {
  const rows = [record(), record({ result: 'Leakage', leakage: 1 }),
    record({ result: 'False_Positive', falsePositive: 1 }), record({ result: 'Mislabeled', mislabeled: 1 })];
  const result = analyze(table([...rows, ...rows].reverse()), mapping);
  assert.equal(result.valid, true);
  assert.equal(result.duplicates, 4);
  assert.equal(result.resultVariations, 3);
  assert.deepEqual(result.cases[0].results, ['Correct', 'Leakage', 'False_Positive', 'Mislabeled']);
  const m = aggregate(result.cases);
  assert.deepEqual([m.n, m.correct, m.leakage, m.falsePositive, m.mislabeled], [1, 1, 1, 1, 1]);
  // Preserve the existing additive adjusted formula, not an implicit result union.
  assert.equal(m.adjustedAccuracy, 2);
});
void test('different error results without Correct do not invent a Correct outcome', () => {
  const result = analyze(table([record({ result: 'Leakage', leakage: 1 }), record({ result: 'Mislabeled', mislabeled: 1 })]), mapping);
  assert.equal(result.valid, true);
  assert.equal(aggregate(result.cases).accuracy, 0);
  assert.equal(aggregate(result.cases).n, 1);
});
void test('a Correct row cannot bypass conflicts in case identity or base amounts', () => {
  for (const override of [{ date: '2026-08-25' }, { agentId: '18' }, { agentName: 'Agent B' },
    { queueId: 'a' }, { allow: 0, labeled: 1 }] as Record<string, Cell>[]) {
    const result = analyze(table([record(), record({ ...override, result: 'Leakage', leakage: 1 })]), mapping);
    assert.equal(result.valid, false);
    assert.equal(result.distinctCounts, null);
    assert.match(result.issues[0].message, /conflicting/);
    assert.match(result.issues[0].message, /Excel row 2/);
  }
  assert.equal(analyze(table([record(), record({ result: 'Correct', leakage: 1 })]), mapping).valid, false);
});
void test('canonical outcomes and grouped metrics are independent of row order', () => {
  const rows = [record(), record({ result: 'Leakage', leakage: 1 }), record({ qaId: 'qa2', queueId: 'a', agentId: '18', agentName: 'Agent B' })];
  const first = analyze(table(rows), mapping), last = analyze(table([...rows].reverse()), mapping);
  const canonical = (analysis: typeof first) => analysis.cases.map(({ sourceRow: _row, ...c }) => c).sort((a, b) => a.qaId.localeCompare(b.qaId));
  assert.deepEqual(canonical(first), canonical(last));
  assert.equal(buildSections(first.cases).MATERIAL.metrics.n, 1);
  assert.equal(buildSections(first.cases).MATERIAL.agents[0].correct, 1);
  assert.equal(buildAgents(first.cases).find(a => a.name === 'Agent A')?.accuracy, 1);
  assert.equal(aggregate(first.cases).accuracy, 1);
  assert.equal(RULE_VERSION, 'quality-weekly-v7');
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
void test('KwaiBI moderation date header is recognized without conflating the two case IDs', () => {
  for (const header of ['audit_time(年月日)', 'audit_time（年月日）']) {
    const original = table([record({ qaId: '00001234', auditId: '00005678', date: 46258 })]);
    const t = { ...original, headers: original.headers.map((h, i) => keys[i] === 'date' ? header : h) };
    const result = analyze(t, mapping);
    assert.equal(result.valid, true);
    assert.equal(result.cases[0].date, '2026-08-24');
    assert.equal(result.cases[0].qaId, '00001234');
    assert.equal(result.cases[0].auditId, '00005678');
    const withoutAudit = { ...t, headers: t.headers.filter((_, i) => keys[i] !== 'auditId'), rows: t.rows.map(r => r.filter((_, i) => keys[i] !== 'auditId')) };
    const rejected = analyze(withoutAudit, mapping);
    assert.equal(rejected.valid, false);
    assert.ok(rejected.issues.some(issue => issue.field === 'auditId'));
    assert.ok(!rejected.issues.some(issue => issue.field === 'date'));
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
void test('overlapping outcomes reconcile with distinct summary amounts', () => {
  const summary = record({ agentId: '汇总', qaId: '', result: '', leakage: 1 });
  const r = analyze(table([summary, record(), record({ result: 'Leakage', leakage: 1 }), record()]), mapping);
  assert.equal(r.valid, true);
  assert.equal(r.sourceCounts.n, 3);
  assert.equal(r.distinctCounts?.n, 1);
  assert.equal(r.distinctCounts?.correct, 1);
  assert.equal(r.distinctCounts?.leakage, 1);
});
void test('one summary mismatch does not switch other controls back to duplicated row counts', () => {
  const summary = record({ agentId: '汇总', qaId: '', result: '', sampling: 2 });
  const r = analyze(table([summary, record(), record()]), mapping);
  assert.equal(r.valid, false);
  assert.equal(r.errorCount, 1);
  assert.equal(r.distinctCounts?.n, 1);
  assert.match(r.issues.find(i => i.severity === 'error')!.message, /total for n/);
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
  assert.deepEqual(r.dates[0].days, ['2026-08-24']);
  assert.equal(r.dates[0].end, '2026-08-28');
  assert.equal(r.dates[0].count, 1);
  assert.equal(r.weekendCases, 1);
  assert.equal(r.distinctCounts?.n, 2, 'source reconciliation still includes the weekend');
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
void test('formatted numeric KwaiBI dates keep their calendar date and remain serializable', () => {
  const w = XLSX.utils.book_new();
  const h = headers.map((v, i) => keys[i] === 'date' ? 'audit_time(年月日)' : v);
  const s = XLSX.utils.aoa_to_sheet([h, record({ date: 46272 })]);
  s[XLSX.utils.encode_cell({ r: 1, c: keys.indexOf('date') })].z = 'yyyy-MM-dd';
  XLSX.utils.book_append_sheet(w, s, 'Data');
  const parsed = selectTable(readTables(XLSX.write(w, { type: 'buffer', bookType: 'xlsx' }), 'fixture.xlsx'));
  assert.equal(parsed.rows[0][keys.indexOf('date')], 46272);
  const result = analyze(parsed, mapping);
  assert.equal(result.valid, true);
  assert.equal(result.cases[0].date, '2026-09-07');
});
void test(
  'provided result-variation export matches the confirmed distinct Correct formula',
  { skip: !process.env.QA_RESULT_VARIANTS_SOURCE },
  () => {
    const t = selectTable(readTables(readFileSync(process.env.QA_RESULT_VARIANTS_SOURCE!), 'kwai.xlsx'));
    const queueIndex = t.headers.indexOf('audit_queue_id');
    // Test-only mappings exercise whole-file counts without inferring an operational de-para.
    const queues = [...new Set(t.rows.map(r => String(r[queueIndex] || '')).filter(Boolean))];
    const testMapping: Mapping[] = queues.map(queueId => ({ queueId, queueName: `Test queue ${queueId}`, section: 'MATERIAL', industry: null }));
    const r = analyze(t, testMapping);
    assert.equal(r.valid, true, JSON.stringify(r.issues));
    assert.equal(r.rows, 9705);
    assert.equal(r.cases.length, 9665);
    assert.equal(r.resultVariations, 40);
    assert.equal(r.duplicates, 0);
    const m = aggregate(r.cases);
    for (const [key, value] of Object.entries({ n: 9665, correct: 9119, allow: 6678, labeled: 2987, leakage: 202, falsePositive: 70, mislabeled: 314 })) {
      assert.equal(m[key as keyof typeof m], value, key);
    }
    assert.equal(rate(m.accuracy), '94.35%');
    assert.equal(rate(m.adjustedAccuracy), '97.60%');
    assert.equal(r.errorCount, 0);
    assert.equal(r.warningCount, 2);
    assert.deepEqual(r.distinctCounts, m);
    const reversed = analyze({ ...t, rows: [...t.rows].reverse(), rowNumbers: [...t.rowNumbers].reverse() }, testMapping);
    assert.equal(reversed.valid, true);
    assert.deepEqual(aggregate(reversed.cases), m);
  },
);
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
