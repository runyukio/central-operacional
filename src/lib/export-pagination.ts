export async function collectExportBatches<T extends { id: string }>(input: {
  total: number;
  fetchPage: (cursor: string | undefined, limit: number) => Promise<T[]>;
  batchSize?: number;
}) {
  const result: T[] = [];
  const size = input.batchSize ?? 500;
  let cursor: string | undefined;
  while (result.length < input.total) {
    const page = await input.fetchPage(cursor, size);
    if (!page.length) throw new Error("A exportação ficou incompleta. Tente novamente.");
    const next = page.at(-1)!.id;
    if (next === cursor) throw new Error("Não foi possível avançar a exportação.");
    result.push(...page);
    cursor = next;
  }
  if (result.length !== input.total) throw new Error("A quantidade exportada diverge do total consultado.");
  return result;
}
