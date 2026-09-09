export const RULE_VERSION = 'quality-weekly-v4';
export const RULE_DEFINITION = {
  week: 'Moderation date; Monday to Sunday; manual operation week number',
  key: 'Concatenation of text QA case ID + audit case ID; collisions and non-result conflicts block; identical duplicates count once',
  outcomes: 'Distinct case keys are counted independently per final_result; result categories may overlap; Excel row order has no precedence',
  sampling: 'N = distinct valid case keys', leakageRate: 'Leakage / Allow', falsePositiveRate: 'False Positive / Labeled',
  mislabeledRate: 'Mislabeled / N', accuracy: "COUNT(DISTINCT IF(final_result = 'Correct', CONCAT(qaId, auditId), NULL)) / COUNT(DISTINCT CONCAT(qaId, auditId))", adjustedAccuracy: '(Correct + Mislabeled) / N',
  weeklyChange: 'Current accuracy minus prior week accuracy, in percentage points', zeroDenominator: 'N/A', target: 0.95
} as const;
export const SECTION_NAMES = {
  CD: 'CD Sampling',
  ACCOUNTS: 'ER Accounts',
  MATERIAL: 'ER Material',
  UNIT: 'ER Unit',
  PICTURE: 'Picture',
  QUICK: 'Quick',
  TALENT: 'Talent',
  RECALL: 'Recall',
  EFFECT: 'Effect',
  INSPECTION: 'Inspection',
  OTHER: 'Other queues',
} as const;
export type Section = keyof typeof SECTION_NAMES;
const SECTION_ALIASES: Record<string, Section> = {
  cd: 'CD', cd_sampling: 'CD', accounts: 'ACCOUNTS', er_accounts: 'ACCOUNTS', er_sampling_accounts: 'ACCOUNTS',
  material: 'MATERIAL', er_material: 'MATERIAL', unit: 'UNIT', er_unit: 'UNIT',
  picture: 'PICTURE', quick: 'QUICK', talent: 'TALENT', recall: 'RECALL',
  effect: 'EFFECT', efect: 'EFFECT', inspection: 'INSPECTION', other: 'OTHER', other_queues: 'OTHER',
  'er_material/unit': 'MATERIAL', 'material/unit': 'MATERIAL', er_material_unit: 'MATERIAL',
};
type LegacySection = 'CD' | 'ACCOUNTS' | 'MATERIAL';
type AdditionalSection = Exclude<Section, LegacySection>;
export function sectionName(snapshot: Pick<Snapshot, 'ruleVersion'>, section: Section): string {
  return section === 'MATERIAL' && snapshot.ruleVersion === 'quality-weekly-v1'
    ? 'ER Material/Unit' : SECTION_NAMES[section];
}
export type Outcome = 'Correct' | 'Leakage' | 'False_Positive' | 'Mislabeled';
const OUTCOMES: Outcome[] = ['Correct', 'Leakage', 'False_Positive', 'Mislabeled'];
export type Cell = string | number | boolean | null;
export type SourceTable = {
  sheet: string;
  headers: string[];
  rows: Cell[][];
  rowNumbers: number[];
};
export type Mapping = {
  queueId: string;
  queueName: string;
  section: Section;
  industry: 'A' | 'B' | null;
  category?: string;
};
// A report section is optional. Keep the supplied mapping intact for audit/version history.
export type MappingEntry = Omit<Mapping, 'section'> & { section: Section | null };
export function mappingSection(entry: MappingEntry): Section {
  if (entry.section) return entry.section;
  // A supplied, recognized category is explicit source information, not an inferred classification.
  const category = normalize(entry.category || '');
  return Object.hasOwn(SECTION_ALIASES, category) ? SECTION_ALIASES[category] : 'OTHER';
}
export function mappingPending(entry: MappingEntry): string[] {
  return [
    ...(!entry.queueName ? ['Queue name'] : []),
    ...(mappingSection(entry) === 'ACCOUNTS' && !entry.industry ? ['Industry A/B'] : []),
  ];
}
export type Issue = {
  row: number | null;
  field: string;
  message: string;
  severity: 'error' | 'warning';
};
export type Case = {
  sourceRow: number;
  qaId: string;
  auditId: string;
  date: string;
  agentId: string | null;
  agentName: string;
  queueId: string;
  queueName: string;
  section: Section;
  industry: 'A' | 'B' | null;
  category?: string;
  allow: number;
  labeled: number;
  result: Outcome;
  // Canonical outcome set for one distinct key; optional for existing callers.
  results?: Outcome[];
};
export type Counts = {
  n: number;
  correct: number;
  allow: number;
  labeled: number;
  leakage: number;
  falsePositive: number;
  mislabeled: number;
};
export type Metrics = Counts & {
  leakageRate: number | null;
  falsePositiveRate: number | null;
  mislabeledRate: number | null;
  accuracy: number | null;
  adjustedAccuracy: number | null;
};
export type MetricRow = Metrics & { name: string; id: string };
export type AgentRow = MetricRow & {
  section: Section;
  queueId: string;
  queueName: string;
};
export type SectionReport = {
  metrics: Metrics;
  rows: MetricRow[];
  agents: MetricRow[];
  queues?: MetricRow[];
  categories?: MetricRow[];
};
export type TrendPoint = Partial<Record<AdditionalSection, Metrics | null>> & {
  start: string;
  weekNumber: number | null;
  reportId: string | null;
  CD: Metrics | null;
  ACCOUNTS: Metrics | null;
  MATERIAL: Metrics | null;
  industryA: Metrics | null;
  industryB: Metrics | null;
};
export type Snapshot = {
  id: string;
  start: string;
  end: string;
  weekNumber: number;
  version: number;
  createdAt: string;
  createdBy: string;
  ruleVersion: string;
  ruleDefinition?: typeof RULE_DEFINITION;
  uploadId: string;
  mappingId: string;
  mappings: MappingEntry[];
  filename: string;
  digest: string;
  metrics: Metrics;
  sections: Record<LegacySection, SectionReport> & Partial<Record<AdditionalSection, SectionReport>>;
  agents: AgentRow[];
  trend: TrendPoint[];
};
export type Validation = {
  rows: number;
  duplicates: number;
  summaryRows: number;
  issues: Issue[];
  errorCount: number;
  warningCount: number;
  dates: { start: string; end: string; count: number; days: string[] }[];
  sourceCounts: Counts;
  distinctCounts?: Counts | null;
  resultVariations?: number;
  controlTotals: Record<string, number>[];
  headers: string[];
  unknownQueues: string[];
  valid: boolean;
};
export type Analysis = Validation & { cases: Case[] };

