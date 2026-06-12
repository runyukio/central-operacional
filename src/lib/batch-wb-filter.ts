export type ParsedWbBatch = {
  values: string[];
  normalizedValues: string[];
  duplicatesRemoved: number;
};

export function parseWbLoginBatch(input: unknown): ParsedWbBatch {
  const raw = Array.isArray(input) ? input.join("\n") : String(input ?? "");
  const parts = raw
    .replace(/\u00a0/g, " ")
    .split(/[\n\r,;\t ]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const values: string[] = [];
  let duplicatesRemoved = 0;
  for (const part of parts) {
    const normalized = normalizeWbLogin(part);
    if (!normalized) continue;
    if (seen.has(normalized)) {
      duplicatesRemoved += 1;
      continue;
    }
    seen.add(normalized);
    values.push(part);
  }
  return {
    values,
    normalizedValues: values.map(normalizeWbLogin),
    duplicatesRemoved
  };
}

export function normalizeWbLogin(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\u00a0/g, " ")
    .trim()
    .toLowerCase();
}

export function serializeWbLogins(values: string[]) {
  return parseWbLoginBatch(values).values.join(",");
}
