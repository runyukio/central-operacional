import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { Actor } from "@/lib/mock-db";
import { normalizeRole } from "@/lib/permissions";
import { isAgentJobTitle } from "@/lib/job-title-normalization";
import { canRespondMeuEspaco, MeuEspacoError, resolveMeuEspacoSupervisor } from "@/lib/meu-espaco-access";
import { isActiveSpaceSupervisor } from "@/lib/meu-espaco-supervisors";

const profileSelect = {
  id: true, fullName: true, wbLogin: true, roleTitle: true, operationalStatus: true, deletedAt: true,
  supervisorId: true, goLiveDate: true, skill: true,
  lob: { select: { name: true } }, team: { select: { name: true } },
  supervisor: { select: { id: true, fullName: true } },
  user: { select: { status: true, deletedAt: true, role: { select: { name: true } } } },
  skillAssignments: { select: { skill: { select: { name: true } } } }
} satisfies Prisma.EmployeeProfileSelect;
export type SpaceEmployee = Prisma.EmployeeProfileGetPayload<{ select: typeof profileSelect }>;

export async function getMeuEspacoScope(actor: Actor, requestedSupervisor?: string) {
  const user = await prisma.user.findUnique({ where: { email: actor.email }, include: { role: true, employeeProfile: { select: { id: true, deletedAt: true } } } });
  if (!user || user.status !== "ACTIVE" || user.deletedAt) throw new MeuEspacoError("Sua sessão não tem acesso ao Meu Espaço.", 403);
  const permissionUser = { role: user.role.name, status: user.status };
  const supervisorId = resolveMeuEspacoSupervisor(permissionUser, user.employeeProfile?.deletedAt ? null : user.employeeProfile?.id ?? null, requestedSupervisor);
  const role = normalizeRole(user.role.name);
  const broad = role !== "SUPERVISOR";
  // Includes transferred partners only when they have hours still assigned to the selected owner.
  const profiles = await prisma.employeeProfile.findMany({
    where: { deletedAt: null, ...(supervisorId ? { OR: [{ supervisorId }, { id: supervisorId }, { adherenceJustifications: { some: { supervisorId } } }] } : {}) },
    select: profileSelect
  });
  const activeSupervisorIds = profiles.filter(isActiveSpaceSupervisor).map((profile) => profile.id);
  if (supervisorId && !activeSupervisorIds.includes(supervisorId)) throw new MeuEspacoError("Supervisor ativo não encontrado. Atualize a lista.", 404);
  const employees = profiles.filter((employee) => isAgentJobTitle(employee.roleTitle) && employee.supervisorId !== null
    && activeSupervisorIds.includes(employee.supervisorId) && (!supervisorId || employee.supervisorId === supervisorId));
  const employeeIds = employees.map((employee) => employee.id);
  return { user, actor: { email: user.email, name: user.name, role } as Actor, role, broad, supervisorId, activeSupervisorIds, employees, employeeIds, profiles, canRespond: canRespondMeuEspaco(permissionUser) };
}
export type MeuEspacoScope = Awaited<ReturnType<typeof getMeuEspacoScope>>;
