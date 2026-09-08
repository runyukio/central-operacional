import { mappingPending, number, SECTION_NAMES } from "@/lib/quality-weekly/domain";
import type { MappingEntry } from "@/lib/quality-weekly/domain";

export function QualityMappingView({ entries }: { entries: MappingEntry[] }) {
  const pending = entries.filter(entry => mappingPending(entry).length).length;
  const categories = new Map<string, number>();
  for (const entry of entries) {
    const label = entry.category || (entry.section ? SECTION_NAMES[entry.section] : "Pending category");
    categories.set(label, (categories.get(label) || 0) + 1);
  }
  return <div className="space-y-4">
    <div className="rounded-xl border border-border bg-slate-50 p-4 text-sm text-navy-950">
      <p className="font-extrabold">{number(entries.length)} unique queues · {pending ? `${number(pending)} pending classification` : "Mapping complete"}</p>
      <p className="mt-1 text-xs text-muted">Material and Unit remain separate categories. Industry A/B is only required for Accounts, not for the mapping upload. If the source contains incomplete mappings, weekly report generation stays blocked until they are completed.</p>
    </div>
    <div className="flex flex-wrap gap-2" aria-label="Imported queue categories">
      {[...categories].sort(([a], [b]) => a.localeCompare(b)).map(([label, count]) => <span key={label} className="rounded-lg border border-border bg-blue-50 px-3 py-2 text-xs font-bold text-navy-950">{label} <span className="ml-2 text-muted">{number(count)}</span></span>)}
    </div>
    <details className="rounded-lg border border-border p-3 text-xs text-muted">
      <summary className="cursor-pointer font-bold text-navy-950">How to complete pending classifications</summary>
      <p className="mt-2">In your spreadsheet, set section to CD, ACCOUNTS or ER Material/Unit and preserve the specific group (for example, Unit or Picture) in the optional category column. Material and Unit are also accepted directly in section and remain separate categories. Only Accounts needs Industry A or B.</p>
      <p className="mt-2">Upload the complete mapping again, then revalidate the source export. Each upload preserves a new mapping version; previous reports do not change.</p>
    </details>
    <div className="max-h-[32rem] overflow-auto rounded-lg border border-border">
      <table className="w-full min-w-[760px] text-left text-xs text-navy-950">
        <thead className="sticky top-0 bg-slate-50 text-muted"><tr>{["Queue ID", "Queue name", "Category", "Report section", "Industry", "Validation"].map(label => <th key={label} className="p-3">{label}</th>)}</tr></thead>
        <tbody>{entries.map(entry => {
          const missing = mappingPending(entry);
          return <tr key={entry.queueId} className="border-t border-border">
            <td className="p-3 font-bold">{entry.queueId}</td>
            <td className="min-w-[220px] p-3">{entry.queueName || "Pending queue name"}</td>
            <td className="p-3 font-bold">{entry.category || "—"}</td>
            <td className="p-3">{entry.section ? SECTION_NAMES[entry.section] : "Pending classification"}</td>
            <td className="p-3">{entry.industry || (entry.section === "ACCOUNTS" ? "Pending" : entry.section ? "Not applicable" : "Not provided")}</td>
            <td className={`p-3 font-bold ${missing.length ? "text-amber-600" : "text-emerald-600"}`}>{missing.length ? `Pending: ${missing.join(", ")}` : "Ready"}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
  </div>;
}
