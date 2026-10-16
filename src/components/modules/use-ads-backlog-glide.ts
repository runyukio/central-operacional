"use client";

import { useEffect, useState } from "react";
import { apiJson } from "./shared";
import { createClientRequestGate } from "@/lib/client-request-gate";
import type { AdsBacklogGlideResponse } from "@/lib/ads-backlog-glide-service";
import { GLIDE_REFRESH_MS } from "./ads-backlog-glide-display";

export function useAdsBacklogGlide(horizonDays: 7 | 14) {
  const url = `/api/staff-coverage/ads/backlog-glide?horizonDays=${horizonDays}`;
  const [revision, setRevision] = useState(0);
  const [gate] = useState(createClientRequestGate);
  const [clock, setClock] = useState(Date.now);
  const [read, setRead] = useState<{ url: string; data: AdsBacklogGlideResponse | null; receivedAt: number; loading: boolean; error: string }>({ url: "", data: null, receivedAt: 0, loading: true, error: "" });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const stop = () => { clearTimeout(timer); gate.cancel(); };
    const load = async () => {
      if (disposed || document.visibilityState !== "visible") return;
      clearTimeout(timer);
      const request = gate.begin();
      setClock(Date.now());
      setRead(current => ({ url, data: current.url === url ? current.data : null, receivedAt: current.url === url ? current.receivedAt : 0, loading: true, error: current.url === url ? current.error : "" }));
      try {
        const data = await apiJson<AdsBacklogGlideResponse>(url, { signal: request.signal, cache: "no-store" });
        if (!disposed && gate.isCurrent(request)) {
          const now = Date.now();
          setRead({ url, data, receivedAt: now, loading: false, error: "" });
          setClock(now);
        }
      } catch (error) {
        if (!disposed && gate.isCurrent(request)) setRead(current => ({ ...current, url, loading: false, error: error instanceof Error ? error.message : "Não foi possível atualizar o glide path." }));
      } finally {
        if (!disposed && gate.isCurrent(request) && document.visibilityState === "visible") timer = setTimeout(load, GLIDE_REFRESH_MS);
      }
    };
    const visibility = () => {
      if (document.visibilityState === "visible") { setClock(Date.now()); void load(); }
      else stop();
    };
    document.addEventListener("visibilitychange", visibility);
    // Keep freshness labels accurate even if the source becomes stale between hourly reads.
    const freshnessTimer = setInterval(() => { if (document.visibilityState === "visible") setClock(Date.now()); }, 60000);
    void load();
    return () => { disposed = true; stop(); clearInterval(freshnessTimer); document.removeEventListener("visibilitychange", visibility); };
  }, [url, revision, gate]);

  const matching = read.url === url;
  return {
    data: matching ? read.data : null,
    loading: !matching || read.loading,
    error: matching ? read.error : "",
    elapsedMs: matching && read.receivedAt ? Math.max(0, clock - read.receivedAt) : 0,
    recalculate: () => setRevision(value => value + 1),
  };
}
