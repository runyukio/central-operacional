import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { aggregate, buildAgents, buildSections, buildCdSampling, buildUploadTrend, reportSection, RULE_VERSION } from './domain';
import type { Case, Section, Snapshot } from './domain';
import { renderQualityWord } from './document';

test('Word embeds consolidated agent tables for every populated section, not only links', async () => {
  const cases: Case[] = (['ACCOUNTS', 'MATERIAL', 'UNIT', 'RECALL', 'QUICK', 'INSPECTION'] as Section[]).flatMap((section, index) =>
    [0, 1].map(i => ({ sourceRow: index * 2 + i + 2, qaId: `${section}-${i}`, auditId: 'audit', date: '2026-08-31',
      agentId: `agent-${section}`, agentName: `wb_synthetic_${section.toLowerCase()}`, queueId: `${section}-${i}`, queueName: `${section} queue ${i}`,
      section, industry: section === 'ACCOUNTS' ? 'A' as const : null, allow: 1, labeled: 0, result: i ? 'Leakage' as const : 'Correct' as const })));
  const snapshot: Snapshot = { id: 'synthetic-agent-detail', start: '2026-08-31', end: '2026-09-04', weekNumber: 36, version: 1,
    createdAt: '2026-09-09T00:00:00Z', createdBy: 'Synthetic reviewer', ruleVersion: RULE_VERSION,
    uploadId: 'synthetic', mappingId: 'synthetic', mappings: [], filename: 'synthetic.xlsx', digest: 'synthetic',
    metrics: aggregate(cases), sections: buildSections(cases), cdSampling: buildCdSampling(cases), agents: buildAgents(cases), trend: buildUploadTrend(cases, '2026-08-31', 36) };
  const bytes = await renderQualityWord(snapshot, 'https://example.invalid');
  const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml')!.async('string');
  const tables = [...xml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g)].map(m => m[0]);
  for (const section of ['ACCOUNTS', 'MATERIAL', 'UNIT', 'RECALL', 'QUICK', 'INSPECTION'] as Section[]) {
    const agent = `wb_synthetic_${section.toLowerCase()}`;
    const table = tables.find(t => t.includes(agent));
    assert.ok(table, `${section} must embed an agent table`);
    assert.equal(table.split(agent).length - 1, 1, 'same agent in two queues appears once per section');
    assert.match(table, /50.00%/);
    assert.match(table, />2<\/w:t>/);
    if (section !== 'ACCOUNTS') assert.ok(xml.includes(`${section} queue 0`), 'queue-level table remains in Word');
  }
  assert.equal((xml.match(/Breakdown by Agent/g) || []).length, 7);
  assert.doesNotMatch(xml, /CD Sampling Agents/);
  assert.equal(snapshot.cdSampling!.metrics.n, 8);
  assert.equal(snapshot.metrics.n, 12, 'the CD rollup is not added to global totals');
  assert.ok(tables[0].includes('Recall') && tables[0].includes('Inspection'));
  assert.ok(!tables[0].includes('UNIT queue'));
  assert.equal(snapshot.trend.at(-1)?.CD?.n, 8);
  if (process.env.QUALITY_AGENT_OUTPUT) {
    await writeFile(`${process.env.QUALITY_AGENT_OUTPUT}/agent-detail-synthetic.docx`, bytes);
    await writeFile(`${process.env.QUALITY_AGENT_OUTPUT}/snapshot.json`, JSON.stringify(snapshot));
  }
});

test('CD combines exactly four explicit sections, weighted counts and one row per agent', () => {
  const cases: Case[] = (['RECALL', 'MATERIAL', 'QUICK', 'INSPECTION', 'UNIT', 'EFFECT', 'TALENT', 'PICTURE', 'ACCOUNTS', 'CD'] as Section[]).map((section, i) => ({
    sourceRow: i + 2, qaId: String(i), auditId: 'audit', date: '2026-08-31', agentId: 'same-id', agentName: 'same-agent',
    queueId: String(i), queueName: section, section, industry: section === 'ACCOUNTS' ? 'A' : null,
    allow: 1, labeled: 0, result: i === 0 ? 'Leakage' : 'Correct',
  }));
  const block = buildCdSampling(cases);
  assert.deepEqual(block.rows.map(r => r.id), ['RECALL', 'MATERIAL', 'QUICK', 'INSPECTION']);
  assert.equal(block.metrics.n, 4);
  assert.equal(block.metrics.accuracy, .75);
  assert.equal(block.agents.length, 1);
  assert.equal(block.agents[0].n, 4);
  assert.equal(buildCdSampling([]).rows.length, 4);
  assert.equal(buildCdSampling([]).metrics.accuracy, null);
  assert.equal(reportSection({ sections: buildSections(cases), cdSampling: block }, 'CD'), block);
  assert.equal(reportSection({ sections: buildSections(cases) }, 'CD')?.metrics.n, 1, 'legacy snapshot still uses its original CD classification');
});
