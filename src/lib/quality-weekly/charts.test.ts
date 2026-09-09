import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { readFile, writeFile } from 'node:fs/promises';
import { aggregate, buildSections, dayAdd, RULE_VERSION } from './domain';
import type { Snapshot, TrendPoint } from './domain';
import { chartSpec, paintChart } from './charts';
import { renderQualityWord } from './document';

function snapshot(): Snapshot {
  const sample = aggregate([]);
  const dates = ['2026-07-20', '2026-07-27', '2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31'];
  const accuracy = [.9, .9, .9, .9276, .9513, .9554, .9652];
  const adjusted = [.95, .95, .95, .9733, .9801, .9858, .9846];
  return {
    id: 'chart-fixture', start: dates[6], end: '2026-09-04', weekNumber: 34, version: 1,
    ruleVersion: RULE_VERSION, createdBy: 'Synthetic chart check', createdAt: '2026-09-09T00:00:00Z',
    uploadId: 'fixture', mappingId: 'fixture', mappings: [], filename: 'fixture.xlsx', digest: 'fixture',
    metrics: sample, sections: buildSections([]), agents: [],
    trend: dates.map((start, i) => ({ start, end: dayAdd(start, 4), weekNumber: i === 6 ? 34 : null, reportId: null,
      source: 'upload', CD: { ...sample, n: 100, accuracy: accuracy[i], adjustedAccuracy: adjusted[i] },
      ACCOUNTS: null, MATERIAL: null, industryA: null, industryB: null })) as TrendPoint[],
  };
}

test('CD chart has one point per week, selected plus three previous, with manual week numbering', () => {
  const source = snapshot();
  const before = JSON.stringify(source);
  const chart = chartSpec(source, 'CD');
  assert.deepEqual(chart.labels, ['Week 31', 'Week 32', 'Week 33', 'Week 34']);
  assert.deepEqual(chart.series[0].values, [.9276, .9513, .9554, .9652]);
  assert.deepEqual(chart.series[1].values, [.9733, .9801, .9858, .9846]);
  assert.deepEqual(chart.series[2].values, [.95, .95, .95, .95]);
  assert.equal(chart.periods[0].start, '2026-08-10');
  assert.equal(chart.periods[0].end, '2026-08-14');
  assert.equal(chartSpec(source, 'ACCOUNTS').labels.length, 7);
  assert.equal(JSON.stringify(source), before, 'the source history and totals are never changed for the chart');
});

test('missing weeks stay in position as gaps, and unknown calendar rollover does not invent week zero', () => {
  const source = snapshot();
  source.trend[4].CD = null;
  source.weekNumber = 2;
  source.trend[6].weekNumber = 2;
  const chart = chartSpec(source, 'CD');
  assert.equal(chart.series[0].values[1], null);
  assert.deepEqual(chart.labels, ['Week of 2026-08-10', 'Week of 2026-08-17', 'Week 1', 'Week 2']);
  source.trend[3].weekNumber = 52;
  assert.equal(chartSpec(source, 'CD').labels[0], 'Week 52', 'explicit saved historical number wins');
});

test('Word chart renderer prints weekly labels and exact percentages, never zero labels for missing samples', async () => {
  const source = snapshot();
  const canvas = createCanvas(1200, 390);
  const ctx = canvas.getContext('2d');
  const printed: string[] = [];
  const original = ctx.fillText.bind(ctx);
  ctx.fillText = (text, x, y) => { printed.push(text); original(text, x, y); };
  paintChart(ctx as unknown as CanvasRenderingContext2D, 1200, 390, chartSpec(source, 'CD'));
  for (const label of ['Week 31', 'Week 34', '92.76%', '95.13%', '96.52%', '98.46%', 'Target 95%']) assert.ok(printed.includes(label), label);
  assert.ok(!printed.includes('0.00%'));
  if (process.env.QUALITY_CHART_OUTPUT) {
    await writeFile(`${process.env.QUALITY_CHART_OUTPUT}/weekly-chart.png`, canvas.toBuffer('image/png'));
    // Reuse the prior fully populated synthetic fixture, changing only the trend
    // to exercise four visible chart points in the actual Word/page layout.
    const base = process.env.QUALITY_CHART_SNAPSHOT
      ? JSON.parse(await readFile(process.env.QUALITY_CHART_SNAPSHOT, 'utf8')) as Snapshot : source;
    const report = { ...base, weekNumber: source.weekNumber, ruleVersion: RULE_VERSION, trend: source.trend };
    await writeFile(`${process.env.QUALITY_CHART_OUTPUT}/snapshot.json`, JSON.stringify(report));
    await writeFile(`${process.env.QUALITY_CHART_OUTPUT}/weekly-chart.docx`, await renderQualityWord(report, 'https://example.invalid'));
  }
});
