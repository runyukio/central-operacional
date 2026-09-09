import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
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
  if (!valid.length) return { period: { startDate, endDate }, today, data: [], pending: 0, warnings, canRespond: scope.canRespond };
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
  return { period: { startDate, endDate }, today, data, pending: data.filter((row) => row.state === "pending").length, warnings: [...new Set(warnings)], canRespond: scope.canRespond };
}

export async function justifySpaceCoverage(scope: MeuEspacoScope, requirementId: string, input: { supervisorId?: string; text?: string; requestId?: string }) {
  if (!scope.canRespond) throw new MeuEspacoError("Seu perfil acompanha o Requerido somente em consulta.", 403);
  const supervisorId = scope.supervisorId || input.supervisorId;
  if (!supervisorId || !scope.activeSupervisorIds.includes(supervisorId)) throw new MeuEspacoError("Supervisor fora do escopo autorizado.", 403);
  const text = String(input.text ?? "").trim(), requestId = String(input.requestId ?? "");
  if (text.length < 5 || text.length > 10000) throw new MeuEspacoError("Descreva a justificativa em 5 a 10.000 caracteres.");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) throw new MeuEspacoError("Identificador de envio inválido. Atualize a tela.");
  const requirement = await prisma.staffCoverage.findUnique({ where: { id: requirementId }, select: { date: true } });
  if (!requirement) throw new MeuEspacoError("Requerido não encontrado.", 404);
  const date = requirement.date.toISOString().slice(0, 10);
  const result = await getSpaceCoverage(scope, new URLSearchParams({ startDate: date, endDate: date }));
  const slot = result.data.find((row) => row.id === requirementId && row.supervisors.some((s) => s.id === supervisorId));
  if (!slot) throw new MeuEspacoError("Requerido fora da sua LOB/turno.", 403);
  const previous = await prisma.spaceCoverageNote.findUnique({ where: { requestId } });
  if (previous) {
    if (previous.actorId !== scope.user.id || previous.supervisorId !== supervisorId || previous.requirementId !== requirementId || previous.text !== text) throw new MeuEspacoError("Este envio já foi utilizado para outra justificativa.", 409);
    return { success: true };
  }
  if (slot.state !== "pending") throw new MeuEspacoError("Este alerta já foi encerrado. Atualize o Requerido.", 409);
  try {
    await prisma.spaceCoverageNote.create({ data: { id: randomUUID(), requestId, requirementId, supervisorId, supervisorName: slot.supervisors.find((s) => s.id === supervisorId)!.name,
      actorId: scope.user.id, actorName: scope.user.name, date: requirement.date, lobId: slot.lobId, shiftId: slot.shiftId, required: slot.required, available: slot.available, text } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const saved = await prisma.spaceCoverageNote.findUnique({ where: { requestId } });
      if (saved?.actorId === scope.user.id && saved.supervisorId === supervisorId && saved.requirementId === requirementId && saved.text === text) return { success: true };
    }
    throw error;
  }
  return { success: true };
}