export const FIELDS: Record<string, string[]> = {
  qaId: ['质检case_order_id', 'qa_case_order_id', 'qa_id'],
  auditId: ['audit_case_order_id', 'audit_id'],
  date: [
    'moderation_date',
    'audit_date',
    'audit_time',
    'audit_time(年月日)',
    'audit_time（年月日）',
    'audit_finish_time',
    'moderation_time',
    '审核日期',
    '审核时间',
    'data_moderacao',
    'data_da_moderacao',
  ],
  agentId: ['audit_admin_id', 'agent_id'],
  agentName: ['audit_name', 'agent_name'],
  queueId: ['audit_queue_id', 'queue_id'],
  sampling: ['抽检量_Sampling_Amount', 'Sampling_Amount'],
  allow: ['通过量_Allow_Amount', 'Allow_Amount'],
  labeled: ['打标量_Labeled_Amount', 'Labeled_Amount'],
  leakage: ['漏放量_Leakage_Amount', 'Leakage_Amount'],
  falsePositive: ['误伤量_False_Positive_Amount', 'False_Positive_Amount'],
  mislabeled: ['错标量_Mislabeled_Amount', 'Mislabeled_Amount'],
  result: ['final_result'],
};
const normalize = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
export function fieldIndex(headers: string[], aliases: string[]) {
  return headers.findIndex((h) =>
    aliases.some((a) => normalize(a) === normalize(h)),
  );
}
export function textValue(value: Cell | undefined): string {
  return value == null ? '' : String(value).trim();
}
function identifier(value: Cell | undefined): string {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return '';
  const s = textValue(value);
  return /^(null|undefined|nan)$/i.test(s) ? '' : s;
}
export function dayAdd(date: string, amount: number): string {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + amount);
  return d.toISOString().slice(0, 10);
}
export function weekStart(date: string): string {
  const d = new Date(date + 'T12:00:00Z');
  return dayAdd(date, -((d.getUTCDay() + 6) % 7));
}
export function dateValue(value: Cell | undefined): string {
  let result = '';
  if (typeof value === 'number' && value >= 1 && value < 100000)
    result = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000)
      .toISOString()
      .slice(0, 10);
  else {
    const s = textValue(value);
    const iso =
      /^(\d{4})[-/](\d{2})[-/](\d{2})(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(
        s,
      );
    const local =
      /^(\d{2})\/(\d{2})\/(\d{4})(?: \d{2}:\d{2}(?::\d{2})?)?$/.exec(s);
    if (iso) result = `${iso[1]}-${iso[2]}-${iso[3]}`;
    else if (local) result = `${local[3]}-${local[2]}-${local[1]}`;
  }
  if (!result || Number.isNaN(Date.parse(result + 'T12:00:00Z'))) return '';
  return new Date(result + 'T12:00:00Z').toISOString().slice(0, 10) === result
    ? result
    : '';
}
export function emptyCounts(): Counts {
  return {
    n: 0,
    correct: 0,
    allow: 0,
    labeled: 0,
    leakage: 0,
    falsePositive: 0,
    mislabeled: 0,
  };
}
export function metrics(c: Counts): Metrics {
  return {
    ...c,
    leakageRate: c.allow ? c.leakage / c.allow : null,
    falsePositiveRate: c.labeled ? c.falsePositive / c.labeled : null,
    mislabeledRate: c.n ? c.mislabeled / c.n : null,
    accuracy: c.n ? c.correct / c.n : null,
    adjustedAccuracy: c.n ? (c.correct + c.mislabeled) / c.n : null,
  };
}
export function aggregate(cases: Case[]): Metrics {
  const c = emptyCounts();
  for (const x of cases) {
    c.n++;
    c.allow += x.allow;
    c.labeled += x.labeled;
    const results = new Set(x.results ?? [x.result]);
    if (results.has('Correct')) c.correct++;
    if (results.has('Leakage')) c.leakage++;
    if (results.has('False_Positive')) c.falsePositive++;
    if (results.has('Mislabeled')) c.mislabeled++;
  }
  return metrics(c);
}
export const rate = (n: number | null | undefined) =>
  n == null ? 'N/A' : (n * 100).toFixed(2) + '%';
