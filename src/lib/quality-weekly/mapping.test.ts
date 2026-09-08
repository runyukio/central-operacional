import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, buildSections, FIELDS, mappingPending, parseMapping } from './domain';
import type { Cell, SourceTable } from './domain';

const table = (rows: Cell[][], headers = ['queue_id', 'queue_name', 'section', 'industry']): SourceTable => ({
  sheet: 'Mapping', headers, rows, rowNumbers: rows.map((_, i) => i + 2),
});
const source = (ids: string[]) => {
  const keys = Object.keys(FIELDS);
  const records = ids.map((id, i) => {
    const row: Record<string, Cell> = { qaId: `qa-${i}`, auditId: `audit-${i}`, date: '2026-09-07',
      agentId: 'agent-1', agentName: 'Synthetic agent', queueId: id, sampling: 1,
      allow: 1, labeled: 0, leakage: 0, falsePositive: 0, mislabeled: 0, result: 'Correct' };
    return keys.map(key => row[key]);
  });
  return table(records, keys.map(key => FIELDS[key][0]));
};

test('incomplete uploads preserve categories and only fill registered queue names', () => {
  const parsed = parseMapping(table([
    ['unit-1', null, 'Unit', null], ['unit-1', null, 'Unit', null],
    ['material-1', null, 'Material', null], ['picture-1', null, 'Picture', null],
    ['effect-1', null, 'Efect', null],
  ]), { allowIncomplete: true, queueNames: { 'unit-1': 'Registered Unit', 'material-1': 'Registered Material' } });
  assert.equal(parsed.mappings.length, 4);
  assert.equal(parsed.issues.filter(i => i.severity === 'error').length, 0);
  assert.deepEqual(parsed.mappings.map(m => m.category), ['Unit', 'Material', 'Picture', 'Efect']);
  assert.equal(parsed.mappings[0].queueName, 'Registered Unit');
  assert.equal(parsed.mappings[2].section, null);
  assert.equal(parsed.mappings[2].queueName, '');
  assert.deepEqual(mappingPending(parsed.mappings[2]), ['Queue name', 'Report section']);
  assert.deepEqual(parsed.issues.map(i => i.row), [5, 6]);
});

test('Industry may be omitted during upload, but missing Accounts Industry blocks official results', () => {
  const parsed = parseMapping(table([['account-1', 'Accounts', 'ACCOUNTS']]), { allowIncomplete: true });
  assert.equal(parsed.mappings[0].industry, null);
  assert.equal(parsed.issues[0].severity, 'warning');
  assert.deepEqual(mappingPending(parsed.mappings[0]), ['Industry A/B']);
  const result = analyze(source(['account-1']), parsed.mappings);
  assert.equal(result.valid, false);
  assert.match(result.issues[0].message, /Industry A\/B/);
  assert.equal(result.cases.length, 0);
});

test('Material and Unit need no Industry and remain distinct in calculated categories', () => {
  const parsed = parseMapping(table([
    ['m1', 'Material 1', 'Material', null], ['m2', 'Material 2', 'Material', null],
    ['u1', 'Unit 1', 'Unit', null],
  ]), { allowIncomplete: true });
  assert.equal(parsed.issues.length, 0);
  const result = analyze(source(['m1', 'm2', 'u1']), parsed.mappings);
  assert.equal(result.valid, true);
  const report = buildSections(result.cases).MATERIAL;
  assert.deepEqual(report.categories?.map(r => [r.name, r.n]), [['Material', 2], ['Unit', 1]]);
  assert.equal(report.metrics.n, 3);
  assert.equal(report.queues?.length, 3);
});

test('pending section or name cannot silently drop cases or become official zero results', () => {
  for (const row of [['p1', 'Picture', 'Picture', null], ['p1', null, 'Material', null]]) {
    const parsed = parseMapping(table([row]), { allowIncomplete: true });
    const result = analyze(source(['p1']), parsed.mappings);
    assert.equal(result.valid, false);
    assert.equal(result.sourceCounts.n, 1);
    assert.equal(result.cases.length, 0);
  }
});

test('conflicting categories, invalid Industries and imprecise IDs still block mapping upload', () => {
  for (const rows of [
    [['1', 'Queue', 'Material', null], ['1', 'Queue', 'Unit', null]],
    [['1', 'Accounts', 'ACCOUNTS', 'C']],
    [['1', 'Material', 'Material', 'A']],
    [[9007199254740992, 'Queue', 'Unit', null]],
  ]) assert.ok(parseMapping(table(rows), { allowIncomplete: true }).issues.some(i => i.severity === 'error'));
});

test('names and Industry columns may be omitted, official section and category stay independent', () => {
  const parsed = parseMapping(table([['1', 'CD', 'Recall']], ['queue_id', 'section', 'category']), {
    allowIncomplete: true, queueNames: { '1': 'Registered recall queue' },
  });
  assert.deepEqual(parsed.mappings[0], { queueId: '1', queueName: 'Registered recall queue', section: 'CD', industry: null, category: 'Recall' });
  assert.equal(parsed.issues.length, 0);
});

test('blank or duplicate required columns never bypass mapping validation', () => {
  assert.ok(parseMapping(table([['1', 'Q', '', '']]), { allowIncomplete: true }).issues.some(i => i.severity === 'error'));
  assert.ok(parseMapping(table([], ['queue_id', 'queue id', 'section']), { allowIncomplete: true }).issues.some(i => i.severity === 'error'));
});
