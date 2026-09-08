import { createClientRequestGate } from "@/lib/client-request-gate";
import type { SpacePending } from "@/lib/meu-espaco-contract";

export type SpacePendingPage = { data: SpacePending[]; hasMore: boolean; nextCursor: string | null };
export type SpaceFeedState = { rows: SpacePending[]; loading: boolean; loadingMore: boolean; initialized: boolean; error: string; hasMore: boolean; nextCursor: string | null };
export const emptySpaceFeed = (): SpaceFeedState => ({ rows: [], loading: false, loadingMore: false, initialized: false, error: "", hasMore: false, nextCursor: null });
export function createSpacePendingFeed(fetchPage: (query: string, cursor: string | null, signal: AbortSignal) => Promise<SpacePendingPage>, publish: (state: SpaceFeedState) => void) {
  const gate = createClientRequestGate();
  let query = "", state = emptySpaceFeed();
  const answered = new Map<string, SpacePending>();
  const key = (row: SpacePending) => `${row.kind}:${row.id}`;
  const emit = (patch: Partial<SpaceFeedState>) => { state = { ...state, ...patch }; publish(state); };
  async function read(more: boolean) {
    if (more && (state.loading || state.loadingMore || !state.hasMore)) return;
    const request = gate.begin();
    emit({ error: "", loading: !more, loadingMore: more });
    try {
      const page = await fetchPage(query, more ? state.nextCursor : null, request.signal);
      if (!gate.isCurrent(request)) return;
      const rows = new Map((more ? state.rows : []).map((row) => [key(row), row]));
      for (const row of page.data) {
        const current = answered.get(key(row)) ?? row;
        if (new URLSearchParams(query).get("state") !== "answered" && !current.pending) continue;
        rows.set(key(row), current);
      }
      emit({ rows: [...rows.values()], initialized: true, hasMore: page.hasMore, nextCursor: page.nextCursor, loading: false, loadingMore: false });
    } catch (error) {
      if (gate.isCurrent(request)) emit({ error: error instanceof Error ? error.message : "Não foi possível carregar as pendências.", loading: false, loadingMore: false });
    }
  }
  return {
    reset(next: string) { gate.cancel(); query = next; answered.clear(); state = emptySpaceFeed(); return read(false); },
    more() { return read(true); },
    retry() { return read(state.initialized); },
    invalidate() { gate.cancel(); },
    answer(row: SpacePending) {
      answered.set(key(row), row);
      emit({ rows: state.rows.flatMap((existing) => key(existing) !== key(row) ? [existing] : new URLSearchParams(query).get("state") === "answered" ? [row] : []) });
    }
  };
}