export const number = (n: number) => n.toLocaleString('en-US');
export function change(
  a: number | null | undefined,
  b: number | null | undefined,
) {
  if (a == null || b == null) return 'N/A';
  const p = (a - b) * 100;
  return `${p > 0 ? '+' : ''}${p.toFixed(2)} pp`;
}
export function agentKey(c: Case) {
  return c.agentId ? 'id:' + c.agentId : 'name:' + c.agentName;
}

export function parseMapping(table: SourceTable, options: {
  allowIncomplete?: boolean;
  queueNames?: Readonly<Record<string, string>>;
} = {}): {
  mappings: MappingEntry[];
  issues: Issue[];
} {
  const issues: Issue[] = [],
    mappings: MappingEntry[] = [];
  const cols = {
    queueId: fieldIndex(table.headers, [
      'queue_id',
      'audit_queue_id',
      'queue id',
    ]),
    queueName: fieldIndex(table.headers, ['queue_name', 'queue name', 'name']),
    section: fieldIndex(table.headers, ['section', 'report_section']),
    industry: fieldIndex(table.headers, ['industry', 'account_industry']),
    category: fieldIndex(table.headers, ['category', 'queue_category']),
  };
  for (const [field, idx] of Object.entries(cols))
    if (idx < 0 && (field === 'queueId' || (field === 'queueName' && !options.allowIncomplete)))
      issues.push({
        row: null,
        field,
        message: `Missing mapping column: ${field}. Use the downloadable mapping template.`,
        severity: 'error',
      });
  table.headers.forEach((header, index) => {
    if (header && table.headers.findIndex(h => normalize(h) === normalize(header)) !== index)
      issues.push({ row: null, field: header, message: 'Duplicate mapping column. Keep only one column per field.', severity: 'error' });
  });
  if (issues.length) return { mappings, issues };
  const seen = new Map<string, string>();
  table.rows.forEach((row, i) => {
    if (row.every((v) => !textValue(v))) return;
    const queueId = identifier(row[cols.queueId]),
      queueName = textValue(row[cols.queueName]) || (options.queueNames && Object.hasOwn(options.queueNames, queueId) ? options.queueNames[queueId] : '') || '';
    const sectionText = textValue(row[cols.section]);
    const sectionKey = normalize(sectionText);
    const section = Object.hasOwn(SECTION_ALIASES, sectionKey)
      ? SECTION_ALIASES[sectionKey]
      : null;
    const category = textValue(row[cols.category]) ||
      (sectionKey === 'material' ? 'Material' : section === 'UNIT' ? 'Unit' :
        section && !['CD', 'ACCOUNTS', 'MATERIAL'].includes(section) ? SECTION_NAMES[section] : !section ? sectionText : '');
    const industryText = textValue(row[cols.industry])
      .replace(/^industry\s*/i, '')
      .toUpperCase();
    const industry: Mapping['industry'] =
      industryText === 'A' || industryText === 'B' ? industryText : null;
    const entry: MappingEntry = { queueId, queueName, section, industry, ...(category ? { category } : {}) };
    const effectiveSection = mappingSection(entry);
    const sourceRow = table.rowNumbers[i];
    if (
      !queueId ||
      (industryText && !industry) ||
      (effectiveSection !== 'ACCOUNTS' && industryText) ||
      (!options.allowIncomplete && (!queueName || (effectiveSection === 'ACCOUNTS' && !industry)))
    ) {
      issues.push({
        row: sourceRow,
        field: 'mapping',
        message: options.allowIncomplete
          ? 'Provide a valid queue ID. Report section and category are optional. If supplied, Industry must be A or B and is only applicable to Accounts. Blank names may be saved for review.'
          : 'Use a text queue ID and a queue name. Report section and category are optional. Accounts requires industry A or B; leave industry blank for other sections.',
        severity: 'error',
      });
      return;
    }
    const signature = JSON.stringify(entry);
    if (seen.has(queueId)) {
      if (seen.get(queueId) !== signature)
        issues.push({
          row: sourceRow,
          field: 'queue_id',
          message: `Queue ${queueId} has conflicting classifications.`,
          severity: 'error',
        });
      return;
    }
    seen.set(queueId, signature);
    mappings.push(entry);
    const pending = mappingPending(entry);
    if (pending.length) issues.push({ row: sourceRow, field: 'mapping', severity: 'warning',
      message: `Queue ${queueId} saved for review. Pending: ${pending.join(', ')}. Complete these fields before using this queue in a weekly report.` });
  });
  if (!mappings.length && !issues.length)
    issues.push({
      row: null,
      field: 'mapping',
      message: 'The mapping file has no queue records.',
      severity: 'error',
    });
  return { mappings, issues };
}

