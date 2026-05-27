import { Prisma } from "@prisma/client";

import type { Actor } from "@/lib/mock-db";
import { recordErrorLog } from "@/lib/mock-db";
import { createNotFoundError, createPermissionError, createRelationError, createServerError, createValidationError, mapPrismaError } from "@/lib/api-errors";
import { canAccessHierarchy, canManageHierarchy, normalizeRole } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export type HierarchyQuery = {
  employeeId?: string;
  search?: string;
  lobId?: string;
  lob?: string;
  supervisorId?: string;
  roleTitle?: string;
  status?: string;
};

const hierarchyEmployeeSelect = {
  id: true,
  fullName: true,
  wbLogin: true,
  roleTitle: true,
  operationalStatus: true,
  supervisorId: true,
  user: { select: { email: true, status: true } },
  lob: { select: { id: true, name: true } },
  supervisor: { select: { id: true, fullName: true, wbLogin: true } },
  _count: { select: { supervisees: true } }
} satisfies Prisma.EmployeeProfileSelect;

type HierarchyEmployee = Prisma.EmployeeProfileGetPayload<{ select: typeof hierarchyEmployeeSelect }>;

export type HierarchyEmployeeClient = {
  id: string;
  name: string;
  wbLogin: string;
  email: string;
  roleTitle: string;
  lob: string;
  lobId: string;
  status: string;
  supervisorId: string;
  supervisorName: string;
  directReports: number;
  totalReports: number;
  level: number;
};

export type HierarchyNode = HierarchyEmployeeClient & {
  children: HierarchyNode[];
};

