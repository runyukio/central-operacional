/** Keeps only the newest read eligible to update a client view. */
export function createClientRequestGate() {
  let current: AbortController | null = null;
  return {
    begin() {
      current?.abort();
      current = new AbortController();
      return current;
    },
    isCurrent(request: AbortController) {
      return current === request && !request.signal.aborted;
    },
    cancel() {
      current?.abort();
      current = null;
    }
  };
}
