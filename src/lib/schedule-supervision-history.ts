import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export type SupervisionTransfer = { employeeId: string; from: string; to: string; effectiveDate: string };
export type SupervisedSlot = { id?: string; employeeId?: string; date?: Date; supervisorId?: string | null;
  employee?: { id?: string; supervisorId?: string | null; supervisor?: { fullName: string } | null } | null };

// Reuse the audit manifest so legacy null snapshots retain their original
// interpretation without writing to historical Schedule rows.
export async function loadSupervisionTransfers(): Promise<SupervisionTransfer[]> {
  const logs = await prisma.auditLog.findMany({ where: { entity: "EmployeeSupervisionSwap" }, select: { newValue: true } });
  return logs.flatMap(({ newValue }) => {
    const value = newValue as { effectiveDate?: string; transfers?: SupervisionTransfer[] } | null;
    return value?.effectiveDate && Array.isArray(value.transfers)
      ? value.transfers.map((transfer) => ({ ...transfer, effectiveDate: value.effectiveDate! })) : [];
  }).sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
}

export function historicalSlotSupervisor(slot: SupervisedSlot, transfers: SupervisionTransfer[]) {
  if (slot.supervisorId) return slot.supervisorId;
  const employeeId = slot.employeeId ?? slot.employee?.id;
  const day = slot.date?.toISOString().slice(0, 10);
  const next = day && transfers.find((transfer) => transfer.employeeId === employeeId && transfer.effectiveDate > day);
  return next ? next.from : slot.employee?.supervisorId ?? null;
}

export function historicalSupervisorFilter(ids: string[], transfers: SupervisionTransfer[]): Prisma.ScheduleWhereInput {
  const employeeIds = [...new Set(transfers.map((transfer) => transfer.employeeId))];
  const fallback: Prisma.ScheduleWhereInput[] = [
    { employeeId: { notIn: employeeIds }, employee: { supervisorId: { in: ids } } }
  ];
  for (const employeeId of employeeIds) {
    const history = transfers.filter((transfer) => transfer.employeeId === employeeId);
    history.forEach((transfer, index) => {
      if (ids.includes(transfer.from)) fallback.push({ employeeId, date: {
        ...(index ? { gte: new Date(`${history[index - 1].effectiveDate}T00:00:00Z`) } : {}),
        lt: new Date(`${transfer.effectiveDate}T00:00:00Z`)
      } });
    });
    fallback.push({ employeeId, date: { gte: new Date(`${history[history.length - 1].effectiveDate}T00:00:00Z`) },
      employee: { supervisorId: { in: ids } } });
  }
  return { OR: [{ supervisorId: { in: ids } }, { supervisorId: null, OR: fallback }] };
}

export async function scheduleSupervisorNames(slots: SupervisedSlot[]) {
  if (!slots.length) return new Map<string, string>();
  const transfers = await loadSupervisionTransfers();
  const resolved = slots.map((slot) => ({ slot, supervisorId: historicalSlotSupervisor(slot, transfers) }));
  const ids = [...new Set(resolved.flatMap(({ supervisorId }) => supervisorId ? [supervisorId] : []))];
  const supervisors = ids.length ? await prisma.employeeProfile.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } }) : [];
  const names = new Map(supervisors.map((supervisor) => [supervisor.id, supervisor.fullName]));
  resolved.forEach(({ slot, supervisorId }) => {
    if (slot.id && supervisorId && names.has(supervisorId)) names.set(`schedule:${slot.id}`, names.get(supervisorId)!);
  });
  return names;
}
