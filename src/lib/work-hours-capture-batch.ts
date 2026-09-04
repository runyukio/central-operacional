import { resolveCapturePeriod, type CapturePeriod } from "@/lib/work-hours-capture-period";

export type CaptureDayResult = { imported: number; unchanged: number; divergences: number; ignored: number; blocked?: number };
export type CaptureBatchResult = CaptureDayResult & { completedDates: string[]; blocked: number };

export function captureImportNeedsReview(result: CaptureDayResult) {
  return result.divergences > 0 || (result.blocked ?? 0) > 0;
}

export class CaptureBatchError extends Error {
  constructor(readonly failedDate: string, readonly result: CaptureBatchResult, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : "Não foi possível concluir a importação.";
    super(`${result.completedDates.length ? `Dias concluídos: ${result.completedDates.join(", ")}. ` : "Nenhum dia teve conclusão confirmada. "}Importação interrompida em ${failedDate}: ${reason} Os dias seguintes não foram processados. Antes de tentar novamente, consulte o período para conferir o que já foi salvo.`);
    this.name = "CaptureBatchError";
  }
}

// One transaction/request per day avoids a month-long database transaction.
// Never retry writes automatically after an ambiguous network failure.
export async function processCaptureImportDays(period: CapturePeriod, commitDay: (date: string) => Promise<CaptureDayResult>, onProgress: (date: string, index: number, total: number) => void) {
  const resolved = resolveCapturePeriod(period);
  if ("error" in resolved) throw new Error(resolved.error);
  const result: CaptureBatchResult = { imported: 0, unchanged: 0, divergences: 0, ignored: 0, blocked: 0, completedDates: [] };
  for (const [index, date] of resolved.dates.entries()) {
    onProgress(date, index + 1, resolved.dates.length);
    try {
      const day = await commitDay(date);
      result.imported += day.imported;
      result.unchanged += day.unchanged;
      result.divergences += day.divergences;
      result.ignored += day.ignored;
      result.blocked += day.blocked ?? 0;
      result.completedDates.push(date);
    } catch (error) {
      throw new CaptureBatchError(date, result, error);
    }
  }
  return result;
}
