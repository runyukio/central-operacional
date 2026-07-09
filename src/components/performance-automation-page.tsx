import { LockKeyhole, Trophy } from "lucide-react";

import { PerformancePage } from "@/components/modules";

export function PerformanceAutomationPage() {
  return <PerformancePage />;
}

export function PerformanceRestrictedPage() {
  return (
    <main className="space-y-5">
      <header className="flex items-center gap-3 border-b border-border pb-4">
        <span className="grid h-11 w-11 place-items-center rounded-2xl border border-blue-100 bg-blue-50 text-blue-600">
          <Trophy className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-3xl font-black tracking-tight text-navy-950">Performance</h1>
          <p className="text-sm font-bold text-muted">Acompanhamento da automação de produção e volume de entrada.</p>
        </div>
      </header>

      <section className="grid min-h-[360px] place-items-center rounded-3xl border border-border bg-white p-8 text-center shadow-sm">
        <div className="max-w-md">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-blue-50 text-blue-600">
            <LockKeyhole className="h-6 w-6" />
          </span>
          <h2 className="mt-5 text-2xl font-black text-navy-950">Acesso em validação</h2>
          <p className="mt-2 text-sm font-bold leading-6 text-muted">
            A nova visão de Performance e Forecast está liberada apenas para validação operacional.
          </p>
        </div>
      </section>
    </main>
  );
}
