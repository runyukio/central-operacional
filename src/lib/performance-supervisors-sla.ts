import { cecFrtMetrics, emptyCecFrt, type CecFrtCounts } from "@/lib/cec-frt";

export type SupervisorSlaTotals = {
  adsMinutesSum: number; adsSubmits: number;
  tnsMinutesSum: number; tnsSubmits: number;
  cec: CecFrtCounts;
};
export const emptySupervisorSlaTotals = (): SupervisorSlaTotals => ({
  adsMinutesSum: 0, adsSubmits: 0, tnsMinutesSum: 0, tnsSubmits: 0, cec: emptyCecFrt()
});
export function finishSupervisorSla(value: SupervisorSlaTotals, lobs: string[] = []) {
  const average = (sum: number, submits: number) => submits > 0 ? Math.round(sum / submits * 100) / 100 : null;
  return {
    lobs: [...new Set(lobs)].filter((lob) => ["ADS", "TNS", "CEC"].includes(lob)),
    ads: { minutes: average(value.adsMinutesSum, value.adsSubmits), submits: value.adsSubmits },
    tns: { minutes: average(value.tnsMinutesSum, value.tnsSubmits), submits: value.tnsSubmits },
    cec: cecFrtMetrics(value.cec)
  };
}
export type SupervisorSla = ReturnType<typeof finishSupervisorSla>;

export function formatSupervisorLatency(minutes: number | null | undefined) {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return "Sem dados";
  const rounded = Math.round(minutes);
  return `${String(Math.floor(rounded / 60)).padStart(2, "0")}:${String(rounded % 60).padStart(2, "0")}`;
}