export async function getHierarchy(actor: Actor, query: HierarchyQuery = {}) {
  try {
    const user = await prisma.user.findUnique({ where: { email: actor.email }, include: { role: true } });
    if (!user) return createPermissionError("Usuário não autenticado.");
    if (!canAccessHierarchy({ role: actor.role, status: user.status })) return createPermissionError("Você não tem permissão para acessar a Hierarquia.");

    const employees = await prisma.employeeProfile.findMany({
      where: { deletedAt: null },
      select: hierarchyEmployeeSelect,
      orderBy: [{ roleTitle: "asc" }, { fullName: "asc" }]
    });

    const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
    const childrenBySupervisor = new Map<string, HierarchyEmployee[]>();
    const roots: HierarchyEmployee[] = [];
    employees.forEach((employee) => {
      if (employee.supervisorId && employeeById.has(employee.supervisorId)) {
        const current = childrenBySupervisor.get(employee.supervisorId) ?? [];
        current.push(employee);
        childrenBySupervisor.set(employee.supervisorId, current);
      } else {
        roots.push(employee);
      }
    });

    const totalReportsById = new Map<string, number>();
    const countReports = (employeeId: string, visited = new Set<string>()): number => {
      if (totalReportsById.has(employeeId)) return totalReportsById.get(employeeId)!;
      if (visited.has(employeeId)) return 0;
      visited.add(employeeId);
      const children = childrenBySupervisor.get(employeeId) ?? [];
      const total = children.reduce((sum, child) => sum + 1 + countReports(child.id, new Set(visited)), 0);
      totalReportsById.set(employeeId, total);
      return total;
    };
    employees.forEach((employee) => countReports(employee.id));
    const levelById = new Map<string, number>();
    const assignLevel = (employee: HierarchyEmployee, level: number, visited = new Set<string>()) => {
      if (visited.has(employee.id)) return;
      visited.add(employee.id);
      levelById.set(employee.id, level);
      (childrenBySupervisor.get(employee.id) ?? []).forEach((child) => assignLevel(child, level + 1, new Set(visited)));
    };
    roots.forEach((employee) => assignLevel(employee, 0));

    const matchesFilters = (employee: HierarchyEmployee) => {
      const search = query.search?.trim().toLowerCase();
      const searchText = [employee.fullName, employee.wbLogin, employee.user?.email, employee.roleTitle, employee.lob.name, employee.supervisor?.fullName]
        .join(" ")
        .toLowerCase();
      if (search && !searchText.includes(search)) return false;
      if (query.lobId && query.lobId !== "Todos" && employee.lob.id !== query.lobId) return false;
      if (query.lob && query.lob !== "Todos" && employee.lob.name.toLowerCase() !== query.lob.toLowerCase()) return false;
      if (query.roleTitle && query.roleTitle !== "Todos" && employee.roleTitle.toLowerCase() !== query.roleTitle.toLowerCase()) return false;
      if (query.status && query.status !== "Todos" && !employee.operationalStatus.toLowerCase().includes(query.status.toLowerCase())) return false;
      if (query.supervisorId && query.supervisorId !== "Todos") {
        if (isNoneFilter(query.supervisorId)) {
          if (employee.supervisorId) return false;
        } else if (employee.supervisorId !== query.supervisorId) return false;
      }
      return true;
    };

    const displayedIds = new Set(employees.filter(matchesFilters).map((employee) => employee.id));
    const toClient = (employee: HierarchyEmployee, level = levelById.get(employee.id) ?? 0): HierarchyEmployeeClient => ({
      id: employee.id,
      name: employee.fullName,
      wbLogin: employee.wbLogin,
      email: employee.user?.email ?? "",
      roleTitle: employee.roleTitle,
      lob: employee.lob.name,
      lobId: employee.lob.id,
      status: employee.operationalStatus,
      supervisorId: employee.supervisorId ?? "",
      supervisorName: employee.supervisor?.fullName ?? "Sem supervisor",
      directReports: childrenBySupervisor.get(employee.id)?.length ?? employee._count.supervisees,
      totalReports: totalReportsById.get(employee.id) ?? 0,
      level
    });
    const buildNode = (employee: HierarchyEmployee, level = 0, includeAllDescendants = displayedIds.has(employee.id)): HierarchyNode => {
      const children = (childrenBySupervisor.get(employee.id) ?? [])
        .filter((child) => includeAllDescendants || displayedIds.has(child.id) || hasDisplayedDescendant(child.id, childrenBySupervisor, displayedIds))
        .map((child) => buildNode(child, level + 1, includeAllDescendants || displayedIds.has(child.id)));
      return {
        ...toClient(employee, level),
        children
      };
    };
    const tree = roots
      .filter((employee) => displayedIds.has(employee.id) || hasDisplayedDescendant(employee.id, childrenBySupervisor, displayedIds))
      .map((employee) => buildNode(employee));
    const flat = employees.filter((employee) => displayedIds.has(employee.id)).map((employee) => toClient(employee));

    const selectedEmployee = query.employeeId ? employeeById.get(query.employeeId) : null;
    const selected = selectedEmployee
      ? {
          ...toClient(selectedEmployee),
          direct: (childrenBySupervisor.get(selectedEmployee.id) ?? []).map((employee) => toClient(employee, 1)),
          all: collectReports(selectedEmployee.id, childrenBySupervisor).map((employee) => toClient(employee))
        }
      : null;

    return {
      data: {
        tree,
        employees: flat,
        selected,
        summary: {
          total: employees.length,
          withoutSupervisor: roots.length,
          withSupervisor: employees.length - roots.length
        },
        canEdit: canManageHierarchy({ role: actor.role, status: user.status }),
        canExport: canAccessHierarchy({ role: actor.role, status: user.status }),
        actorRole: normalizeRole(actor.role)
      }
    };
  } catch (error) {
    recordErrorLog({ userEmail: actor.email, code: "HIERARCHY_LIST_ERROR", message: error instanceof Error ? error.message : "Falha ao carregar hierarquia", action: "HIERARCHY_LIST", severity: "ERROR" });
    return mapPrismaError(error) ?? createServerError(error, "Não foi possível carregar a Hierarquia.");
  }
}

