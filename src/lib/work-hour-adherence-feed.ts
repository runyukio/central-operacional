import { filterWorkHourAdherenceRows, type WorkHourAdherenceFilters } from "./work-hour-adherence-filters";

export type WorkHourAdherenceRow = {
  id: string; employeeId: string; employeeName: string; wbLogin: string; date: string; lob: string;
  classification: string; supervisor: string; supervisorId: string; shift: string; plannedSlot: string;
  capturedDuration: string; durationSource: string; status: string; justification: string;
  answeredBy: string; answeredAt: string;
};
export type AdherencePage = { data: WorkHourAdherenceRow[]; pagination: { nextCursor: string | null; hasMore: boolean } };
export type AdherenceFeedState = {
  rows: WorkHourAdherenceRow[]; loading: boolean; loadingMore: boolean; initialized: boolean;
  error: string; nextCursor: string | null; hasMore: boolean;
};
export const emptyAdherenceFeed = (): AdherenceFeedState => ({
  rows: [], loading: false, loadingMore: false, initialized: false, error: "", nextCursor: null, hasMore: false
});

export function createAdherenceFeed(
  read: (filters: WorkHourAdherenceFilters, cursor: string | null, signal: AbortSignal) => Promise<AdherencePage>,
  publish: (state: AdherenceFeedState) => void
) {
  let state = emptyAdherenceFeed();
  let filters: WorkHourAdherenceFilters | null = null;
  let generation = 0;
  let request: AbortController | null = null;
  const updated = new Map<string, WorkHourAdherenceRow>();
  const emit = (next: AdherenceFeedState) => { state = next; publish(next); };
  const cancel = () => { generation += 1; request?.abort(); request = null; };
  async function loadMore() {
    if (!filters || request || (state.initialized && !state.hasMore)) return;
    const current = new AbortController();
    const version = generation;
    request = current;
    emit({ ...state, error: "", loading: !state.initialized, loadingMore: state.initialized });
    try {
      const page = await read(filters, state.nextCursor, current.signal);
      if (version !== generation || current.signal.aborted) return;
      const merged = new Map(state.rows.map((row) => [row.id, row]));
      for (const row of page.data) merged.set(row.id, updated.get(row.id) ?? row);
      emit({ rows: filterWorkHourAdherenceRows(Array.from(merged.values()), filters),
        ...page.pagination, initialized: true, loading: false, loadingMore: false, error: "" });
    } catch (error) {
      if (version !== generation || current.signal.aborted) return;
      emit({ ...state, loading: false, loadingMore: false,
        error: error instanceof Error ? error.message : "Não foi possível carregar as justificativas." });
    } finally {
      if (request === current) request = null;
    }
  }
  return {
    loadMore,
    invalidate() { cancel(); filters = null; updated.clear(); emit(emptyAdherenceFeed()); },
    reset(next: WorkHourAdherenceFilters) {
      cancel(); filters = { ...next }; updated.clear(); emit(emptyAdherenceFeed());
      return loadMore();
    },
    update(row: WorkHourAdherenceRow) {
      updated.set(row.id, row);
      const rows = state.rows.map((item) => item.id === row.id ? row : item);
      emit({ ...state, rows: filters ? filterWorkHourAdherenceRows(rows, filters) : rows });
    },
    dispose: cancel
  };
}