export function analyze(
  table: SourceTable,
  mappings: MappingEntry[],
  dateColumn?: string,
): Analysis {
  const issues: Issue[] = [];
  let errorCount = 0,
    warningCount = 0;
  const issue = (
    row: number | null,
    field: string,
    message: string,
    severity: 'error' | 'warning' = 'error',
  ) => {
    if (severity === 'error') errorCount++;
    else warningCount++;
    if (issues.length < 200) issues.push({ row, field, message, severity });
  };
  const idx = Object.fromEntries(
    Object.entries(FIELDS).map(([key, aliases]) => [
      key,
      fieldIndex(table.headers, aliases),
    ]),
  );
  if (dateColumn) idx.date = table.headers.indexOf(dateColumn);
  const required = Object.keys(FIELDS).filter((k) => k !== 'agentId');
  for (const key of required)
    if (idx[key] < 0)
      issue(null, key, `Missing required column: ${FIELDS[key][0]}.`);
  const duplicatesInHeader = table.headers.filter(
    (h, i) =>
      h && table.headers.findIndex((x) => normalize(x) === normalize(h)) !== i,
  );
  if (duplicatesInHeader.length)
    issue(
      1,
      'headers',
      'Duplicate column headers: ' + duplicatesInHeader.join(', '),
    );
  const sourceCounts = emptyCounts(),
    controlTotals: Record<string, number>[] = [],
    cases: Case[] = [];
  const map = new Map(mappings.map((m) => [m.queueId, m]));
  const unknownQueues = new Set<string>();
  const seen = new Map<string, { signature: string; row: number; value: Case }>(),
    concats = new Map<string, string>();
  let rows = 0,
    duplicates = 0,
    resultVariations = 0,
    summaryRows = 0,
    missingAgents = 0;
  const calendar = new Map<string, { count: number; days: Set<string> }>();
  const colsPresent = required.every((k) => idx[k] >= 0);
  for (let i = 0; i < table.rows.length; i++) {
    const values = table.rows[i],
      row = table.rowNumbers[i];
    if (values.every((v) => !textValue(v))) continue;
    const get = (field: string) => values[idx[field]];
    if (values.some(value => textValue(value) === '汇总')) {
      summaryRows++;
      const totals: Record<string, number> = {};
      for (const k of [
        'sampling',
        'allow',
        'labeled',
        'leakage',
        'falsePositive',
        'mislabeled',
      ])
        if (typeof get(k) === 'number')
          totals[k === 'sampling' ? 'n' : k] = Number(get(k));
      controlTotals.push(totals);
      continue;
    }
    rows++;
    sourceCounts.n++;
    for (const k of [
      'allow',
      'labeled',
      'leakage',
      'falsePositive',
      'mislabeled',
    ] as const)
      if (typeof get(k) === 'number') sourceCounts[k] += Number(get(k));
    if (get('result') === 'Correct') sourceCounts.correct++;
    const queueId = identifier(get('queueId')),
      mapping = map.get(queueId),
      pendingMapping = mapping ? mappingPending(mapping) : [];
    if (queueId && !mapping) {
      unknownQueues.add(queueId);
      issue(row, 'queue_id', `Queue ${queueId} is missing from the queue mapping.`);
    }
    if (pendingMapping.length)
      issue(row, 'mapping', `Queue ${queueId} has an incomplete mapping: ${pendingMapping.join(', ')}. Complete Queue mapping and revalidate.`);
    const date = dateValue(get('date'));
    if (date) {
      const start = weekStart(date);
      if (!calendar.has(start))
        calendar.set(start, { count: 0, days: new Set() });
      const bucket = calendar.get(start)!;
      bucket.count++;
      bucket.days.add(date);
    }
    if (!colsPresent) continue;
    let valid = true;
    const fail = (field: string, message: string) => {
      valid = false;
      issue(row, field, message);
    };
    const qaId = identifier(get('qaId')),
      auditId = identifier(get('auditId')),
      agentId = identifier(get('agentId')) || null,
      agentName = textValue(get('agentName'));
    if (!qaId || !auditId)
      fail(
        'case IDs',
        'Both case IDs are required. Export long IDs as text to preserve precision.',
      );
    if (!date)
      fail(
        'date',
        'Invalid moderation date. Use YYYY-MM-DD, DD/MM/YYYY or an Excel date.',
      );
    if (!queueId) fail('queue_id', 'A valid queue ID is required.');
    if (!agentName)
      fail(
        'audit_name',
        'An agent name is required, including when the agent ID is missing.',
      );
    if (!agentId) missingAgents++;
    const result = textValue(get('result')) as Outcome;
    if (
      !['Correct', 'Leakage', 'False_Positive', 'Mislabeled'].includes(result)
    )
      fail('final_result', `Unsupported final_result: ${result || '(blank)'}.`);
    for (const key of [
      'sampling',
      'allow',
      'labeled',
      'leakage',
      'falsePositive',
      'mislabeled',
    ])
      if (get(key) !== 0 && get(key) !== 1)
        fail(
          key,
          `${key} must contain a numeric 0 or 1 for each individual case.`,
        );
    if (
      get('sampling') !== 1 ||
      Number(get('allow')) + Number(get('labeled')) !== 1
    )
      fail(
        'amounts',
        'Each case must have Sampling Amount = 1 and Allow + Labeled = 1.',
      );
    if (
      Number(get('leakage')) !== Number(result === 'Leakage') ||
      Number(get('falsePositive')) !== Number(result === 'False_Positive') ||
      Number(get('mislabeled')) !== Number(result === 'Mislabeled')
    )
      fail('final_result', 'The error amounts disagree with final_result.');
    if (!mapping || pendingMapping.length || !valid) continue;
    const c: Case = {
      sourceRow: row,
      qaId,
      auditId,
      date,
      agentId,
      agentName,
      queueId,
      queueName: mapping.queueName,
      section: mappingSection(mapping),
      industry: mapping.industry,
      ...(mapping.category ? { category: mapping.category } : {}),
      allow: Number(get('allow')),
      labeled: Number(get('labeled')),
      result,
    };
    const pair = JSON.stringify([qaId, auditId]),
      concat = qaId + auditId;
    if (concats.has(concat) && concats.get(concat) !== pair) {
      fail(
        'case IDs',
        'Different ID pairs produce the same concatenated key. Resolve this collision before generating a report.',
      );
      continue;
    }
    concats.set(concat, pair);
    const { sourceRow: _source, result: _result, ...meaning } = c;
    const signature = JSON.stringify(meaning);
    if (seen.has(pair)) {
      const first = seen.get(pair)!;
      if (first.signature === signature) {
        const outcomes = new Set(first.value.results);
        if (outcomes.has(result)) duplicates++;
        else {
          resultVariations++;
          outcomes.add(result);
          // Fixed order also makes reuploads with reordered rows idempotent.
          first.value.results = OUTCOMES.filter(outcome => outcomes.has(outcome));
          first.value.result = first.value.results[0];
        }
      } else {
        const original = JSON.parse(first.signature) as Record<string, unknown>;
        const changed = Object.entries(meaning).filter(([key, value]) => original[key] !== value).map(([key]) => key);
        fail(
          'case IDs',
          `This ID pair has conflicting data with Excel row ${first.row}. Different fields: ${changed.join(', ')}.`,
        );
      }
      continue;
    }
    c.results = [result];
    seen.set(pair, { signature, row, value: c });
    cases.push(c);
  }
  if (!rows) issue(null, 'file', 'The export has no case rows.');
  if (missingAgents)
    issue(
      null,
      'audit_admin_id',
      `${missingAgents} rows have no valid agent ID. They are grouped by the exact agent name.`,
      'warning',
    );
  if (duplicates)
    issue(
      null,
      'case IDs',
      `${duplicates} identical duplicate rows were counted once.`,
      'warning',
    );
  if (resultVariations)
    issue(
      null,
      'final_result',
      `${resultVariations} additional outcomes for existing ID pairs were counted once per result. A case counts as Correct whenever Correct is present, regardless of Excel row order. Result categories may overlap.`,
      'warning',
    );
  if (summaryRows > 1)
    issue(
      null,
      'summary',
      'More than one summary row was found. Export one complete detail table.',
    );
  const uniqueCounts = aggregate(cases);
  // Freeze this before adding summary errors, so one mismatch cannot switch
  // subsequent comparisons back to raw row totals and create false mismatches.
  const distinctCounts = colsPresent && !errorCount ? uniqueCounts : null;
  for (const control of controlTotals)
    for (const [key, n] of Object.entries(control)) {
      const checked =
        distinctCounts
          ? distinctCounts[key as keyof Counts]
          : sourceCounts[key as keyof Counts];
      if (n !== checked)
        issue(
          null,
          'summary',
          `Export total for ${key} is ${n}; the detail contains ${checked}. Check duplicates, filters and export completeness.`,
        );
    }
  const dates = [...calendar]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([start, x]) => ({
      start,
      end: dayAdd(start, 6),
      count: cases.filter((c) => weekStart(c.date) === start).length || x.count,
      days: [...x.days].sort(),
    }));
  return {
    rows,
    duplicates,
    summaryRows,
    issues,
    errorCount,
    warningCount,
    dates,
    sourceCounts,
    distinctCounts,
    resultVariations,
    controlTotals,
    headers: table.headers,
    unknownQueues: [...unknownQueues].sort(),
    valid: errorCount === 0,
    cases,
  };
}

