import bcrypt from "bcryptjs";

import { Prisma, type EmployeeSensitiveData, type UserStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import type { Actor } from "@/lib/mock-db";
import { listEmployeesForActor as listMockEmployees, recordErrorLog } from "@/lib/mock-db";
import { canAccessEmployeeMap, canViewEmployeeSensitiveData, normalizeRole } from "@/lib/permissions";
import { createDuplicateError, createNotFoundError, createPermissionError, createRelationError, createServerError, createValidationError, mapPrismaError } from "@/lib/api-errors";
import { cleanShiftName } from "@/lib/shift-display";

const allowDemoDataFallback = process.env.ALLOW_DEMO_LOGIN === "true" || process.env.ALLOW_DEMO_DATA === "true";
const employeeInclude = {
  user: { include: { role: true } },
  lob: true,
  team: true,
  shift: true,
  supervisor: true,
  equipments: true
} satisfies Prisma.EmployeeProfileInclude;

export type EmployeeAdminUpdateInput = {
  id: string;
  fullName?: string;
  socialName?: string;
  email?: string;
  userStatus?: string;
  wbLogin?: string;
  roleTitle?: string;
  operationalStatus?: string;
  roleName?: string;
  lobId?: string;
  teamId?: string;
  supervisorId?: string;
  shiftId?: string;
  scheduleType?: string;
  contractType?: string;
  admissionDate?: string;
  trainingStartDate?: string;
  siteOperation?: string;
  internalNotes?: string;
  primaryPhone?: string;
  city?: string;
  stateUf?: string;
  preferredSchedule?: string;
};

export type EmployeeListQuery = {
  summary?: boolean;
  page?: number;
  limit?: number;
  search?: string;
  lob?: string;
  lobId?: string;
  supervisorId?: string;
  teamId?: string;
  shiftId?: string;
  status?: string;
  role?: string;
};

export async function listOperationalEmployees(actor: Actor, query: EmployeeListQuery = {}) {
  if (query.summary) return listOperationalEmployeesSummary(actor, query);
  try {
    const user = await prisma.user.findUnique({ where: { email: actor.email }, include: { role: true, employeeProfile: true } });
    if (!user) return allowDemoDataFallback ? listMockEmployees(actor) : [];

    const role = normalizeRole(actor.role);
    if (!canAccessEmployeeMap({ role: actor.role, status: user.status })) return [];
    let employeeWhere: Prisma.EmployeeProfileWhereInput =
      role === "COLABORADOR" && user.employeeProfile
        ? { id: user.employeeProfile.id, deletedAt: null }
        : { deletedAt: null };
    if (role === "SUPERVISOR" && user.employeeProfile) {
      const supervisedCount = await prisma.employeeProfile.count({ where: { supervisorId: user.employeeProfile.id, deletedAt: null } });
      employeeWhere = supervisedCount
        ? { supervisorId: user.employeeProfile.id, deletedAt: null }
        : { deletedAt: null };
    }
    const employees = await prisma.employeeProfile.findMany({
      where: employeeWhere,
      include: {
        ...employeeInclude
      },
      orderBy: { fullName: "asc" },
      take: 200
    });

    const shouldLoadSensitive = canViewEmployeeSensitiveData({ role: actor.role, status: user.status }) || role === "COLABORADOR";
    const sensitiveRows = employees.length && shouldLoadSensitive
      ? await prisma.employeeSensitiveData.findMany({ where: { employeeId: { in: employees.map((employee) => employee.id) } } })
      : [];
    const sensitiveByEmployee = new Map(sensitiveRows.map((item) => [item.employeeId, item]));

    return employees.map((employee) => mapEmployee(employee, role, sensitiveByEmployee.get(employee.id)));
  } catch (error) {
    if (isMissingEmployeeProfileColumnError(error)) {
      try {
        return await listOperationalEmployeesLegacy(actor);
      } catch (legacyError) {
        console.error("[employee] erro no fallback legado de colaboradores", legacyError);
      }
    }
    recordErrorLog({
      userEmail: actor.email,
      code: "EMPLOYEE_LIST_DB_ERROR",
      message: error instanceof Error ? error.message : "Falha ao listar colaboradores reais",
      route: "/api/employees",
      action: "EMPLOYEE_LIST",
      severity: "ERROR"
    });
    return allowDemoDataFallback ? listMockEmployees(actor) : [];
  }
}

async function listOperationalEmployeesSummary(actor: Actor, query: EmployeeListQuery) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(10, Number(query.limit) || 50));
  try {
    const user = await prisma.user.findUnique({ where: { email: actor.email }, include: { role: true, employeeProfile: true } });
    if (!user) {
      const fallback = allowDemoDataFallback ? listMockEmployees(actor) : [];
      return paginatedEmployees(fallback, fallback.length, page, limit);
    }

    const role = normalizeRole(actor.role);
    if (!canAccessEmployeeMap({ role: actor.role, status: user.status })) return paginatedEmployees([], 0, page, limit);
    const search = clean(query.search)?.trim();
    const statusWhere = buildEmployeeStatusWhere(query.status);

    let employeeWhere: Prisma.EmployeeProfileWhereInput =
      role === "COLABORADOR" && user.employeeProfile
        ? { id: user.employeeProfile.id, deletedAt: null }
        : {
          deletedAt: null,
          ...(search
            ? {
                OR: [
                  { fullName: { contains: search, mode: "insensitive" } },
                  { wbLogin: { contains: search, mode: "insensitive" } },
                  { user: { email: { contains: search, mode: "insensitive" } } }
                ]
              }
            : {}),
          ...(query.lob && query.lob !== "Todos" ? { lob: { name: { equals: query.lob, mode: "insensitive" } } } : {}),
          ...(query.lobId ? { lobId: query.lobId } : {}),
          ...(query.supervisorId ? { supervisorId: query.supervisorId } : {}),
          ...(query.teamId ? { teamId: query.teamId } : {}),
          ...(query.shiftId ? { shiftId: query.shiftId } : {}),
          ...(query.role ? { user: { role: { name: query.role } } } : {}),
          ...statusWhere
        };
    if (role === "SUPERVISOR" && user.employeeProfile) {
      const supervisedCount = await prisma.employeeProfile.count({ where: { supervisorId: user.employeeProfile.id, deletedAt: null } });
      employeeWhere = supervisedCount ? { ...employeeWhere, supervisorId: user.employeeProfile.id } : employeeWhere;
    }

    const total = await prisma.employeeProfile.count({ where: employeeWhere });
    const effectivePage = total > 0 && (page - 1) * limit >= total ? 1 : page;
    const employees = await prisma.employeeProfile.findMany({
      where: employeeWhere,
      select: employeeSummarySelect,
      orderBy: { fullName: "asc" },
      skip: (effectivePage - 1) * limit,
      take: limit
    });

    if (process.env.NODE_ENV !== "production") {
      console.info("[employees:summary]", {
        role,
        page: effectivePage,
        limit,
        total,
        returned: employees.length,
        filters: {
          search: Boolean(search),
          lob: query.lob ?? query.lobId ?? "Todos",
          supervisorId: query.supervisorId ?? "Todos",
          teamId: query.teamId ?? "Todos",
          shiftId: query.shiftId ?? "Todos",
          status: query.status ?? "Todos"
        }
      });
    }

    return paginatedEmployees(employees.map((employee) => mapEmployeeSummary(employee, role)), total, effectivePage, limit);
  } catch (error) {
    recordErrorLog({
      userEmail: actor.email,
      code: "EMPLOYEE_SUMMARY_LIST_ERROR",
      message: error instanceof Error ? error.message : "Falha ao listar resumo de colaboradores",
      route: "/api/employees",
      action: "EMPLOYEE_SUMMARY_LIST",
      severity: "ERROR"
    });
    const fallback = allowDemoDataFallback ? listMockEmployees(actor) : [];
    return paginatedEmployees(fallback, fallback.length, page, limit);
  }
}

