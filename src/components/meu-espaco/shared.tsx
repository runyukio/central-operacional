"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { apiJson } from "@/components/modules/shared";
import { createClientRequestGate } from "@/lib/client-request-gate";
import { cn } from "@/lib/utils";

export function useSpaceRead<T>(url: string, enabled = true, revision = 0) {
  const [state, setState] = useState<{ key: string; url: string; data: T | null; error: string; loading: boolean }>({ key: "", url: "", data: null, error: "", loading: false });
  const [retry, setRetry] = useState(0);
  const [gate] = useState(createClientRequestGate);
  const cache = useRef<{ key: string; data: T }>();
  const key = `${url}:${revision}:${retry}`;
  useEffect(() => {
    if (!enabled) return;
    if (cache.current?.key === key) { setState({ key, url, data: cache.current.data, loading: false, error: "" }); return; }
    const request = gate.begin();
    // A count-only refresh must not unmount the pending feed after an answer.
    // A changed URL (scope or dates) hides the old data immediately.
    setState((current) => ({ key, url, data: current.url === url ? current.data : null, loading: true, error: "" }));
    apiJson<T>(url, { signal: request.signal, cache: "no-store" }).then((data) => {
      if (!gate.isCurrent(request)) return;
      cache.current = { key, data }; setState({ key, url, data, loading: false, error: "" });
    }).catch((error) => { if (gate.isCurrent(request)) setState((current) => ({ key, url, data: current.url === url ? current.data : null, error: error instanceof Error ? error.message : "Não foi possível carregar.", loading: false })); });
    return () => gate.cancel();
  }, [enabled, key, url, gate]);
  return { data: state.url === url ? state.data : null, error: state.key === key ? state.error : "", loading: enabled && (state.key !== key || state.loading), retry: () => setRetry((value) => value + 1) };
}
export const number = (value: number | null | undefined, suffix = "") => value == null ? "Sem dados" : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}${suffix}`;
export const dateLabel = (value: string | null | undefined) => value ? value.slice(0, 10).split("-").reverse().join("/") : "Sem dados";
export function SpaceLoad({ loading, error, retry }: { loading: boolean; error: string; retry: () => void }) {
  if (error) return <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-700">{error} <button type="button" onClick={retry} className="font-bold underline">Tentar novamente</button></div>;
  return loading ? <div role="status" className="flex items-center gap-2 p-5 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" />Carregando dados do espaço…</div> : null;
}
export function SpaceButtons({ label, value, options, onChange }: { label: string; value: string; options: { id: string; label: string }[]; onChange: (value: string) => void }) {
  return <fieldset><legend className="mb-2 text-xs font-bold text-muted">{label}</legend><div className="flex flex-wrap gap-2">{options.map((option) => <button key={option.id} type="button" aria-pressed={option.id === value} onClick={() => onChange(option.id)} className={cn("rounded-lg border px-3 py-2 text-sm font-bold", option.id === value ? "border-blue-600 bg-blue-600 text-white" : "border-border bg-white text-navy-950 hover:border-blue-400")}>{option.label}</button>)}</div></fieldset>;
}
export function SpaceCard({ title, value, helper }: { title: string; value: string; helper?: string }) {
  return <div className="card min-w-0 p-4"><p className="text-xs font-bold uppercase tracking-wide text-muted">{title}</p><p className="mt-2 break-words text-2xl font-extrabold text-navy-950">{value}</p>{helper ? <p className="mt-2 text-xs text-muted">{helper}</p> : null}</div>;
}
export const tableClass = "w-full text-left text-sm [&_th]:whitespace-nowrap [&_th]:bg-slate-50 [&_th]:px-4 [&_th]:py-3 [&_th]:text-xs [&_th]:font-bold [&_th]:text-muted [&_td]:border-t [&_td]:border-border [&_td]:px-4 [&_td]:py-3";
