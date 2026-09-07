export type AdherenceCursor = { date: string; id: string };

export function encodeAdherenceCursor(row: { date: Date; id: string }) {
  return Buffer.from(JSON.stringify({ date: row.date.toISOString(), id: row.id })).toString("base64url");
}

export function decodeAdherenceCursor(value: string): AdherenceCursor {
  if (value.length > 1024) throw new Error("Cursor inválido.");
  const cursor = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  if (typeof cursor.id !== "string" || !cursor.id || cursor.id.length > 200
    || typeof cursor.date !== "string" || !Number.isFinite(new Date(cursor.date).getTime())
    || new Date(cursor.date).toISOString() !== cursor.date) throw new Error("Cursor inválido.");
  return { date: cursor.date, id: cursor.id };
}

// Keyset continuation uses immutable date + id, never status or an OFFSET.
// Bounded scans retain the existing eligibility checks without loading the period.
export async function scanAdherencePage<S extends { date: Date; id: string }, R extends { id: string }>(options: {
  cursor?: AdherenceCursor;
  limit: number;
  read: (after: AdherenceCursor | undefined, take: number) => Promise<S[]>;
  visible: (records: S[]) => Promise<R[]>;
}) {
  const data: R[] = [];
  let after = options.cursor;
  const batchSize = Math.max(50, options.limit * 2);
  for (let scan = 0; scan < 5; scan += 1) {
    const records = await options.read(after, batchSize);
    if (!records.length) return { data, pagination: { nextCursor: null, hasMore: false } };
    const visible = new Map((await options.visible(records)).map((row) => [row.id, row]));
    for (let index = 0; index < records.length; index += 1) {
      const source = records[index];
      after = { date: source.date.toISOString(), id: source.id };
      const row = visible.get(source.id);
      if (row) data.push(row);
      if (data.length === options.limit) {
        const hasMore = index < records.length - 1 || records.length === batchSize;
        return { data, pagination: { nextCursor: hasMore ? encodeAdherenceCursor(source) : null, hasMore } };
      }
    }
    if (records.length < batchSize) return { data, pagination: { nextCursor: null, hasMore: false } };
  }
  return { data, pagination: { nextCursor: encodeAdherenceCursor({ date: new Date(after!.date), id: after!.id }), hasMore: true } };
}
