import type { Snapshot } from './domain';
export type ChartSpec = {
  labels: string[];
  series: { label: string; color: string; values: (number | null)[] }[];
};
export function chartMinimum(spec: ChartSpec) {
  let minimum = 0.95;
  for (const series of spec.series) for (const value of series.values) if (value != null && value < minimum) minimum = value;
  return Math.max(0, Math.floor((minimum * 100 - 2) / 2) * 2);
}
export function chartSpec(
  snapshot: Snapshot,
  kind: 'CD' | 'ACCOUNTS',
): ChartSpec {
  const labels = snapshot.trend.map((p) => {
    if (snapshot.trend.length > 4) {
      const [, month, day] = p.start.split('-');
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return `${day} ${months[Number(month) - 1]}`;
    }
    return p.weekNumber == null ? p.start : `W${p.weekNumber} · ${p.start}`;
  });
  const series =
    kind === 'CD'
      ? [
          {
            label: 'Including mislabeled cases',
            color: '#2563eb',
            values: snapshot.trend.map((p) => p.CD?.accuracy ?? null),
          },
          {
            label: 'Not including mislabeled cases',
            color: '#d97706',
            values: snapshot.trend.map((p) => p.CD?.adjustedAccuracy ?? null),
          },
        ]
      : [
          {
            label: 'Industry A',
            color: '#2563eb',
            values: snapshot.trend.map((p) => p.industryA?.accuracy ?? null),
          },
          {
            label: 'Industry B',
            color: '#d97706',
            values: snapshot.trend.map((p) => p.industryB?.accuracy ?? null),
          },
          {
            label: 'Combined',
            color: '#8b5cf6',
            values: snapshot.trend.map((p) => p.ACCOUNTS?.accuracy ?? null),
          },
        ];
  return {
    labels,
    series: [
      ...series,
      { label: 'Target 95%', color: '#64748b', values: labels.map(() => 0.95) },
    ],
  };
}
export function paintChart(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  spec: ChartSpec,
) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  const min = chartMinimum(spec), max = 100;
  const left = 70,
    top = 75,
    right = width - 40,
    bottom = height - 55;
  const x = (i: number) =>
    left + 20 + (i * (right - left - 40)) / Math.max(1, spec.labels.length - 1);
  const y = (v: number) =>
    bottom - ((v * 100 - min) / (max - min)) * (bottom - top);
  ctx.font = '16px "Quality Inter", Arial';
  ctx.textBaseline = 'middle';
  let legendX = left;
  spec.series.forEach((s) => {
    ctx.fillStyle = s.color;
    ctx.fillRect(legendX, 26, 20, 3);
    ctx.fillStyle = '#536259';
    ctx.fillText(s.label, legendX + 28, 28);
    legendX += ctx.measureText(s.label).width + 62;
  });
  for (let i = 0; i <= 4; i++) {
    const v = min + ((max - min) * i) / 4,
      py = y(v / 100);
    ctx.strokeStyle = '#e1e7df';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, py);
    ctx.lineTo(right, py);
    ctx.stroke();
    ctx.fillStyle = '#7b857b';
    ctx.textAlign = 'right';
    ctx.fillText(v.toFixed(0) + '%', left - 12, py);
  }
  ctx.textAlign = 'center';
  spec.labels.forEach((label, i) => {
    ctx.fillStyle = '#647361';
    // Keep full dates inside the canvas at the first and last checkpoints.
    ctx.textAlign = i === 0 ? 'left' : i === spec.labels.length - 1 ? 'right' : 'center';
    ctx.fillText(label, x(i), bottom + 29);
  });
  spec.series.forEach((series, j) => {
    ctx.strokeStyle = series.color;
    ctx.fillStyle = series.color;
    ctx.lineWidth = j === spec.series.length - 1 ? 2 : 3;
    ctx.setLineDash(j === spec.series.length - 1 ? [6, 5] : []);
    let previous = false;
    ctx.beginPath();
    series.values.forEach((v, i) => {
      if (v == null) {
        previous = false;
        return;
      }
      if (previous) ctx.lineTo(x(i), y(v));
      else ctx.moveTo(x(i), y(v));
      previous = true;
    });
    ctx.stroke();
    ctx.setLineDash([]);
    if (j !== spec.series.length - 1)
      series.values.forEach((v, i) => {
        if (v == null) return;
        ctx.beginPath();
        ctx.arc(x(i), y(v), 4, 0, Math.PI * 2);
        ctx.fill();
      });
  });
  ctx.textAlign = 'left';
}
export async function chartImages(
  snapshot: Snapshot,
): Promise<Record<'CD' | 'ACCOUNTS', Uint8Array>> {
  const output = {} as Record<'CD' | 'ACCOUNTS', Uint8Array>;
  for (const kind of ['CD', 'ACCOUNTS'] as const) {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 390;
    const ctx = canvas.getContext('2d');
    if (!ctx)
      throw new Error('Your browser could not render the report charts.');
    paintChart(ctx, canvas.width, canvas.height, chartSpec(snapshot, kind));
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) =>
          b
            ? resolve(b)
            : reject(new Error('The chart could not be exported.')),
        'image/png',
      ),
    );
    output[kind] = new Uint8Array(await blob.arrayBuffer());
  }
  return output;
}