export async function updateEmployeeSupervisor(actor: Actor, input: { employeeId: string; supervisorId?: string | null }) {
  try {
    const user = await prisma.user.findUnique({ where: { email: actor.email }, include: { role: true } });
    if (!user) return createPermissionError("Usuário não autenticado.");
    if (!canManageHierarchy({ role: actor.role, status: user.status })) return createPermissionError("Você não tem permissão para editar hierarquia.");

    const supervisorId = input.supervisorId?.trim() || null;
    if (supervisorId && supervisorId === input.employeeId) {
      return createValidationError({ supervisorId: "O colaborador não pode ser supervisor de si mesmo." }, "O colaborador não pode ser supervisor de si mesmo.");
    }

    const employee = await prisma.employeeProfile.findFirst({
      where: { id: input.employeeId, deletedAt: null },
      select: { id: true, fullName: true, supervisorId: true }
    });
    if (!employee) return createNotFoundError("Colaborador não encontrado.");

    let supervisor: { id: string; fullName: string } | null = null;
    if (supervisorId) {
      supervisor = await prisma.employeeProfile.findFirst({
        where: { id: supervisorId, deletedAt: null },
        select: { id: true, fullName: true }
      });
      if (!supervisor) return createRelationError("Supervisor não encontrado.", { supervisorId: "Supervisor não encontrado." });
      if (await wouldCreateHierarchyCycle(employee.id, supervisor.id)) {
        return createValidationError({ supervisorId: "Essa alteração criaria um ciclo de supervisão." }, "Essa alteração criaria um ciclo de supervisão.");
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const record = await tx.employeeProfile.update({
        where: { id: employee.id },
        data: { supervisorId },
        select: hierarchyEmployeeSelect
      });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "EDICAO",
          entity: "EmployeeProfile",
          entityId: employee.id,
          reason: "SUPERVISOR_CHANGED",
          previousValue: { supervisorId: employee.supervisorId },
          newValue: { supervisorId, action: supervisorId ? "SUPERVISOR_ASSIGNED" : "SUPERVISOR_REMOVED" }
        }
      });
      return record;
    });

    return { data: { employee: updated } };
  } catch (error) {
    recordErrorLog({ userEmail: actor.email, code: "HIERARCHY_UPDATE_ERROR", message: error instanceof Error ? error.message : "Falha ao atualizar hierarquia", action: "HIERARCHY_UPDATE", severity: "ERROR" });
    return mapPrismaError(error) ?? createServerError(error, "Não foi possível atualizar a hierarquia.");
  }
}

export async function exportHierarchyXlsxData(actor: Actor, query: HierarchyQuery = {}) {
  const result = await getHierarchy(actor, query);
  if ("error" in result) return result;
  const rows = result.data.employees;
  const headers = ["nome", "wb_login", "email", "cargo_funcao", "lob", "status", "supervisor", "nivel_hierarquico", "subordinados_diretos", "subordinados_totais"];
  return {
    headers,
    rows: rows.map((employee) => [
      employee.name,
      employee.wbLogin,
      employee.email,
      employee.roleTitle,
      employee.lob,
      employee.status,
      employee.supervisorName,
      employee.level,
      employee.directReports,
      employee.totalReports
    ]),
    sheetName: "Hierarquia",
    fileName: `hierarquia_${new Date().toISOString().slice(0, 10)}.xlsx`
  };
}

async function wouldCreateHierarchyCycle(employeeId: string, supervisorId: string) {
  const seen = new Set<string>();
  let currentId: string | null = supervisorId;
  for (let depth = 0; currentId && depth < 500; depth += 1) {
    if (currentId === employeeId) return true;
    if (seen.has(currentId)) return true;
    seen.add(currentId);
    const current: { supervisorId: string | null } | null = await prisma.employeeProfile.findFirst({
      where: { id: currentId, deletedAt: null },
      select: { supervisorId: true }
    });
    currentId = current?.supervisorId ?? null;
  }
  return false;
}

function collectReports(employeeId: string, childrenBySupervisor: Map<string, HierarchyEmployee[]>, visited = new Set<string>()): HierarchyEmployee[] {
  if (visited.has(employeeId)) return [];
  visited.add(employeeId);
  const children = childrenBySupervisor.get(employeeId) ?? [];
  return children.flatMap((child) => [child, ...collectReports(child.id, childrenBySupervisor, visited)]);
}

function hasDisplayedDescendant(employeeId: string, childrenBySupervisor: Map<string, HierarchyEmployee[]>, displayedIds: Set<string>, visited = new Set<string>()): boolean {
  if (visited.has(employeeId)) return false;
  visited.add(employeeId);
  return (childrenBySupervisor.get(employeeId) ?? []).some((child) => displayedIds.has(child.id) || hasDisplayedDescendant(child.id, childrenBySupervisor, displayedIds, visited));
}

function isNoneFilter(value: string) {
  return /^(none|null|sem_supervisor|sem\s*supervisor)$/i.test(value.trim());
}