export async function getOperationalEmployeeDetail(actor: Actor, id: string) {
  try {
    const user = await prisma.user.findUnique({ where: { email: actor.email }, include: { role: true, employeeProfile: true } });
    if (!user) return createPermissionError("Usuário não autenticado.");
    const role = normalizeRole(actor.role);
    if (!canAccessEmployeeMap({ role: actor.role, status: user.status })) return createPermissionError("Você não tem permissão para acessar o Mapa de Funcionários.");

    const employee = await prisma.employeeProfile.findFirst({
      where: { id, deletedAt: null },
      include: { ...employeeInclude }
    });
    if (!employee) return createNotFoundError("Colaborador não encontrado.");
    if (role === "COLABORADOR" && employee.userId !== user.id) return createPermissionError("Você não tem permissão para visualizar este colaborador.");
    if (role === "SUPERVISOR" && user.employeeProfile?.id) {
      const supervisedCount = await prisma.employeeProfile.count({ where: { supervisorId: user.employeeProfile.id, deletedAt: null } });
      if (supervisedCount && employee.supervisorId !== user.employeeProfile.id && employee.id !== user.employeeProfile.id) {
        return createPermissionError("Você não tem permissão para visualizar este colaborador.");
      }
    }

    const shouldLoadSensitive = canViewEmployeeSensitiveData({ role: actor.role, status: user.status }) || role === "COLABORADOR";
    const sensitive = shouldLoadSensitive ? await prisma.employeeSensitiveData.findUnique({ where: { employeeId: employee.id } }) : null;
    return { data: mapEmployee(employee, role, sensitive ?? undefined) };
  } catch (error) {
    recordErrorLog({
      userEmail: actor.email,
      code: "EMPLOYEE_DETAIL_ERROR",
      message: error instanceof Error ? error.message : "Falha ao carregar detalhe do colaborador",
      route: `/api/employees/${id}`,
      action: "EMPLOYEE_DETAIL",
      severity: "ERROR"
    });
    return mapPrismaError(error) ?? createServerError(error, "Não foi possível carregar os detalhes do colaborador.");
  }
}

type LegacyActorRow = {
  id: string;
  email: string;
  name: string;
  status: string;
  roleName: string;
  employeeProfileId: string | null;
};

type LegacyEmployeeRow = {
  id: string;
  userId: string | null;
  wbLogin: string;
  fullName: string;
  roleTitle: string;
  admissionDate: Date;
  scheduleType: string;
  operationalStatus: string;
  lobId: string;
  lob: string;
  teamId: string;
  team: string;
  supervisorId: string | null;
  supervisor: string | null;
  shiftId: string;
  shift: string;
  email: string | null;
  userStatus: string | null;
  systemRole: string | null;
};

type EmployeeSummaryRow = {
  id: string;
  userId: string | null;
  wbLogin: string;
  fullName: string;
  roleTitle: string;
  admissionDate: Date;
  scheduleType: string;
  operationalStatus: string;
  lobId: string;
  teamId: string;
  supervisorId: string | null;
  shiftId: string;
  user: { email: string; status: UserStatus; role: { name: string } } | null;
  lob: { name: string };
  team: { name: string };
  supervisor: { fullName: string } | null;
  shift: { name: string };
  _count: { equipments: number; schedules: number };
};

const employeeSummarySelect = {
  id: true,
  userId: true,
  wbLogin: true,
  fullName: true,
  roleTitle: true,
  admissionDate: true,
  scheduleType: true,
  operationalStatus: true,
  lobId: true,
  teamId: true,
  supervisorId: true,
  shiftId: true,
  user: { select: { email: true, status: true, role: { select: { name: true } } } },
  lob: { select: { name: true } },
  team: { select: { name: true } },
  supervisor: { select: { fullName: true } },
  shift: { select: { name: true } },
  _count: { select: { equipments: true, schedules: true } }
} satisfies Prisma.EmployeeProfileSelect;

