import { z } from "zod";
import { isActiveUser, canManageStaffCoverageRequirements, type PermissionUser } from "./permissions";
import { roleHasCapability } from "./access-control";

const dayMs = 86_400_000;
export function isWaveDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= "2000-01-01" && value <= "2100-12-31"
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
const date = z.string().refine(isWaveDate, "Informe uma data válida entre 2000 e 2100.");
export const wavePlanSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome da wave.").max(100),
  lobId: z.string().min(1, "Selecione a LOB."),
  headcount: z.number().int().min(1, "Informe pelo menos uma pessoa.").max(10000),
  trainingStartDate: date,
  nestingStartDate: date,
  // Legacy storage name: this date closes nesting (exclusive); operation starts on nestingStartDate.
  goLiveDate: date,
  notes: z.string().trim().max(1000).default("")
}).superRefine((wave, context) => {
  if (wave.nestingStartDate <= wave.trainingStartDate) context.addIssue({ code: "custom", path: ["nestingStartDate"], message: "Nesting deve começar depois do início do treinamento." });
  if (wave.goLiveDate <= wave.nestingStartDate) context.addIssue({ code: "custom", path: ["goLiveDate"], message: "A conclusão do nesting deve ocorrer depois do início do nesting." });
});
export type WavePlanInput = z.infer<typeof wavePlanSchema>;
export type WavePlanItem = WavePlanInput & { id: string; lob: string; updatedAt: string };
export type WavePlansResponse = { data: WavePlanItem[]; lobs: Array<{ id: string; name: string }>; canManage: boolean };

export function wavePlanPermissions(user: PermissionUser) {
  return {
    canView: isActiveUser(user) && roleHasCapability(user.role, "CENTRAL"),
    canManage: canManageStaffCoverageRequirements(user)
  };
}
export function addWaveDays(value: string, days: number) {
  return new Date(Date.parse(value) + days * dayMs).toISOString().slice(0, 10);
}
export function waveDayOffset(start: string, end: string) {
  return Math.round((Date.parse(end) - Date.parse(start)) / dayMs);
}
// Date-only UTC arithmetic avoids DST and browser timezone shifts. End is exclusive.
export function waveSegment(start: string, end: string, monthStart: string, days: number) {
  const left = Math.max(0, waveDayOffset(monthStart, start));
  const right = Math.min(days, waveDayOffset(monthStart, end));
  return right > left ? { left: `${left / days * 100}%`, width: `${(right - left) / days * 100}%` } : null;
}
export function waveLobColor(lob: string) {
  const name = lob.toUpperCase();
  if (name === "ADS") return "#2563eb";
  if (name === "CEC") return "#0891b2";
  if (name === "TNS" || name === "VIDEO" || name === "VÍDEO") return "#db2777";
  let hash = 0;
  for (const letter of name) hash = (hash * 31 + letter.charCodeAt(0)) >>> 0;
  return ["#2563eb", "#0891b2", "#db2777", "#4f46e5", "#b45309"][hash % 5];
}
