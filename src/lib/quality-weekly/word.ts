import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  HeadingLevel,
  ImageRun,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';
import { change, rate, SECTION_NAMES, sectionName, reportSection } from './domain';
import type { MetricRow, Snapshot, Section } from './domain';
import { chartSpec } from './charts';

export function reportFilename(s: Snapshot) {
  return `Quality Weekly Report - ER BPO - ${s.start} - Week ${s.weekNumber} - v${s.version}.docx`;
}
const text = (value: string, options: Record<string, unknown> = {}) =>
  new TextRun({ text: value, ...options });
const p = (value: string, options: Record<string, unknown> = {}) =>
  new Paragraph({
    children: [text(value)],
    spacing: { after: 140 },
    ...options,
  });
const heading = (
  value: string,
  level:
    | typeof HeadingLevel.HEADING_1
    | typeof HeadingLevel.HEADING_2 = HeadingLevel.HEADING_1,
  pageBreakBefore = false,
) =>
  p(value, {
    heading: level,
    pageBreakBefore,
    keepNext: true,
    spacing: { before: 230, after: 150 },
  });

function metricTable(rows: MetricRow[], label: string, account = false): Table {
  const headers = account
    ? [
        label,
        'Sampling\nAmount',
        'Allow\nAmount',
        'Labeled\nAmount',
        'Leakage\nAmount',
        'False Positive\nAmount',
        'Error\nLabeling',
        'Leakage\nRate',
        'False Positive\nRate',
        'Mislabeled\nRate',
        'Accuracy\nRate',
      ]
    : [
        label,
        'Sampling\nAmount',
        'Allow\nAmount',
        'Labeled\nAmount',
        'Leakage\nAmount',
        'False Positive\nAmount',
        'Error\nLabeling',
        'Leakage\nRate',
        'False Positive\nRate',
        'Mislabeled\nRate',
        'Accuracy including\nmislabeled cases',
        'Accuracy not including\nmislabeled cases',
      ];
  const widths = account ? [2350, ...Array(8).fill(1190), 1590, 1678] : [2350, ...Array(9).fill(1074), 1530, 1592];
  const values = rows.map((r) =>
    account
      ? [
          r.name,
          r.n,
          r.allow,
          r.labeled,
          r.leakage,
          r.falsePositive,
          r.mislabeled,
          rate(r.leakageRate),
          rate(r.falsePositiveRate),
          rate(r.mislabeledRate),
          rate(r.accuracy),
        ]
      : [
          r.name,
          r.n,
          r.allow,
          r.labeled,
          r.leakage,
          r.falsePositive,
          r.mislabeled,
          rate(r.leakageRate),
          rate(r.falsePositiveRate),
          rate(r.mislabeledRate),
          rate(r.accuracy),
          rate(r.adjustedAccuracy),
        ],
  );
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'D9D9D9' };
  return new Table({
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    borders: {
      top: border,
      bottom: border,
      left: border,
      right: border,
      insideHorizontal: border,
      insideVertical: border,
    },
    rows: [headers, ...values].map(
      (cells, ri) =>
        new TableRow({
          tableHeader: ri === 0,
          cantSplit: true,
          children: cells.map(
            (v, ci) =>
              new TableCell({
                width: { size: widths[ci], type: WidthType.DXA },
                verticalAlign: VerticalAlign.CENTER,
                margins: { top: 120, bottom: 120, left: 100, right: 100 },
                shading: {
                  fill: ri === 0 ? '1D4ED8' : ri % 2 ? 'FFFFFF' : 'F3F6FC',
                },
                children: [
                  new Paragraph({
                    alignment:
                      ci === 0 ? AlignmentType.LEFT : AlignmentType.CENTER,
                    spacing: { before: 0, after: 0, line: 230 },
                    children: String(v)
                      .split('\n')
                      .flatMap((s, i) => [
                        text(s, {
                          break: i ? 1 : undefined,
                          size: 17,
                          bold:
                            ri === 0 ||
                            cells[0] === 'Totals' ||
                            cells[0] === 'Combined',
                          color: ri === 0 ? 'FFFFFF' : '18233A',
                        }),
                      ]),
                  }),
                ],
              }),
          ),
        }),
    ),
  });
}
export async function createWord(
  snapshot: Snapshot,
  origin: string,
  images: Record<'CD' | 'ACCOUNTS', Uint8Array>,
): Promise<Uint8Array> {
  const s = snapshot,
    children: (Paragraph | Table)[] = [];
  const period = `Moderation period is from ${s.start.split('-').reverse().join('/')} to ${s.end.split('-').reverse().join('/')}`;
  const reportLink = (section: string) =>
    new Paragraph({
      spacing: { before: 160, after: 140 },
      children: [
        new ExternalHyperlink({
          link: `${origin}/weekly-quality-report?report=${encodeURIComponent(s.id)}&section=${section}&view=agents`,
          children: [
            text('Agent Breakdown — open the authenticated report', {
              style: 'Hyperlink',
              size: 20,
            }),
          ],
        }),
      ],
    });
  const chart = (kind: 'CD' | 'ACCOUNTS') =>
    new Paragraph({
      spacing: { before: 190, after: 80 },
      alignment: AlignmentType.CENTER,
      children: [
        new ImageRun({
          type: 'png',
          data: images[kind],
          transformation: kind === 'CD' && s.cdSampling ? { width: 700, height: 228 } : { width: 920, height: 299 },
          altText: {
            title:
              kind === 'CD'
                ? 'Material Weekly Results CD Sampling'
                : 'Account Weekly Results',
            description:
              `${chartSpec(s, kind).labels.length} consecutive weeks. Gaps indicate missing data. Target 95%.`,
            name: kind + ' weekly trend',
          },
        }),
      ],
    });
  children.push(
    p('Quality Weekly Report ER BPO', { heading: HeadingLevel.TITLE }),
    p(`Week ${s.weekNumber}`, { bold: true }),
    p(period),
    p(
      `Version ${s.version} · Generated ${s.createdAt.slice(0, 10)} · ${s.createdBy}`,
      { spacing: { after: 180 } },
    ),
  );
  if (s.trend.some(t => t.source)) children.push(p('Monday–Friday moderation periods. The selected week and six prior periods are calculated from the same preserved upload. Weekends are excluded; periods without data remain N/A.'));
  children.push(heading('CD Sampling'), p(s.cdSampling ? 'Recall, Material, Quick and Inspection. Consolidated by report section.' : 'Only material queues.'));
  const cd = reportSection(s, 'CD')!;
  children.push(
    metricTable(
      [...cd.rows, { id: 'total', name: 'Totals', ...cd.metrics }],
      s.cdSampling ? 'Section' : 'Queue',
    ),
  );
  if (!cd.metrics.n)
    children.push(
      p('No CD Sampling cases in this weekly export. Rates are unavailable.'),
    );
  children.push(chart('CD'), heading('Breakdown by Agent', HeadingLevel.HEADING_2));
  if (cd.agents.length) children.push(metricTable(cd.agents, 'Agent', true));
  else children.push(p('No agent samples available.'));
  children.push(reportLink('CD'));
  children.push(
    heading('ER Sampling', HeadingLevel.HEADING_1, true),
    p(period),
    heading('Account Review', HeadingLevel.HEADING_2),
  );
  const accounts = s.sections.ACCOUNTS;
  children.push(
    metricTable(
      [
        ...accounts.rows,
        { id: 'combined', name: 'Combined', ...accounts.metrics },
      ],
      'Industry',
      true,
    ),
  );
  if (!accounts.metrics.n)
    children.push(
      p('No Accounts cases in this weekly export. Rates are unavailable.'),
    );
  children.push(
    chart('ACCOUNTS'),
    heading('Breakdown by Agent', HeadingLevel.HEADING_2),
  );
  if (accounts.agents.length)
    children.push(metricTable(accounts.agents, 'Agent', true));
  else children.push(p('No agent samples available.'));
  for (const section of (Object.keys(SECTION_NAMES) as Section[]).filter(key => key !== 'CD' && key !== 'ACCOUNTS')) {
  const material = s.sections[section];
  // Old immutable snapshots contain only the original three report sections.
  if (!material || (section !== 'MATERIAL' && !material.metrics.n)) continue;
  children.push(heading(`${sectionName(s, section)} Review`, HeadingLevel.HEADING_1, true));
  children.push(
    metricTable(
      [...material.rows, { id: 'total', name: 'Totals', ...material.metrics }],
      'Queue',
    ),
  );
  if (!material.metrics.n)
    children.push(
      p(`No ${sectionName(s, section)} cases in this weekly export. Rates are unavailable.`),
    );
  children.push(heading('Weekly comparison', HeadingLevel.HEADING_2));
  const trendHeaders = [
    'Accuracy',
    ...s.trend.map((t) => (t.weekNumber ? `Week ${t.weekNumber}\n${t.start}` : t.start)),
    'Change',
  ];
  const current = s.trend.at(-1)?.[section],
    previous = s.trend.at(-2)?.[section];
  const trendRows = [
    trendHeaders,
    [
      'Including mislabeled cases',
      ...s.trend.map((t) => rate(t[section]?.accuracy)),
      change(current?.accuracy, previous?.accuracy),
    ],
    [
      'Not including mislabeled cases',
      ...s.trend.map((t) => rate(t[section]?.adjustedAccuracy)),
      change(current?.adjustedAccuracy, previous?.adjustedAccuracy),
    ],
  ];
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'D9D9D9' };
  children.push(
    new Table({
      width: { size: 15138, type: WidthType.DXA },
      columnWidths: [3500, ...Array.from({ length: s.trend.length + 1 }, (_, i) =>
        Math.floor(11638 / (s.trend.length + 1)) + (i < 11638 % (s.trend.length + 1) ? 1 : 0))],
      layout: TableLayoutType.FIXED,
      borders: {
        top: border,
        bottom: border,
        left: border,
        right: border,
        insideHorizontal: border,
        insideVertical: border,
      },
      rows: trendRows.map(
        (row, ri) =>
          new TableRow({
            tableHeader: ri === 0,
            cantSplit: true,
            children: row.map(
              (value, ci) =>
                new TableCell({
                  verticalAlign: VerticalAlign.CENTER,
                  margins: { top: 120, bottom: 120, left: 120, right: 120 },
                  shading: { fill: ri === 0 ? '1D4ED8' : 'F3F6FC' },
                  children: [
                    p(value, {
                      alignment: ci ? AlignmentType.CENTER : AlignmentType.LEFT,
                      spacing: { after: 0 },
                      children: [
                        text(value, {
                          size: 19,
                          color: ri === 0 ? 'FFFFFF' : '18233A',
                          bold: ri === 0,
                        }),
                      ],
                    }),
                  ],
                }),
            ),
          }),
      ),
    }),
  );
  children.push(
    heading('Breakdown by Agent', HeadingLevel.HEADING_2),
    ...(material.agents.length ? [metricTable(material.agents, 'Agent', true)] : [p('No agent samples available.')]),
    reportLink(section),
    p(
      'Rates are calculated from case counts. N/A means the denominator is zero or the week has no validated data. Weekly changes are expressed in percentage points.',
      {
        spacing: { before: 180 },
        children: [
          text(
            'Rates are calculated from case counts. N/A means the denominator is zero or the week has no validated data. Weekly changes are expressed in percentage points.',
            { size: 18, color: '667061' },
          ),
        ],
      },
    ),
  );
  }
  const doc = new Document({
    creator: s.createdBy,
    title: 'Quality Weekly Report ER BPO',
    description: `Week ${s.weekNumber}, ${period}`,
    styles: {
      default: {
        document: {
          run: { font: 'Calibri', size: 21, color: '18233A' },
          paragraph: { spacing: { after: 140 } },
        },
        title: {
          run: { color: '000000', size: 38, bold: true },
          paragraph: { spacing: { after: 180 } },
        },
        heading1: { run: { color: '000000', size: 28, bold: true } },
        heading2: { run: { color: '000000', size: 24, bold: true } },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 16838, height: 11906 },
            margin: {
              top: 720,
              bottom: 720,
              left: 850,
              right: 850,
              footer: 360,
              header: 360,
            },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  text(`ER BPO · Week ${s.weekNumber} · `, {
                    size: 16,
                    color: '78816F',
                  }),
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    size: 16,
                    color: '78816F',
                  }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
  return new Uint8Array(await Packer.toArrayBuffer(doc));
}
