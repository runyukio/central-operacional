/** Small per-instance cache: shares concurrent work with bounded size and lifetime. */
export function createBoundedSnapshotCache<T>(ttlMs: number, maxEntries: number) {
  const entries = new Map<string, { expiresAt: number; value: Promise<T> }>();
  return {
    get(key: string, load: () => Promise<T>): Promise<T> {
      const now = Date.now();
      const cached = entries.get(key);
      if (cached && cached.expiresAt > now) return cached.value;
      entries.delete(key);
      for (const [entryKey, entry] of entries) {
        if (entry.expiresAt <= now) entries.delete(entryKey);
      }
      while (entries.size >= maxEntries) entries.delete(entries.keys().next().value!);
      const value = Promise.resolve().then(load);
      const entry = { expiresAt: now + ttlMs, value };
      entries.set(key, entry);
      void value.catch(() => {
        if (entries.get(key) === entry) entries.delete(key);
      });
      return value;
    },
    clear() { entries.clear(); }
  };
}