async function listOperationalEmployeesLegacy(actor: Actor) {
  const [actorUser] = await prisma.$queryRaw<LegacyActorRow[]>`
    SELECT u.id, u.email, u.name, u.status, r.name AS "roleName", ep.id AS "employeeProfileId"
    FROM "User" u
    JOIN "Role" r ON r.id = u."roleId"
    LEFT JOIN "EmployeeProfile" ep ON ep."userId" = u.id AND ep."deletedAt" IS NULL
    WHERE u.email = ${actor.email} AND u."deletedAt" IS NULL
    LIMIT 1
  `;
  if (!actorUser) return [];
  const role = normalizeRole(actorUser.roleName);
  if (!canAccessEmployeeMap({ role: actorUser.roleName, status: actorUser.status })) return [];
  if (role === "COLABORADOR" && !actorUser.employeeProfileId) return [];

  let where = Prisma.sql`e."deletedAt" IS NULL`;
  if (role === "COLABORADOR" && actorUser.employeeProfileId) {
    where = Prisma.sql`e.id = ${actorUser.employeeProfileId} AND e."deletedAt" IS NULL`;
  }
  if (role === "SUPERVISOR" && actorUser.employeeProfileId) {
    const [count] = await prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COUNT(*)::bigint AS total
      FROM "EmployeeProfile" e
      WHERE e."supervisorId" = ${actorUser.employeeProfileId} AND e."deletedAt" IS NULL
    `;
    if (Number(count?.total ?? 0) > 0) {
      where = Prisma.sql`e."supervisorId" = ${actorUser.employeeProfileId} AND e."deletedAt" IS NULL`;
    }
  }

  const rows = await prisma.$queryRaw<LegacyEmployeeRow[]>(Prisma.sql`
    SELECT
      e.id,
      e."userId",
      e."wbLogin",
      e."fullName",
      e."roleTitle",
      e."admissionDate",
      e."scheduleType",
      e."operationalStatus",
      e."lobId",
      l.name AS lob,
      e."teamId",
      t.name AS team,
      e."supervisorId",
      sup."fullName" AS supervisor,
      e."shiftId",
      s.name AS shift,
      u.email,
      u.status AS "userStatus",
      ur.name AS "systemRole"
    FROM "EmployeeProfile" e
    JOIN "Lob" l ON l.id = e."lobId"
    JOIN "Team" t ON t.id = e."teamId"
    JOIN "Shift" s ON s.id = e."shiftId"
    LEFT JOIN "EmployeeProfile" sup ON sup.id = e."supervisorId"
    LEFT JOIN "User" u ON u.id = e."userId"
    LEFT JOIN "Role" ur ON ur.id = u."roleId"
    WHERE ${where}
    ORDER BY e."fullName" ASC
    LIMIT 200
  `);

  return rows.map((employee) => mapLegacyEmployee(employee, role));
}

export async function updateOperationalEmployee(actor: Actor, input: EmployeeAdminUpdateInput) {
  try {
    const user = await prisma.user.findUnique({ where: { email: actor.email }, include: { role: true } });
    if (!user) return createPermissionError("Usuário não autenticado.");
    const role = normalizeRole(actor.role);
    if (!["ADMIN", "GESTOR", "RH", "WFM"].includes(role)) return createPermissionError("Você não tem permissão para editar dados operacionais.");

    const employee = await prisma.employeeProfile.findFirst({
      where: { id: input.id, deletedAt: null },
      include: { ...employeeInclude }
    });
    if (!employee) return createNotFoundError("Colaborador não encontrado.");

    const actorIsAdmin = role === "ADMIN";
    const canEditOperational = ["ADMIN", "GESTOR", "WFM"].includes(role);
    const canEditPeopleData = ["ADMIN", "GESTOR", "RH"].includes(role);
    if (!canEditOperational && !canEditPeopleData) return createPermissionError("Você não tem permissão para editar dados do colaborador.");

    const adminOnlyFields: Array<keyof EmployeeAdminUpdateInput> = ["wbLogin", "roleName", "userStatus"];
    const sensitivePeopleFields: Array<keyof EmployeeAdminUpdateInput> = ["fullName", "socialName", "email", "primaryPhone", "city", "stateUf", "preferredSchedule", "contractType", "admissionDate", "trainingStartDate"];
    const operationalFields: Array<keyof EmployeeAdminUpdateInput> = ["roleTitle", "operationalStatus", "lobId", "teamId", "supervisorId", "shiftId", "scheduleType", "siteOperation", "internalNotes"];
    if (!actorIsAdmin && adminOnlyFields.some((field) => input[field] !== undefined)) return createPermissionError("Apenas Admin pode alterar WB/Login, role ou status de acesso.");
    if (!canEditPeopleData && sensitivePeopleFields.some((field) => input[field] !== undefined)) return createPermissionError("Você não tem permissão para editar dados cadastrais/contratuais.");
    if (!canEditOperational && operationalFields.some((field) => input[field] !== undefined)) return createPermissionError("Você não tem permissão para editar dados operacionais.");

    const nextFullName = clean(input.fullName);
    const nextSocialName = cleanNullable(input.socialName);
    const nextEmail = clean(input.email);
    const nextUserStatus = normalizeUserStatus(input.userStatus);
    const nextWbLogin = clean(input.wbLogin);
    const nextRoleTitle = clean(input.roleTitle);
    const nextStatus = clean(input.operationalStatus);
    const nextRoleName = clean(input.roleName);
    const nextSupervisorId = cleanNullable(input.supervisorId);
    const nextLobId = clean(input.lobId);
    const nextTeamId = clean(input.teamId);
    const nextShiftId = clean(input.shiftId);
    const nextScheduleType = clean(input.scheduleType);
    const nextContractType = cleanNullable(input.contractType);
    const nextAdmissionDate = parseDateInput(input.admissionDate, "Data de admissão inválida.");
    if ("error" in nextAdmissionDate) return createValidationError({ admissionDate: nextAdmissionDate.error });
    const nextTrainingDate = parseDateInput(input.trainingStartDate, "Data de treinamento inválida.");
    if ("error" in nextTrainingDate) return createValidationError({ trainingStartDate: nextTrainingDate.error });
    const nextSiteOperation = cleanNullable(input.siteOperation);
    const nextInternalNotes = cleanNullable(input.internalNotes);
    const nextPrimaryPhone = cleanNullable(input.primaryPhone);
    const nextCity = cleanNullable(input.city);
    const nextStateUf = cleanNullable(input.stateUf)?.toUpperCase() ?? undefined;
    const nextPreferredSchedule = cleanNullable(input.preferredSchedule);

    const hasAnyUpdate = Object.entries(input).some(([key, value]) => key !== "id" && value !== undefined);
    if (!hasAnyUpdate) return createValidationError({ form: "Informe ao menos um campo para atualizar." });
    if (input.fullName !== undefined && !nextFullName) return createValidationError({ fullName: "Nome obrigatório." });
    if (input.email !== undefined && (!nextEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail))) return createValidationError({ email: "E-mail inválido." });
    if (input.wbLogin !== undefined && !nextWbLogin) return createValidationError({ wbLogin: "WB/Login obrigatório." });
    if (input.lobId !== undefined && !nextLobId) return createValidationError({ lobId: "LOB é obrigatória." });
    if (input.teamId !== undefined && !nextTeamId) return createValidationError({ teamId: "Time é obrigatório." });
    if (input.shiftId !== undefined && !nextShiftId) return createValidationError({ shiftId: "Turno é obrigatório." });
    if (input.roleTitle !== undefined && !nextRoleTitle) return createValidationError({ roleTitle: "Cargo/Função é obrigatório." });
    if (input.operationalStatus !== undefined && !nextStatus) return createValidationError({ operationalStatus: "Status do colaborador é obrigatório." });
    if (input.scheduleType !== undefined && !nextScheduleType) return createValidationError({ scheduleType: "Cronograma é obrigatório." });
    if (input.stateUf !== undefined && nextStateUf && nextStateUf.length !== 2) return createValidationError({ stateUf: "Estado/UF deve ter 2 letras." });

    let targetRoleId: string | undefined;
    if (nextRoleName) {
      if (role !== "ADMIN") return createPermissionError("Apenas Admin pode alterar role/permissão de sistema.");
      const activeAdmins = await prisma.user.count({ where: { status: "ACTIVE", deletedAt: null, role: { name: "ADMIN" } } });
      if (employee.userId && employee.userId === user.id && employee.user?.role?.name === "ADMIN" && nextRoleName !== "ADMIN" && activeAdmins <= 1) {
        return createPermissionError("Não é permitido remover o único Admin ativo.");
      }
      const targetRole = await prisma.role.findUnique({ where: { name: nextRoleName } });
      if (!targetRole) return createValidationError({ roleName: "Role/Permissão selecionada não existe." }, "Role/Permissão selecionada não existe.");
      targetRoleId = targetRole.id;
    }
    if (nextUserStatus && !["ACTIVE", "INACTIVE", "BLOCKED"].includes(nextUserStatus)) return createValidationError({ userStatus: "Status de acesso inválido." });
    if (nextWbLogin && nextWbLogin !== employee.wbLogin) {
      const duplicatedWb = await prisma.employeeProfile.findFirst({ where: { wbLogin: nextWbLogin, deletedAt: null, id: { not: employee.id } } });
      if (duplicatedWb) return createDuplicateError("Já existe um colaborador com este WB/Login.", { wbLogin: "Este WB/Login já está em uso." });
    }
    if (nextEmail && nextEmail !== employee.user?.email) {
      const duplicatedEmail = await prisma.user.findFirst({ where: { email: nextEmail, deletedAt: null, id: employee.userId ? { not: employee.userId } : undefined } });
      if (duplicatedEmail) return createDuplicateError("Já existe usuário ativo com este e-mail.", { email: "Este e-mail já está vinculado a outro usuário ativo." });
    }
    if (nextSupervisorId) {
      const supervisor = await prisma.employeeProfile.findFirst({ where: { id: nextSupervisorId, deletedAt: null }, include: { user: { include: { role: true } } } });
      if (!supervisor?.user || !["SUPERVISOR", "ADMIN"].includes(supervisor.user.role.name)) {
        return createRelationError("Supervisor selecionado não existe ou não é elegível.", { supervisorId: "Selecione um supervisor com role SUPERVISOR ou ADMIN." });
      }
    }
    if (nextLobId) {
      const lob = await prisma.lob.findUnique({ where: { id: nextLobId } });
      if (!lob) return createRelationError("LOB selecionada não foi encontrada.", { lobId: "LOB selecionada não existe ou está inativa." });
    }
    if (nextTeamId) {
      const team = await prisma.team.findUnique({ where: { id: nextTeamId } });
      if (!team) return createRelationError("Time selecionado não foi encontrado.", { teamId: "Selecione um time válido." });
    }
    if (nextShiftId) {
      const shift = await prisma.shift.findUnique({ where: { id: nextShiftId } });
      if (!shift) return createRelationError("Turno selecionado não foi encontrado.", { shiftId: "Selecione um turno válido." });
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (employee.userId && (targetRoleId || nextEmail || nextUserStatus)) {
        await tx.user.update({
          where: { id: employee.userId },
          data: {
            ...(targetRoleId ? { roleId: targetRoleId } : {}),
            ...(nextEmail ? { email: nextEmail } : {}),
            ...(nextFullName ? { name: nextFullName } : {}),
            ...(nextUserStatus ? { status: nextUserStatus } : {})
          }
        });
      }
      const record = await tx.employeeProfile.update({
        where: { id: employee.id },
        data: {
          ...(nextFullName ? { fullName: nextFullName } : {}),
          ...(input.socialName !== undefined ? { socialName: nextSocialName } : {}),
          ...(input.primaryPhone !== undefined ? { primaryPhone: nextPrimaryPhone } : {}),
          ...(input.city !== undefined ? { city: nextCity } : {}),
          ...(input.stateUf !== undefined ? { stateUf: nextStateUf || null } : {}),
          ...(input.preferredSchedule !== undefined ? { preferredSchedule: nextPreferredSchedule } : {}),
          ...(nextWbLogin ? { wbLogin: nextWbLogin } : {}),
          ...(nextRoleTitle ? { roleTitle: nextRoleTitle } : {}),
          ...(nextStatus ? { operationalStatus: nextStatus } : {}),
          ...(nextSupervisorId !== undefined ? { supervisorId: nextSupervisorId || null } : {}),
          ...(nextLobId ? { lobId: nextLobId } : {}),
          ...(nextTeamId ? { teamId: nextTeamId } : {}),
          ...(nextShiftId ? { shiftId: nextShiftId } : {}),
          ...(nextScheduleType ? { scheduleType: nextScheduleType } : {}),
          ...(input.contractType !== undefined ? { contractType: nextContractType } : {}),
          ...(nextAdmissionDate.value ? { admissionDate: nextAdmissionDate.value } : {}),
          ...(input.trainingStartDate !== undefined ? { trainingStartDate: nextTrainingDate.value ?? null } : {}),
          ...(input.siteOperation !== undefined ? { siteOperation: nextSiteOperation } : {}),
          ...(input.internalNotes !== undefined ? { internalNotes: nextInternalNotes } : {})
        },
        include: { ...employeeInclude }
      });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "EDICAO",
          entity: "EmployeeProfile",
          entityId: employee.id,
          reason: "Atualização administrativa pós-aprovação",
          previousValue: serializeEmployeeForAudit(employee),
          newValue: serializeEmployeeForAudit(record)
        }
      });
      return record;
    });

    const sensitive = await prisma.employeeSensitiveData.findUnique({ where: { employeeId: updated.id } });
    return { data: mapEmployee(updated, role, sensitive ?? undefined) };
  } catch (error) {
    console.error("[employee] erro ao atualizar colaborador", error);
    recordErrorLog({
      userEmail: actor.email,
      code: "EMPLOYEE_UPDATE_DB_ERROR",
      message: error instanceof Error ? error.message : "Falha ao atualizar colaborador",
      route: "/api/employees",
      action: "EMPLOYEE_UPDATE",
      severity: "ERROR"
    });
    return mapPrismaError(error) ?? createServerError(error, "Erro inesperado ao atualizar colaborador. Tente novamente ou contate o administrador.");
  }
}

export async function exportOperationalEmployeesCsv(actor: Actor, filters: { query?: string | null; lob?: string | null; status?: string | null; supervisorId?: string | null; shiftId?: string | null }) {
  const user = await prisma.user.findUnique({ where: { email: actor.email }, include: { role: true } });
  if (!user) return createPermissionError("Usuário não autenticado.");
  if (!canAccessEmployeeMap({ role: actor.role, status: user.status })) return createPermissionError("Você não tem permissão para exportar o Mapa de Funcionários.");

  const role = normalizeRole(actor.role);
  const rowsResult = await listOperationalEmployees(actor);
  const rows = Array.isArray(rowsResult) ? rowsResult : rowsResult.data;
  const query = clean(filters.query)?.toLowerCase() ?? "";
  const lob = clean(filters.lob);
  const status = clean(filters.status);
  const supervisorId = clean(filters.supervisorId);
  const shiftId = clean(filters.shiftId);
  const filteredRows = rows.filter((employee) => {
    const row = employee as Record<string, any>;
    const matchesQuery = !query || [employee.name, employee.wb, employee.email].join(" ").toLowerCase().includes(query);
    const matchesLob = !lob || lob === "Todos" || employee.lob === lob;
    const matchesStatus = !status || status === "Todos" || matchesEmployeeStatusFilter(employee.status, row.userStatus, status);
    const matchesSupervisor = !supervisorId || row.supervisorId === supervisorId;
    const matchesShift = !shiftId || row.shiftId === shiftId;
    return matchesQuery && matchesLob && matchesStatus && matchesSupervisor && matchesShift;
  });

  const columns = employeeExportColumns(role);
  const csv = [
    columns.map((column) => csvEscape(column.header)).join(","),
    ...filteredRows.map((employee) => columns.map((column) => csvEscape(column.value(employee))).join(","))
  ].join("\n");

  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      action: "EDICAO",
      entity: "EmployeeProfile",
      entityId: "employee-map",
      reason: `Exportação CSV do Mapa de Funcionários (${role})`,
      previousValue: {},
      newValue: {
        role,
        filters,
        exportedRows: filteredRows.length,
        columns: columns.map((column) => column.header)
      }
    }
  }).catch((error) => {
    console.error("[employee] falha ao auditar exportação", error);
  });

  return {
    csv: `\uFEFF${csv}`,
    fileName: `mapa-funcionarios-${new Date().toISOString().slice(0, 10)}.csv`
  };
}

export async function resetEmployeeUserPassword(actor: Actor, input: { employeeId: string; password: string; confirmPassword: string }) {
  try {
    const admin = await prisma.user.findUnique({ where: { email: actor.email }, include: { role: true } });
    if (!admin) return { error: "Usuário não autenticado." };
    if (normalizeRole(actor.role) !== "ADMIN") return { error: "Apenas Admin pode resetar senha." };
    if (!input.password || input.password.length < 8) return { error: "A nova senha deve ter pelo menos 8 caracteres." };
    if (input.password !== input.confirmPassword) return { error: "A confirmação de senha não confere." };

    const employee = await prisma.employeeProfile.findFirst({ where: { id: input.employeeId, deletedAt: null }, include: { user: true } });
    if (!employee?.userId || !employee.user) return { error: "Este colaborador não possui usuário vinculado." };

    const passwordHash = await bcrypt.hash(input.password, 10);
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: employee.userId! },
        data: {
          passwordHash,
          status: "ACTIVE",
          mustChangePassword: true,
          temporaryPassword: true,
          lastPasswordResetAt: new Date(),
          passwordResetById: admin.id
        }
      });
      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: "EDICAO",
          entity: "User",
          entityId: employee.userId,
          reason: `Senha temporária redefinida manualmente para ${employee.fullName}`,
          previousValue: { passwordHash: "protected", mustChangePassword: employee.user?.mustChangePassword, temporaryPassword: employee.user?.temporaryPassword },
          newValue: { passwordHash: "updated", mustChangePassword: true, temporaryPassword: true }
        }
      });
    });

    return { success: true, message: "Senha temporária definida. O usuário deverá alterá-la no próximo acesso." };
  } catch (error) {
    console.error("[employee] erro ao resetar senha", error);
    recordErrorLog({
      userEmail: actor.email,
      code: "USER_PASSWORD_RESET_DB_ERROR",
      message: error instanceof Error ? error.message : "Falha ao resetar senha",
      route: "/api/employees/reset-password",
      action: "USER_PASSWORD_RESET",
      severity: "ERROR"
    });
    return { error: "Não foi possível resetar a senha." };
  }
}

type EmployeeWithRelations = Prisma.EmployeeProfileGetPayload<{ include: typeof employeeInclude }>;

function mapEmployee(employee: EmployeeWithRelations, role: string, sensitive?: EmployeeSensitiveData) {
  const canViewSensitive = ["ADMIN", "GESTOR", "RH"].includes(role);
  const canViewBank = ["ADMIN", "GESTOR"].includes(role);
  const canViewContact = ["ADMIN", "GESTOR", "RH", "TI"].includes(role);
  return {
    id: employee.id,
    name: employee.fullName,
    socialName: employee.socialName ?? "",
    wb: employee.wbLogin,
    lob: employee.lob.name,
    lobId: employee.lobId,
    team: employee.team.name,
    teamId: employee.teamId,
    supervisor: employee.supervisor?.fullName ?? "Sem supervisor",
    supervisorId: employee.supervisorId ?? "",
    shift: cleanShiftName(employee.shift.name) || "Sem turno",
    shiftId: employee.shiftId,
    schedule: employee.scheduleType,
    status: employee.operationalStatus,
    quality: null,
    productivity: null,
    equipment: employee.equipments.length,
    admission: formatDate(employee.admissionDate),
    admissionIso: toDateInput(employee.admissionDate),
    trainingStartDate: employee.trainingStartDate ? formatDate(employee.trainingStartDate) : "",
    trainingStartDateIso: employee.trainingStartDate ? toDateInput(employee.trainingStartDate) : "",
    contractType: employee.contractType ?? "",
    siteOperation: employee.siteOperation ?? "",
    internalNotes: employee.internalNotes ?? "",
    primaryPhone: employee.primaryPhone ?? "",
    city: employee.city ?? "",
    stateUf: employee.stateUf ?? "",
    preferredSchedule: employee.preferredSchedule ?? "",
    role: employee.roleTitle,
    email: employee.user?.email,
    userStatus: employee.user?.status ?? "",
    userId: employee.userId,
    systemRole: employee.user?.role?.name,
    canViewSensitive,
    restrictedSections: {
      cadastrais: canViewSensitive || role === "COLABORADOR",
      contato: canViewContact || role === "COLABORADOR",
      emergencia: canViewContact || canViewSensitive,
      bancarios: canViewBank,
      familia: canViewSensitive
    },
    sensitive: sensitive && canViewSensitive
      ? {
        cpf: sensitive.cpf,
        rg: sensitive.rg,
        rgIssuer: sensitive.rgIssuer,
        cnpj: sensitive.cnpj ?? "",
        birthDate: formatDate(sensitive.birthDate),
        address: jsonToText(sensitive.address),
        bankData: canViewBank ? jsonToText(sensitive.bankData) : "Acesso restrito",
        emergencyContactData: canViewContact ? jsonToText(sensitive.emergencyContactData) : "Acesso restrito",
        familyData: jsonToText(sensitive.familyData)
      }
      : undefined,
    maskedSensitive: sensitive
      ? {
        cpf: maskDocument(sensitive.cpf),
        rg: maskDocument(sensitive.rg),
        bankData: canViewBank ? jsonToText(sensitive.bankData) : "Acesso restrito",
        emergencyContactData: canViewContact ? jsonToText(sensitive.emergencyContactData) : "Acesso restrito"
      }
      : undefined
  };
}

function mapLegacyEmployee(employee: LegacyEmployeeRow, role: string) {
  const canViewSensitive = ["ADMIN", "GESTOR", "RH"].includes(role);
  return {
    id: employee.id,
    name: employee.fullName,
    socialName: "",
    wb: employee.wbLogin,
    lob: employee.lob,
    lobId: employee.lobId,
    team: employee.team,
    teamId: employee.teamId,
    supervisor: employee.supervisor ?? "Sem supervisor",
    supervisorId: employee.supervisorId ?? "",
    shift: cleanShiftName(employee.shift) || "Sem turno",
    shiftId: employee.shiftId,
    schedule: employee.scheduleType,
    status: employee.operationalStatus,
    quality: null,
    productivity: null,
    equipment: 0,
    admission: formatDate(employee.admissionDate),
    admissionIso: toDateInput(employee.admissionDate),
    trainingStartDate: "",
    trainingStartDateIso: "",
    contractType: "",
    siteOperation: "",
    internalNotes: "",
    primaryPhone: "",
    city: "",
    stateUf: "",
    preferredSchedule: "",
    role: employee.roleTitle,
    email: employee.email ?? undefined,
    userId: employee.userId ?? undefined,
    userStatus: employee.userStatus ?? "",
    systemRole: employee.systemRole ?? undefined,
    canViewSensitive,
    restrictedSections: {
      cadastrais: false,
      contato: false,
      emergencia: false,
      bancarios: false,
      familia: false
    },
    sensitive: undefined,
    maskedSensitive: undefined
  };
}

function mapEmployeeSummary(employee: EmployeeSummaryRow, role: string) {
  const canViewSensitive = ["ADMIN", "GESTOR", "RH"].includes(role);
  return {
    id: employee.id,
    name: employee.fullName,
    socialName: "",
    wb: employee.wbLogin,
    lob: employee.lob.name,
    lobId: employee.lobId,
    team: employee.team.name,
    teamId: employee.teamId,
    supervisor: employee.supervisor?.fullName ?? "Sem supervisor",
    supervisorId: employee.supervisorId ?? "",
    shift: cleanShiftName(employee.shift.name) || "Sem turno",
    shiftId: employee.shiftId,
    schedule: employee.scheduleType,
    status: employee.operationalStatus,
    quality: null,
    productivity: null,
    equipment: employee._count.equipments,
    admission: formatDate(employee.admissionDate),
    admissionIso: toDateInput(employee.admissionDate),
    trainingStartDate: "",
    trainingStartDateIso: "",
    contractType: "",
    siteOperation: "",
    internalNotes: "",
    primaryPhone: "",
    city: "",
    stateUf: "",
    preferredSchedule: "",
    role: employee.roleTitle,
    email: employee.user?.email,
    userStatus: employee.user?.status ?? "",
    userId: employee.userId ?? undefined,
    systemRole: employee.user?.role.name,
    canViewSensitive,
    hasSchedule: employee._count.schedules > 0,
    restrictedSections: {
      cadastrais: false,
      contato: false,
      emergencia: false,
      bancarios: false,
      familia: false
    },
    sensitive: undefined,
    maskedSensitive: undefined
  };
}

function employeeExportColumns(role: string) {
  const operational = [
    col("nome", (employee) => employee.name),
    col("email", (employee) => employee.email),
    col("wb_login", (employee) => employee.wb),
    col("cargo_funcao", (employee) => employee.role),
    col("role_permissao", (employee) => employee.systemRole),
    col("lob", (employee) => employee.lob),
    col("time", (employee) => employee.team),
    col("supervisor", (employee) => employee.supervisor),
    col("turno", (employee) => employee.shift),
    col("status_colaborador", (employee) => employee.status),
    col("status_usuario", (employee) => employee.userStatus),
    col("preferencia_horario", (employee) => employee.preferredSchedule),
    col("cronograma_vinculado", (employee) => employee.schedule ? "Sim" : "Não")
  ];
  if (role === "SUPERVISOR" || role === "WFM" || role === "QUALIDADE") return operational;

  const people = [
    col("nome_social", (employee) => employee.socialName),
    col("telefone_principal", (employee) => employee.primaryPhone),
    col("cidade", (employee) => employee.city),
    col("estado_uf", (employee) => employee.stateUf),
    col("tipo_contrato", (employee) => employee.contractType),
    col("data_admissao", (employee) => employee.admission),
    col("data_inicio_treinamento", (employee) => employee.trainingStartDate),
    col("site_operacao", (employee) => employee.siteOperation),
    col("observacoes_internas", (employee) => employee.internalNotes)
  ];
  if (role === "RH") {
    return [
      ...operational,
      ...people,
      col("cpf", (employee) => employee.sensitive?.cpf ?? employee.maskedSensitive?.cpf),
      col("rg", (employee) => employee.sensitive?.rg ?? employee.maskedSensitive?.rg),
      col("data_nascimento", (employee) => employee.sensitive?.birthDate),
      col("endereco", (employee) => employee.sensitive?.address),
      col("contato_emergencia", (employee) => employee.sensitive?.emergencyContactData)
    ];
  }
  if (role !== "ADMIN" && role !== "GESTOR") return operational;

  return [
    ...operational,
    ...people,
    col("cpf", (employee) => employee.sensitive?.cpf ?? employee.maskedSensitive?.cpf),
    col("rg", (employee) => employee.sensitive?.rg ?? employee.maskedSensitive?.rg),
    col("cnpj", (employee) => employee.sensitive?.cnpj),
    col("data_nascimento", (employee) => employee.sensitive?.birthDate),
    col("endereco", (employee) => employee.sensitive?.address),
    col("dados_bancarios_pix", (employee) => employee.sensitive?.bankData),
    col("contato_emergencia", (employee) => employee.sensitive?.emergencyContactData),
    col("dados_familiares", (employee) => employee.sensitive?.familyData),
    col("usuario_ativo", (employee) => employee.userId ? "Sim" : "Não")
  ];
}

function col(header: string, value: (employee: Record<string, any>) => unknown) {
  return { header, value: (employee: Record<string, any>) => value(employee) ?? "" };
}

function csvEscape(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function paginatedEmployees<T>(data: T[], total: number, page: number, limit: number) {
  return {
    data,
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit))
  };
}

const activeEmployeeStatusTokens = new Set([
  "ACTIVE",
  "ATIVO",
  "ATIVA",
  "APPROVED",
  "APROVADO",
  "APROVADA",
  "ONLINE",
  "EM_ATENDIMENTO",
  "EM ATENDIMENTO",
  "EM_TREINAMENTO",
  "EM TREINAMENTO",
  "NESTING"
]);

const pendingEmployeeStatusTokens = new Set([
  "PENDING",
  "PENDENTE",
  "PENDING_REGISTRATION",
  "PENDENTE_CADASTRO",
  "PENDENTE CADASTRO",
  "PENDENTE_DE_CADASTRO",
  "PENDENTE DE CADASTRO",
  "PENDENTE_APROVACAO",
  "PENDENTE APROVACAO",
  "PENDENTE_APROVAÇÃO",
  "PENDENTE APROVAÇÃO"
]);

const inactiveEmployeeStatusTokens = new Set([
  "INACTIVE",
  "INATIVO",
  "INATIVA",
  "OFFLINE",
  "DESLIGADO",
  "DESLIGADA",
  "CANCELLED",
  "CANCELADO",
  "CANCELADA",
  "SUSPENSO",
  "SUSPENSA"
]);

function buildEmployeeStatusWhere(status: unknown): Prisma.EmployeeProfileWhereInput {
  const raw = clean(status);
  if (!raw || isAllFilter(raw)) return {};
  const token = normalizeStatusToken(raw);
  if (["ATIVOS_APROVADOS", "ATIVOS", "ATIVO", "ACTIVE", "APROVADOS", "APROVADO", "APPROVED"].includes(token)) {
    return {
      OR: [
        { operationalStatus: { in: ["ACTIVE", "ATIVO", "Ativo", "APPROVED", "APROVADO", "Aprovado", "Online", "Em Atendimento", "Em treinamento", "EM_TREINAMENTO", "NESTING", "Nesting", "nesting"] } },
        { user: { status: "ACTIVE" } }
      ]
    };
  }
  if (token === "PENDENTES" || pendingEmployeeStatusTokens.has(token)) {
    return {
      operationalStatus: {
        in: ["PENDING", "PENDENTE", "Pendente", "Pendente de cadastro", "PENDENTE_CADASTRO", "PENDENTE_APROVACAO", "PENDENTE_APROVAÇÃO"]
      }
    };
  }
  if (token === "INATIVOS" || inactiveEmployeeStatusTokens.has(token)) {
    return {
      OR: [
        { operationalStatus: { in: ["INACTIVE", "INATIVO", "Inativo", "Offline", "DESLIGADO", "Desligado", "SUSPENSO", "Suspenso"] } },
        { user: { status: { in: ["INACTIVE", "BLOCKED"] } } }
      ]
    };
  }
  return { operationalStatus: { contains: raw, mode: "insensitive" } };
}

function matchesEmployeeStatusFilter(status: unknown, userStatus: unknown, filter: unknown) {
  const rawFilter = clean(filter);
  if (!rawFilter || isAllFilter(rawFilter)) return true;
  const token = normalizeStatusToken(rawFilter);
  const employeeToken = normalizeStatusToken(status);
  const userToken = normalizeStatusToken(userStatus);
  if (["ATIVOS_APROVADOS", "ATIVOS", "ATIVO", "ACTIVE", "APROVADOS", "APROVADO", "APPROVED"].includes(token)) {
    return activeEmployeeStatusTokens.has(employeeToken) || userToken === "ACTIVE";
  }
  if (token === "PENDENTES" || pendingEmployeeStatusTokens.has(token)) return pendingEmployeeStatusTokens.has(employeeToken);
  if (token === "INATIVOS" || inactiveEmployeeStatusTokens.has(token)) return inactiveEmployeeStatusTokens.has(employeeToken) || ["INACTIVE", "BLOCKED"].includes(userToken);
  return employeeToken.includes(token);
}

function isAllFilter(value: string) {
  return ["TODOS", "TODAS", "ALL", "TUDO"].includes(normalizeStatusToken(value));
}

function normalizeStatusToken(value: unknown) {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[/-]+/g, "_")
    .replace(/\s+/g, "_")
    .toUpperCase();
}

function isMissingEmployeeProfileColumnError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /EmployeeProfile\.(socialName|primaryPhone|city|stateUf|preferredSchedule|trainingStartDate|contractType|siteOperation|internalNotes)|column .* does not exist/i.test(message);
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("pt-BR").format(date);
}

function toDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function clean(value: unknown) {
  if (value === undefined) return undefined;
  return String(value ?? "").trim();
}

function cleanNullable(value: unknown) {
  if (value === undefined) return undefined;
  const next = String(value ?? "").trim();
  return next || null;
}

function normalizeUserStatus(value: unknown): UserStatus | undefined {
  const next = clean(value);
  if (!next) return undefined;
  const map: Record<string, UserStatus> = {
    ACTIVE: "ACTIVE",
    ATIVO: "ACTIVE",
    INACTIVE: "INACTIVE",
    INATIVO: "INACTIVE",
    BLOCKED: "BLOCKED",
    BLOQUEADO: "BLOCKED",
    SUSPENSO: "BLOCKED"
  };
  return map[next.toUpperCase()];
}

function parseDateInput(value: unknown, error: string): { value?: Date | null } | { error: string } {
  if (value === undefined) return { value: undefined };
  const text = clean(value);
  if (!text) return { value: null };
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return { error };
  return { value: date };
}

function serializeEmployeeForAudit(employee: EmployeeWithRelations) {
  return {
    fullName: employee.fullName,
    socialName: employee.socialName,
    email: employee.user?.email,
    userStatus: employee.user?.status,
    wbLogin: employee.wbLogin,
    roleTitle: employee.roleTitle,
    role: employee.user?.role?.name,
    operationalStatus: employee.operationalStatus,
    lobId: employee.lobId,
    teamId: employee.teamId,
    supervisorId: employee.supervisorId,
    shiftId: employee.shiftId,
    scheduleType: employee.scheduleType,
    contractType: employee.contractType,
    admissionDate: employee.admissionDate,
    trainingStartDate: employee.trainingStartDate,
    siteOperation: employee.siteOperation,
    internalNotes: employee.internalNotes,
    primaryPhone: employee.primaryPhone,
    city: employee.city,
    stateUf: employee.stateUf,
    preferredSchedule: employee.preferredSchedule
  };
}

function jsonToText(value: Prisma.JsonValue | null): string {
  if (!value) return "-";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(jsonToText).join(", ");
  return Object.entries(value)
    .map(([key, item]) => `${key}: ${jsonToText(item as Prisma.JsonValue)}`)
    .join(" | ");
}

function maskDocument(value?: string | null) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length <= 2) return "***";
  return `***${digits.slice(-2)}`;
}
