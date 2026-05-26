import { AlertTriangle } from "lucide-react";

export function InactiveModulePage({ title }: { title: string }) {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-900 shadow-soft">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white text-amber-600">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-xl font-black text-navy-950">{title}</h1>
            <p className="mt-2 text-sm font-semibold text-amber-800">Este módulo está temporariamente inativo.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
