import { prisma } from "@/lib/prisma";
import { readMeuEspacoCoverageSnapshot } from "@/lib/staff-coverage-service";
import { MeuEspacoError } from "@/lib/meu-espaco-access";
import { spaceDate, spaceToday } from "@/lib/meu-espaco-filters";
import { moveSpaceDay, spaceMonthEnd } from "@/lib/meu-espaco-glide";
import { coverageSlotEnd, coverageSlotState, coverageSupervisorMatches, type SpaceCoverage, type SpaceCoverageRow } from "@/lib/meu-espaco-coverage";
import type { MeuEspacoScope } from "@/lib/meu-espaco-scope";

export async function getSpaceCoverage(scope: MeuEspacoScope, query = new URLSearchParams(), now = new Date(), includeNotes = true): Promise<SpaceCoverage> {
  const today = spaceToday(now), startDate = query.get("startDate") || today, endDate = query.get("endDate") || spaceMonthEnd(today.slice(0, 7));
  const start = spaceDate(startDate), end = spaceDate(endDate);
  if (start > end || +end - +start > 366 * 86400000) throw new MeuEspacoError("Selecione até 366 dias para o Requerido.");
  const ids = scope.supervisorId ? [scope.supervisorId] : scope.activeSupervisorIds;
  const supervisors = ids.length ? await prisma.employeeProfile.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true, fullName: true, lobId: true, lob: { select: { name: true } }, shift: { select: { id: true, name: true, startsAt: true, endsAt: true } } } }) : [];
  const warnings: string[] = [];
  const valid = supervisors.filter((s) => {
    const ok = s.lobId && s.shift && ["Manhã", "Tarde", "Noite"].some((shift) => coverageSupervisorMatches({ lobId: s.lobId, lob: s.lob.name, shift: s.shift.name }, { lobId: s.lobId, lob: s.lob.name, shift }));
    if (!ok) warnings.push(`${s.fullName}: revise a LOB e o turno no cadastro.`);
    return ok;
  });
  if (!valid.length) return { period: { startDate, endDate }, today, data: [], pending: 0, warnings, canRespond: false };
  // Include yesterday's overnight shift only if it is still running in the default view.
  const includeOvernight = !query.get("startDate");
  const snapshot = await readMeuEspacoCoverageSnapshot(includeOvernight ? spaceDate(moveSpaceDay(startDate, -1)) : start, end);
  const data: SpaceCoverageRow[] = [];
  for (const slot of snapshot) {
    const owners = valid.filter((s) => coverageSupervisorMatches({ lobId: s.lobId, lob: s.lob.name, shift: s.shift.name }, slot));
    if (!owners.length) continue;
    // The shared alert has the same closing time in every authorized viewer's scope.
    const lastEnd = coverageSlotEnd(slot.date, slot.startsAt, slot.endsAt);
    const state = coverageSlotState(slot.required, slot.available, lastEnd, now);
    if (slot.date < startDate && state !== "pending") continue;
    if (state === "invalid_shift") warnings.push(`${slot.lob} / ${slot.shift}: horário inválido, não foi possível determinar o encerramento.`);
    data.push({ id: slot.requirementId, date: slot.date, lobId: slot.lobId, lob: slot.lob, shiftId: slot.shiftId, shift: slot.shift,
      required: slot.required, available: slot.available, deficit: Math.max(0, -slot.gap), state, endsAt: lastEnd?.toISOString() ?? null,
      supervisors: owners.map((s) => ({ id: s.id, name: s.fullName })), notes: [] });
  }
  for (const s of valid) {
    const matched = new Set(data.filter((row) => row.supervisors.some((owner) => owner.id === s.id)).map((row) => row.date));
    let missing = 0;
    for (let day = startDate; day <= endDate; day = moveSpaceDay(day, 1)) if (!matched.has(day)) missing++;
    if (missing) warnings.push(`${s.fullName}: ${missing} dia(s) sem Requerido cadastrado para sua LOB/turno no período.`);
  }
  const slotIds = data.map((row) => row.id);
  const notes = includeNotes && slotIds.length ? await prisma.spaceCoverageNote.findMany({ where: { requirementId: { in: slotIds }, supervisorId: { in: ids } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, requirementId: true, supervisorId: true, supervisorName: true, actorName: true, createdAt: true, text: true } }) : [];
  const byId = new Map(data.map((row) => [row.id, row]));
  for (const note of notes) byId.get(note.requirementId)?.notes.push({ id: note.id, supervisorId: note.supervisorId, supervisor: note.supervisorName, actor: note.actorName, createdAt: note.createdAt.toISOString(), text: note.text });
  return { period: { startDate, endDate }, today, data, pending: data.filter((row) => row.state === "pending").length, warnings: [...new Set(warnings)], canRespond: false };
}

// Retained as a guarded compatibility endpoint. Existing notes are read-only audit history.
export async function justifySpaceCoverage(_scope: MeuEspacoScope, _requirementId: string, _input: { supervisorId?: string; text?: string; requestId?: string }) {
  throw new MeuEspacoError("Requerido é apenas um alerta de cobertura e não recebe justificativas.", 403);
}
