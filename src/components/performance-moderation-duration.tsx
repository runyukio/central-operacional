import type { AgentModerationDuration } from "@/lib/performance-moderation-duration";

export function ModerationDurationCell({ value }: { value?: AgentModerationDuration }) {
  const days = value?.byShiftDate ?? [];
  const duration = value?.duration ?? "Sem dados";
  if (days.length < 2) {
    return <div className="whitespace-nowrap text-right font-black text-navy-950">
      {duration}
      {days[0] ? <time dateTime={days[0].shiftDate} className="mt-0.5 block text-[10px] font-bold text-muted">
        Shift Date {displayShiftDate(days[0].shiftDate)}
      </time> : null}
    </div>;
  }
  return <details className="text-right">
    <summary className="cursor-pointer whitespace-nowrap font-black text-navy-950" aria-label={`Moderation Duration por Shift Date: ${duration}`}>
      {duration}
      <span className="mt-0.5 block text-[10px] font-bold text-muted">Por Shift Date</span>
    </summary>
    <dl className="mt-2 space-y-1 whitespace-nowrap text-xs">
      {days.map(day => <div key={day.shiftDate} className="flex justify-between gap-4">
        <dt><time dateTime={day.shiftDate}>{displayShiftDate(day.shiftDate)}</time></dt>
        <dd className="font-bold">{day.duration}</dd>
      </div>)}
    </dl>
  </details>;
}

function displayShiftDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}