function grouped(
  cases: Case[],
  key: (c: Case) => string,
  name: (c: Case) => string,
): MetricRow[] {
  const groups = new Map<string, Case[]>();
  for (const c of cases) {
    const id = key(c);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id)!.push(c);
  }
  return [...groups].map(([id, list]) => ({
    id,
    name: name(list[0]),
    ...aggregate(list),
  }));
}
export function buildSections(cases: Case[]): Record<Section, SectionReport> {
  return Object.fromEntries(
    (Object.keys(SECTION_NAMES) as Section[]).map((section) => {
      const subset = cases.filter((c) => c.section === section);
      let rows = grouped(
        subset,
        (c) => (section === 'ACCOUNTS' ? c.industry! : c.queueId),
        (c) =>
          section === 'ACCOUNTS' ? 'Industry ' + c.industry : c.queueName,
      );
      if (section === 'ACCOUNTS')
        rows = ['A', 'B'].map(
          (id) =>
            rows.find((r) => r.id === id) ?? {
              id,
              name: 'Industry ' + id,
              ...metrics(emptyCounts()),
            },
        );
      return [
        section,
        {
          metrics: aggregate(subset),
          rows,
          queues: grouped(subset, c => c.queueId, c => c.queueName),
          ...(subset.some(c => c.category) ? { categories: grouped(subset, c => c.category ? `category:${c.category}` : `queue:${c.queueId}`, c => c.category || c.queueName) } : {}),
          agents: grouped(subset, agentKey, (c) => c.agentName).sort((a, b) =>
            a.name.localeCompare(b.name),
          ),
        },
      ];
    }),
  ) as Record<Section, SectionReport>;
}
export function buildAgents(cases: Case[]): AgentRow[] {
  return grouped(
    cases,
    (c) => JSON.stringify([c.section, c.queueId, agentKey(c)]),
    (c) => c.agentName,
  ).map((r) => {
    const [section, queueId] = JSON.parse(r.id);
    return {
      ...r,
      section,
      queueId,
      queueName: cases.find((c) => c.queueId === queueId)!.queueName,
    };
  });
}
export function trendPoint(
  snapshot: Pick<Snapshot, 'id' | 'start' | 'weekNumber' | 'sections'>,
): TrendPoint {
  return {
    start: snapshot.start,
    weekNumber: snapshot.weekNumber,
    reportId: snapshot.id,
    CD: snapshot.sections.CD.metrics,
    ACCOUNTS: snapshot.sections.ACCOUNTS.metrics,
    MATERIAL: snapshot.sections.MATERIAL.metrics,
    ...Object.fromEntries((Object.keys(SECTION_NAMES) as Section[])
      .filter(section => !['CD', 'ACCOUNTS', 'MATERIAL'].includes(section))
      .map(section => [section, snapshot.sections[section]?.metrics ?? null])),
    industryA:
      snapshot.sections.ACCOUNTS.rows.find((r) => r.id === 'A') ?? null,
    industryB:
      snapshot.sections.ACCOUNTS.rows.find((r) => r.id === 'B') ?? null,
  };
}
