import { Prisma, type EmployeeSensitiveData, type UserStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import type { Actor } from "@/lib/mock-db";
import { listEmployeesForActor as listMockEmployees, recordErrorLog } from "@/lib/mock-db";
import { canAccessEmployeeMap, canEditEmployeeData, canEditEmployeeSensitiveData, canManageRoles, canViewEmployeeSensitiveData, normalizeRole } from "@/lib/permissions";
import { auditPermissionDenied } from "@/lib/permission-audit";
import { createDuplicateError, createNotFoundError, createPermissionError, createRelationError, createServerError, createValidationError, mapPrismaError } from "@/lib/api-errors";
import { canBeSupervisorJobTitle, isAgentJobTitle, normalizeJobTitle } from "@/lib/job-title-normalization";
import { normalizeWbLogin, parseWbLoginBatch } from "@/lib/batch-wb-filter";
import { maskPixKey, validatePixKey } from "@/lib/pix-key";
import { cleanShiftName } from "@/lib/shift-display";
import { canAssignSecurityJobTitle } from "@/lib/security-classifications";
import { synchronizeUserPassword } from "@/lib/password-credentials";
import { assertActiveAdminRemains } from "@/lib/admin-invariant";

const allowDemoDataFallback = process.env.ALLOW_DEMO_LOGIN === "true" || process.env.ALLOW_DEMO_DATA === "true";
const employeeInclude = {
  user: { include: { role: true } },
  lob: true,
  team: true,
  shift: true,
  supervisor: true,
  skillAssignments: {
    include: { skill: true },
    orderBy: [{ isPrimary: "desc" as const }, { skill: { name: "asc" as const } }]
  },
  _count: { select: { supervisees: true } },
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
  supervisorId?: string;
  shiftId?: string;
  contractType?: string;
  skill?: string;
  skillIds?: string[];
  primarySkillId?: string;
  wave?: string;
  admissionDate?: string;
  trainingStartDate?: string;
  nestingStartDate?: string;
  goLiveDate?: string;
  workStartTime?: string;
  workEndTime?: string;
  terminationDate?: string;
  terminationType?: string;
  terminationReason?: string;
  ethnicity?: string;
  sexualOrientation?: string;
  isPcd?: string;
  pcdDisabilityType?: string;
  pcdDisabilityOther?: string;
  firstJob?: string;
  hasTelemarketingExperience?: string;
  telemarketingWhere?: string;
  siteOperation?: string;
  internalNotes?: string;
  primaryPhone?: string;
  city?: string;
  stateUf?: string;
  preferredSchedule?: string;
  cpf?: string;
  cnpj?: string;
  pixKey?: string;
  pixKeyType?: string;
};

export type EmployeeListQuery = {
  summary?: boolean;
  page?: number;
  limit?: number;
  search?: string;
  lob?: string[] | string;
  lobId?: string;
  supervisorId?: string[] | string;
  teamId?: string;
  shiftId?: string[] | string;
  contractType?: string[] | string;
  roleTitle?: string[] | string;
  skill?: string[] | string;
  wave?: string[] | string;
  status?: string[] | string;
  role?: string;
  wbLogins?: string[] | string;
};

export type EmployeeDeleteInput = {
  id: string;
  reason: string;
  confirmation: string;
};

export async function listOperationalEmployees(actor: Actor, query: EmployeeListQuery = {}) {
  if (query.summary) return listOperationalEmployeesSummary(actor, query);
  try {
    const user = await prisma.user.findUnique({ where: { email: actor.email }, include: { role: true, employeeProfile: true } });
    if (!user) return allowDemoDataFallback ? listMockEmployees(actor) : [];
    if (user.deletedAt) return [];
    actor = { ...actor, role: normalizeRole(user.role.name) };
    const role = normalizeRole(actor.role);
    if (!canAccessEmployeeMap({ role: actor.role, status: user.status })) return [];
    let employeeWhere: Prisma.EmployeeProfileWhereInput =
      role === "COLABORADOR" && user.employeeProfile
        ? { id: user.employeeProfile.id, deletedAt: null }
        : { deletedAt: null };
    const limit = Math.min(10000, Math.max(1, Number(query.limit) || 200));
    const employees = await prisma.employeeProfile.findMany({
      where: employeeWhere,
      include: {
        ...employeeInclude
      },
      orderBy: { fullName: "asc" },
      take: limit
    });

    const shouldLoadSensitive = canViewEmployeeSensitiveData({ role: actor.role, status: user.status });
    const sensitiveEmployeeIds = employees.map((employee) => employee.id);
    const sensitiveRows = employees.length && shouldLoadSensitive
      ? await prisma.employeeSensitiveData.findMany({ where: { employeeId: { in: sensitiveEmployeeIds } } })
      : [];
    const sensitiveByEmployee = new Map(sensitiveRows.map((item) => [item.employeeId, item]));

    return employees.map((employee) => mapEmployee(employee, role, sensitiveByEmployee.get(employee.id)));
  } catch (error) {
    if (isMissingEmployeeProfileColumnError(error)) {
      try {
        return await listOperationalEmployeesLegacy(actor);
      } catch (legacyError) {
        console.error("[employee] erro no fallback legado de parceiros", legacyError);
      }
    }
    recordErrorLog({
      userEmail: actor.email,
      code: "EMPLOYEE_LIST_DB_ERROR",
      message: error instanceof Error ? error.message : "Falha ao listar parceiros reais",
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
    if (user.deletedAt) return paginatedEmployees([], 0, page, limit);
    actor = { ...actor, role: normalizeRole(user.role.name) };
    const role = normalizeRole(actor.role);
    if (!canAccessEmployeeMap({ role: actor.role, status: user.status })) return paginatedEmployees([], 0, page, limit);
    const search = clean(query.search)?.trim();
    const cnpjEmployeeIds = search && canViewEmployeeSensitiveData({ role: actor.role, status: user.status })
      ? await findEmployeeIdsByCnpjSearch(search)
      : [];
    const statusWhere = buildEmployeeStatusWhere(query.status);
    const batch = parseWbLoginBatch(query.wbLogins ?? "");

    const primaryFilter: Prisma.EmployeeProfileWhereInput = {
      deletedAt: null,
      ...(search
        ? {
            OR: [
              { fullName: { contains: search, mode: "insensitive" as const } },
              { wbLogin: { contains: search, mode: "insensitive" as const } },
              { user: { email: { contains: search, mode: "insensitive" as const } } },
              { roleTitle: { contains: search, mode: "insensitive" as const } },
              { skill: { contains: search, mode: "insensitive" as const } },
              { skillAssignments: { some: { skill: { name: { contains: search, mode: "insensitive" as const } } } } },
              { wave: { contains: search, mode: "insensitive" as const } },
              { lob: { name: { contains: search, mode: "insensitive" as const } } },
              { supervisor: { fullName: { contains: search, mode: "insensitive" as const } } },
              ...(cnpjEmployeeIds.length ? [{ id: { in: cnpjEmployeeIds } }] : [])
            ]
          }
        : {})
    };
    const filterParts: Prisma.EmployeeProfileWhereInput[] = [
      primaryFilter,
      buildEmployeeMapLobFilterWhere(query.lob),
      query.lobId ? { lobId: query.lobId } : {},
      buildSupervisorFilterWhere(query.supervisorId),
      query.teamId ? { teamId: query.teamId } : {},
      buildIdFilterWhere("shiftId", query.shiftId),
      buildContractTypeFilterWhere(query.contractType),
      buildNullableTextFilterWhere("roleTitle", query.roleTitle),
      buildEmployeeSkillFilterWhere(query.skill),
      buildNullableTextFilterWhere("wave", query.wave),
      query.role ? { user: { role: { name: query.role } } } : {}
    ].filter(hasWhereInput);
    let baseEmployeeWhere: Prisma.EmployeeProfileWhereInput =
      role === "COLABORADOR" && user.employeeProfile
        ? { id: user.employeeProfile.id, deletedAt: null }
        : { AND: filterParts };
    if (!(role === "COLABORADOR" && user.employeeProfile) && batch.normalizedValues.length) {
      baseEmployeeWhere = {
        AND: [
          baseEmployeeWhere,
          { OR: batch.normalizedValues.map((wbLogin) => ({ wbLogin: { equals: wbLogin, mode: "insensitive" } })) }
        ]
      };
    }
    const employeeWhere: Prisma.EmployeeProfileWhereInput = hasWhereInput(statusWhere)
      ? { AND: [baseEmployeeWhere, statusWhere] }
      : baseEmployeeWhere;

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

	    const filterOptions = await getEmployeeFilterOptions(baseEmployeeWhere);
    const contractSummary = await getEmployeeContractSummary(employeeWhere);
    const batchWb = await resolveEmployeeBatchWb(query.wbLogins);
    return {
      ...paginatedEmployees(employees.map((employee) => mapEmployeeSummary(employee, role)), total, effectivePage, limit),
      filterOptions,
      contractSummary,
      batchWb
    };
  } catch (error) {
    recordErrorLog({
      userEmail: actor.email,
      code: "EMPLOYEE_SUMMARY_LIST_ERROR",
      message: error instanceof Error ? error.message : "Falha ao listar resumo de parceiros",
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
    if (user.deletedAt) return createPermissionError("Usuário sem acesso ativo.");
    actor = { ...actor, role: normalizeRole(user.role.name) };
    const role = normalizeRole(actor.role);
    if (!canAccessEmployeeMap({ role: actor.role, status: user.status })) return createPermissionError("Você não tem permissão para acessar o Mapa de Parceiros.");

    const employee = await prisma.employeeProfile.findFirst({
      where: { id, deletedAt: null },
      include: { ...employeeInclude }
    });
    if (!employee) return createNotFoundError("Parceiro não encontrado.");
    if (role === "COLABORADOR" && employee.userId !== user.id) return createPermissionError("Você não tem permissão para visualizar este parceiro.");

    const shouldLoadSensitive = canViewEmployeeSensitiveData({ role: actor.role, status: user.status }, { roleTitle: employee.roleTitle, email: employee.user?.email });
    const sensitive = shouldLoadSensitive ? await prisma.employeeSensitiveData.findUnique({ where: { employeeId: employee.id } }) : null;
    return { data: mapEmployee(employee, role, sensitive ?? undefined) };
  } catch (error) {
    recordErrorLog({
      userEmail: actor.email,
      code: "EMPLOYEE_DETAIL_ERROR",
      message: error instanceof Error ? error.message : "Falha ao carregar detalhe do parceiro",
      route: `/api/employees/${id}`,
      action: "EMPLOYEE_DETAIL",
      severity: "ERROR"
    });
    return mapPrismaError(error) ?? createServerError(error, "Não foi possível carregar os detalhes do parceiro.");
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
  terminationDate: Date | null;
  terminationType: string | null;
  terminationReason: string | null;
  workStartTime: string | null;
  workEndTime: string | null;
  contractType: string | null;
  scheduleType: string;
  operationalStatus: string;
  skill: string | null;
  skillAssignments: Array<{
    isPrimary: boolean;
    skill: { id: string; name: string; color: string; status: string };
  }>;
  wave: string | null;
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
  terminationDate: Date | null;
  terminationType: string | null;
  terminationReason: string | null;
  workStartTime: string | null;
  workEndTime: string | null;
  scheduleType: string;
  operationalStatus: string;
  skill: string | null;
  skillAssignments: Array<{
    isPrimary: boolean;
    skill: { id: string; name: string; color: string; status: string };
  }>;
  wave: string | null;
  lobId: string;
  teamId: string;
  supervisorId: string | null;
  shiftId: string;
  user: { email: string; status: UserStatus; role: { name: string } } | null;
  lob: { name: string };
  team: { name: string };
  supervisor: { fullName: string } | null;
  shift: { name: string };
  _count: { equipments: number; schedules: number; supervisees: number };
};

const employeeSummarySelect = {
  id: true,
  userId: true,
  wbLogin: true,
  fullName: true,
  roleTitle: true,
  admissionDate: true,
  terminationDate: true,
  terminationType: true,
  terminationReason: true,
  workStartTime: true,
  workEndTime: true,
  contractType: true,
  scheduleType: true,
  operationalStatus: true,
  skill: true,
  skillAssignments: {
    select: {
      isPrimary: true,
      skill: { select: { id: true, name: true, color: true, status: true } }
    },
    orderBy: [{ isPrimary: "desc" as const }, { skill: { name: "asc" as const } }]
  },
  wave: true,
  lobId: true,
  teamId: true,
  supervisorId: true,
  shiftId: true,
  user: { select: { email: true, status: true, role: { select: { name: true } } } },
  lob: { select: { name: true } },
  team: { select: { name: true } },
  supervisor: { select: { fullName: true } },
  shift: { select: { name: true } },
  _count: { select: { equipments: true, schedules: true, supervisees: true } }
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
  const rows = await prisma.$queryRaw<LegacyEmployeeRow[]>(Prisma.sql`
    SELECT
      e.id,
      e."userId",
      e."wbLogin",
      e."fullName",
      e."roleTitle",
      e."admissionDate",
      NULL::timestamp AS "terminationDate",
      NULL::text AS "terminationType",
      NULL::text AS "terminationReason",
      NULL::text AS "workStartTime",
      NULL::text AS "workEndTime",
      e."scheduleType",
      e."operationalStatus",
      e."skill",
      e."wave",
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
    if (user.deletedAt) return createPermissionError("Usuário sem acesso ativo.");
    actor = { ...actor, role: normalizeRole(user.role.name) };
    const role = normalizeRole(actor.role);
    if (!canEditEmployeeData({ role: actor.role, status: user.status })) {
      const reason = role === "SUPERVISOR" ? "Supervisor não possui permissão para editar cadastros." : "Você não tem permissão para editar dados operacionais.";
      await auditPermissionDenied(actor, { action: "EMPLOYEE_UPDATE", entity: "EmployeeProfile", reason, entityId: input.id });
      return createPermissionError(reason);
    }

    const employee = await prisma.employeeProfile.findFirst({
      where: { id: input.id, deletedAt: null },
      include: { ...employeeInclude }
    });
    if (!employee) return createNotFoundError("Parceiro não encontrado.");
    const actorCanManageRoles = canManageRoles({ role: actor.role, status: user.status });
    const canEditOperational = canEditEmployeeData({ role: actor.role, status: user.status });
    const canEditPeopleData = canEditEmployeeSensitiveData({ role: actor.role, status: user.status });
    const canEditProfileOperational = canEditOperational;
    if (!canEditOperational && !canEditPeopleData) return createPermissionError("Você não tem permissão para editar dados do parceiro.");

    const adminOnlyFields: Array<keyof EmployeeAdminUpdateInput> = ["roleName"];
    const sensitivePeopleFields: Array<keyof EmployeeAdminUpdateInput> = ["fullName", "socialName", "email", "userStatus", "wbLogin", "primaryPhone", "city", "stateUf", "preferredSchedule", "contractType", "admissionDate", "trainingStartDate", "terminationDate", "terminationType", "terminationReason", "ethnicity", "sexualOrientation", "isPcd", "pcdDisabilityType", "pcdDisabilityOther", "firstJob", "hasTelemarketingExperience", "telemarketingWhere", "cpf", "cnpj", "pixKey", "pixKeyType"];
    const operationalBindingFields: Array<keyof EmployeeAdminUpdateInput> = ["lobId", "supervisorId", "shiftId", "siteOperation"];
    const profileOperationalFields: Array<keyof EmployeeAdminUpdateInput> = ["roleTitle", "operationalStatus", "internalNotes", "skill", "skillIds", "primarySkillId", "wave", "nestingStartDate", "goLiveDate", "workStartTime", "workEndTime"];
    if (!actorCanManageRoles && adminOnlyFields.some((field) => input[field] !== undefined)) return createPermissionError("Apenas Admin pode alterar role/permissão.");
    if (!canEditPeopleData && sensitivePeopleFields.some((field) => input[field] !== undefined)) return createPermissionError("Você não tem permissão para editar dados cadastrais/contratuais.");
    if (!canEditOperational && operationalBindingFields.some((field) => input[field] !== undefined)) return createPermissionError("Você não tem permissão para editar vínculos operacionais.");
    if (!canEditProfileOperational && profileOperationalFields.some((field) => input[field] !== undefined)) return createPermissionError("Você não tem permissão para editar dados operacionais.");
    const nextFullName = clean(input.fullName);
    const nextSocialName = cleanNullable(input.socialName);
    const nextEmail = clean(input.email);
    const nextUserStatus = normalizeUserStatus(input.userStatus);
    const nextWbLogin = clean(input.wbLogin);
    const nextRoleTitle = input.roleTitle === undefined ? undefined : normalizeJobTitle(input.roleTitle);
    if (!canAssignSecurityJobTitle(user.role.name, employee.roleTitle, nextRoleTitle)) {
      return createPermissionError("Apenas Admin pode atribuir ou remover o cargo Financeiro, pois ele concede acesso a pagamentos.");
    }
    const nextStatus = clean(input.operationalStatus);
    const inferredUserStatus = canEditPeopleData && nextStatus ? userStatusFromOperationalStatus(nextStatus) : undefined;
    const nextRoleName = clean(input.roleName);
    const nextSupervisorId = cleanNullable(input.supervisorId);
    const nextLobId = clean(input.lobId);
    const nextShiftId = clean(input.shiftId);
    const nextContractType = cleanNullable(input.contractType);
    const nextAdmissionDate = parseDateInput(input.admissionDate, "Data de admissão inválida.");
    if ("error" in nextAdmissionDate) return createValidationError({ admissionDate: nextAdmissionDate.error });
    const nextTrainingDate = parseDateInput(input.trainingStartDate, "Data de treinamento inválida.");
    if ("error" in nextTrainingDate) return createValidationError({ trainingStartDate: nextTrainingDate.error });
    const nextNestingStartDate = parseDateInput(input.nestingStartDate, "Data de início de Nesting inválida.");
    if ("error" in nextNestingStartDate) return createValidationError({ nestingStartDate: nextNestingStartDate.error });
    const nextGoLiveDate = parseDateInput(input.goLiveDate, "Data de Go Live inválida.");
    if ("error" in nextGoLiveDate) return createValidationError({ goLiveDate: nextGoLiveDate.error });
    const nextWorkStartTime = normalizeWorkTimeInput(input.workStartTime, "Horário de entrada inválido.");
    if ("error" in nextWorkStartTime) return createValidationError({ workStartTime: nextWorkStartTime.error });
    const nextWorkEndTime = normalizeWorkTimeInput(input.workEndTime, "Horário de saída inválido.");
    if ("error" in nextWorkEndTime) return createValidationError({ workEndTime: nextWorkEndTime.error });
    const nextTerminationDate = parseDateInput(input.terminationDate, "Data de desligamento inválida.");
    if ("error" in nextTerminationDate) return createValidationError({ terminationDate: nextTerminationDate.error });
    const inferredTerminationUserStatus = canEditPeopleData && isPastOrTodaySaoPaulo(nextTerminationDate.value) ? "INACTIVE" : undefined;
    const effectiveUserStatus = inferredUserStatus === "INACTIVE" || inferredTerminationUserStatus === "INACTIVE" ? "INACTIVE" : nextUserStatus ?? inferredUserStatus ?? inferredTerminationUserStatus;
    const nextTerminationType = normalizeTerminationType(input.terminationType);
    if (input.terminationType !== undefined && nextTerminationType === undefined && clean(input.terminationType)) {
      return createValidationError({ terminationType: "Tipo de desligamento inválido. Use Voluntário ou Involuntário." });
    }
    const nextTerminationReason = cleanNullable(input.terminationReason);
    const nextSiteOperation = cleanNullable(input.siteOperation);
    const nextEthnicity = cleanNullable(input.ethnicity);
    const nextSexualOrientation = cleanNullable(input.sexualOrientation);
    const nextIsPcd = cleanNullable(input.isPcd);
    const nextPcdDisabilityType = cleanNullable(input.pcdDisabilityType);
    const nextPcdDisabilityOther = cleanNullable(input.pcdDisabilityOther);
    const effectiveIsPcd = input.isPcd !== undefined ? nextIsPcd : employee.isPcd ?? null;
    const effectivePcdDisabilityType = input.pcdDisabilityType !== undefined ? nextPcdDisabilityType : employee.pcdDisabilityType ?? null;
    const effectivePcdDisabilityOther = input.pcdDisabilityOther !== undefined ? nextPcdDisabilityOther : employee.pcdDisabilityOther ?? null;
    const nextFirstJob = cleanNullable(input.firstJob);
    const nextHasTelemarketingExperience = cleanNullable(input.hasTelemarketingExperience);
    const nextTelemarketingWhere = cleanNullable(input.telemarketingWhere);
    const nextInternalNotes = cleanNullable(input.internalNotes);
    const nextSkill = cleanNullable(input.skill);
    const nextSkillIds = input.skillIds === undefined ? undefined : Array.from(new Set(input.skillIds.map((value) => clean(value)).filter((value): value is string => Boolean(value))));
    const nextPrimarySkillId = input.primarySkillId === undefined ? undefined : clean(input.primarySkillId);
    const nextWave = cleanNullable(input.wave);
    const nextPrimaryPhone = cleanNullable(input.primaryPhone);
    const nextCity = cleanNullable(input.city);
    const nextStateUf = cleanNullable(input.stateUf)?.toUpperCase() ?? undefined;
    const nextPreferredSchedule = cleanNullable(input.preferredSchedule);
    const nextCpf = cleanNullable(input.cpf);
    const nextCnpj = cleanNullable(input.cnpj);
    const nextCpfDigits = nextCpf?.replace(/\D/g, "") ?? "";
    const nextCnpjDigits = nextCnpj?.replace(/\D/g, "") ?? "";
    const nextFormattedCpf = nextCpf ? formatCpfDocument(nextCpfDigits) : null;
    const nextFormattedCnpj = nextCnpj ? formatCnpjDocument(nextCnpjDigits) : null;
    const hasPixUpdate = input.pixKey !== undefined || input.pixKeyType !== undefined;
    const pixValidation = hasPixUpdate
      ? validatePixKey(
        input.pixKeyType !== undefined ? input.pixKeyType : employee.pixKeyType,
        input.pixKey !== undefined ? input.pixKey : employee.pixKey
      )
      : null;
    const previousPixKey = employee.pixKey ?? "";
    const previousPixKeyType = employee.pixKeyType ?? "";
    const pixChanged = Boolean(
      pixValidation?.valid
      && (previousPixKey !== pixValidation.normalizedValue || previousPixKeyType !== pixValidation.pixKeyType)
    );

    const hasAnyUpdate = Object.entries(input).some(([key, value]) => key !== "id" && value !== undefined);
    if (!hasAnyUpdate) return createValidationError({ form: "Informe ao menos um campo para atualizar." });
    if (input.fullName !== undefined && !nextFullName) return createValidationError({ fullName: "Nome obrigatório." });
    if (input.email !== undefined && (!nextEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail))) return createValidationError({ email: "E-mail inválido." });
    if (input.wbLogin !== undefined && !nextWbLogin) return createValidationError({ wbLogin: "WB/Login obrigatório." });
    if (input.lobId !== undefined && !nextLobId) return createValidationError({ lobId: "LOB é obrigatória." });
    if (input.shiftId !== undefined && !nextShiftId) return createValidationError({ shiftId: "Turno é obrigatório." });
    if (input.roleTitle !== undefined && !nextRoleTitle) return createValidationError({ roleTitle: "Cargo/Função é obrigatório." });
    if (input.operationalStatus !== undefined && !nextStatus) return createValidationError({ operationalStatus: "Status do parceiro é obrigatório." });
    if (input.stateUf !== undefined && nextStateUf && nextStateUf.length !== 2) return createValidationError({ stateUf: "Estado/UF deve ter 2 letras." });
    if (input.cpf !== undefined && nextCpf && nextCpfDigits.length !== 11) return createValidationError({ cpf: "CPF deve conter 11 dígitos." });
    if (input.cnpj !== undefined && nextCnpj && nextCnpjDigits.length !== 14) return createValidationError({ cnpj: "CNPJ deve conter 14 dígitos." });
    if (input.cpf !== undefined && nextCpf && nextCpf !== nextFormattedCpf) return createValidationError({ cpf: "CPF deve estar no padrão 000.000.000-00." });
    if (input.cnpj !== undefined && nextCnpj && nextCnpj !== nextFormattedCnpj) return createValidationError({ cnpj: "CNPJ deve estar no padrão 00.000.000/0000-00." });
    if (pixValidation && !pixValidation.valid) return createValidationError({ [pixValidation.field ?? "pixKey"]: pixValidation.message ?? "Chave PIX inválida." });
    if ((input.isPcd !== undefined || input.pcdDisabilityType !== undefined) && effectiveIsPcd === "Sim" && !effectivePcdDisabilityType) return createValidationError({ pcdDisabilityType: "Tipo de deficiência é obrigatório quando PCD for Sim." });
    if ((input.isPcd !== undefined || input.pcdDisabilityType !== undefined || input.pcdDisabilityOther !== undefined) && effectiveIsPcd === "Sim" && effectivePcdDisabilityType === "Outra" && !effectivePcdDisabilityOther) return createValidationError({ pcdDisabilityOther: "Especifique o tipo de deficiência." });
    if (nextSupervisorId && nextSupervisorId === employee.id) return createValidationError({ supervisorId: "O parceiro não pode ser supervisor de si mesmo." }, "O parceiro não pode ser supervisor de si mesmo.");

    let selectedSkills: Array<{ id: string; name: string }> | undefined;
    let resolvedPrimarySkillId: string | null | undefined;
    if (nextSkillIds !== undefined) {
      selectedSkills = nextSkillIds.length
        ? await prisma.operationalSkill.findMany({ where: { id: { in: nextSkillIds } }, select: { id: true, name: true } })
        : [];
      if (selectedSkills.length !== nextSkillIds.length) return createValidationError({ skillIds: "Uma ou mais skills selecionadas não existem." });
      resolvedPrimarySkillId = nextSkillIds.length ? (nextPrimarySkillId && nextSkillIds.includes(nextPrimarySkillId) ? nextPrimarySkillId : nextSkillIds[0]) : null;
    } else if (nextPrimarySkillId !== undefined) {
      return createValidationError({ primarySkillId: "Selecione as skills antes de definir a principal." });
    }

    let targetRoleId: string | undefined;
    if (nextRoleName) {
      if (!actorCanManageRoles) return createPermissionError("Apenas Admin pode alterar role/permissão de sistema.");
      const activeAdmins = await prisma.user.count({ where: { status: "ACTIVE", deletedAt: null, role: { name: "ADMIN" } } });
      if (employee.userId && employee.user?.role?.name === "ADMIN" && nextRoleName !== "ADMIN" && activeAdmins <= 1) {
        return createPermissionError("Não é permitido remover o único Admin ativo.");
      }
      const targetRole = await prisma.role.findUnique({ where: { name: nextRoleName } });
      if (!targetRole) return createValidationError({ roleName: "Role/Permissão selecionada não existe." }, "Role/Permissão selecionada não existe.");
      targetRoleId = targetRole.id;
    }
    if (nextUserStatus && !["ACTIVE", "INACTIVE", "BLOCKED"].includes(nextUserStatus)) return createValidationError({ userStatus: "Status de acesso inválido." });
    if (effectiveUserStatus && employee.userId && employee.user?.role?.name === "ADMIN" && effectiveUserStatus !== "ACTIVE") {
      const activeAdmins = await prisma.user.count({ where: { status: "ACTIVE", deletedAt: null, role: { name: "ADMIN" }, id: { not: employee.userId } } });
      if (activeAdmins <= 0) return createPermissionError("Não é permitido inativar o único Admin ativo.");
    }
    if (nextWbLogin && nextWbLogin !== employee.wbLogin) {
      const duplicatedWb = await prisma.employeeProfile.findFirst({ where: { wbLogin: nextWbLogin, deletedAt: null, id: { not: employee.id } } });
      if (duplicatedWb) return createDuplicateError("Já existe um parceiro com este WB/Login.", { wbLogin: "Este WB/Login já está em uso." });
    }
    if (nextEmail && nextEmail !== employee.user?.email) {
      const duplicatedEmail = await prisma.user.findFirst({ where: { email: nextEmail, deletedAt: null, id: employee.userId ? { not: employee.userId } : undefined } });
      if (duplicatedEmail) return createDuplicateError("Já existe usuário ativo com este e-mail.", { email: "Este e-mail já está vinculado a outro usuário ativo." });
    }
    if (nextSupervisorId) {
      const supervisor = await prisma.employeeProfile.findFirst({
        where: { id: nextSupervisorId, deletedAt: null },
        select: { id: true, fullName: true, roleTitle: true, operationalStatus: true, user: { select: { role: { select: { name: true } } } } }
      });
      if (!supervisor) return createRelationError("Supervisor selecionado não encontrado.", { supervisorId: "Supervisor selecionado não encontrado." });
      if (!canBeSupervisorProfile(supervisor)) {
        return createRelationError("Supervisor selecionado não é elegível.", { supervisorId: "Selecione Supervisor, Gestor, Coordenador, Gerente, WFM ou Admin." });
      }
      if (await wouldCreateSupervisorCycle(employee.id, nextSupervisorId)) {
        return createValidationError({ supervisorId: "Essa alteração criaria um ciclo na hierarquia." }, "Essa alteração criaria um ciclo na hierarquia.");
      }
    }
    if (nextLobId) {
      const lob = await prisma.lob.findUnique({ where: { id: nextLobId } });
      if (!lob) return createRelationError("LOB selecionada não foi encontrada.", { lobId: "LOB selecionada não existe ou está inativa." });
    }
    if (nextShiftId) {
      const shift = await prisma.shift.findUnique({ where: { id: nextShiftId } });
      if (!shift) return createRelationError("Turno selecionado não foi encontrado.", { shiftId: "Selecione um turno válido." });
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (employee.userId && (targetRoleId || nextEmail || effectiveUserStatus)) {
        await assertActiveAdminRemains(tx, employee.userId, { roleId: targetRoleId, status: effectiveUserStatus });
        await tx.user.update({
          where: { id: employee.userId },
          data: {
            ...(targetRoleId ? { roleId: targetRoleId } : {}),
            ...(nextEmail ? { email: nextEmail } : {}),
            ...(nextFullName ? { name: nextFullName } : {}),
            ...(effectiveUserStatus ? { status: effectiveUserStatus } : {})
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
          ...(pixValidation?.valid ? { pixKey: pixValidation.normalizedValue, pixKeyType: pixValidation.pixKeyType } : {}),
          ...(nextWbLogin ? { wbLogin: nextWbLogin } : {}),
          ...(nextRoleTitle ? { roleTitle: nextRoleTitle } : {}),
          ...(nextStatus ? { operationalStatus: nextStatus } : {}),
          ...(nextSupervisorId !== undefined ? { supervisorId: nextSupervisorId || null } : {}),
          ...(nextLobId ? { lobId: nextLobId } : {}),
          ...(nextShiftId ? { shiftId: nextShiftId } : {}),
          ...(input.contractType !== undefined ? { contractType: nextContractType } : {}),
          ...(nextAdmissionDate.value ? { admissionDate: nextAdmissionDate.value } : {}),
          ...(input.trainingStartDate !== undefined ? { trainingStartDate: nextTrainingDate.value ?? null } : {}),
          ...(input.nestingStartDate !== undefined ? { nestingStartDate: nextNestingStartDate.value ?? null } : {}),
          ...(input.goLiveDate !== undefined ? { goLiveDate: nextGoLiveDate.value ?? null } : {}),
          ...(input.workStartTime !== undefined ? { workStartTime: nextWorkStartTime.value ?? null } : {}),
          ...(input.workEndTime !== undefined ? { workEndTime: nextWorkEndTime.value ?? null } : {}),
          ...(input.terminationDate !== undefined ? { terminationDate: nextTerminationDate.value ?? null } : {}),
          ...(input.terminationType !== undefined ? { terminationType: nextTerminationType ?? null } : {}),
          ...(input.terminationReason !== undefined ? { terminationReason: nextTerminationReason } : {}),
          ...(input.ethnicity !== undefined ? { ethnicity: nextEthnicity } : {}),
          ...(input.sexualOrientation !== undefined ? { sexualOrientation: nextSexualOrientation } : {}),
          ...(input.isPcd !== undefined ? { isPcd: nextIsPcd } : {}),
          ...(input.pcdDisabilityType !== undefined || input.isPcd !== undefined ? { pcdDisabilityType: effectiveIsPcd === "Sim" ? effectivePcdDisabilityType : null } : {}),
          ...(input.pcdDisabilityOther !== undefined || input.pcdDisabilityType !== undefined || input.isPcd !== undefined ? { pcdDisabilityOther: effectiveIsPcd === "Sim" && effectivePcdDisabilityType === "Outra" ? effectivePcdDisabilityOther : null } : {}),
          ...(input.firstJob !== undefined ? { firstJob: nextFirstJob } : {}),
          ...(input.hasTelemarketingExperience !== undefined ? { hasTelemarketingExperience: nextHasTelemarketingExperience } : {}),
          ...(input.telemarketingWhere !== undefined ? { telemarketingWhere: nextTelemarketingWhere } : {}),
          ...(input.siteOperation !== undefined ? { siteOperation: nextSiteOperation } : {}),
          ...(input.internalNotes !== undefined ? { internalNotes: nextInternalNotes } : {}),
          ...(nextSkillIds !== undefined
            ? { skill: selectedSkills?.find((item) => item.id === resolvedPrimarySkillId)?.name ?? null }
            : input.skill !== undefined ? { skill: nextSkill } : {}),
          ...(input.wave !== undefined ? { wave: nextWave } : {})
        },
        include: { ...employeeInclude }
      });
      if (nextSkillIds !== undefined) {
        await tx.employeeSkillAssignment.deleteMany({ where: { employeeId: employee.id } });
        if (nextSkillIds.length) {
          await tx.employeeSkillAssignment.createMany({
            data: nextSkillIds.map((skillId) => ({ employeeId: employee.id, skillId, isPrimary: skillId === resolvedPrimarySkillId }))
          });
        }
      }
      if (input.cpf !== undefined || input.cnpj !== undefined || pixValidation?.valid) {
        const sensitive = await tx.employeeSensitiveData.findUnique({
          where: { employeeId: employee.id },
          select: { bankData: true }
        });
        if (sensitive) {
          await tx.employeeSensitiveData.update({
            where: { employeeId: employee.id },
            data: {
              ...(input.cpf !== undefined ? { cpf: nextFormattedCpf } : {}),
              ...(input.cnpj !== undefined ? { cnpj: nextFormattedCnpj } : {}),
              ...(pixValidation?.valid
                ? {
                  bankData: {
                    ...jsonObject(sensitive.bankData),
                    pixKey: pixValidation.normalizedValue,
                    pixKeyType: pixValidation.pixKeyType
                  }
                }
                : {})
            }
          });
        } else if (input.cpf !== undefined || input.cnpj !== undefined) {
          await tx.employeeSensitiveData.create({
            data: {
              employeeId: employee.id,
              cpf: nextFormattedCpf,
              cnpj: nextFormattedCnpj,
              rg: "",
              rgIssuer: "",
              birthDate: new Date("1970-01-01T00:00:00.000Z"),
              address: {},
              bankData: pixValidation?.valid ? { pixKey: pixValidation.normalizedValue, pixKeyType: pixValidation.pixKeyType } : {},
              emergencyContactData: {}
            }
          });
        }
      }
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
      if (pixChanged && pixValidation?.valid) {
        await tx.auditLog.create({
          data: {
            actorId: user.id,
            action: "EDICAO",
            entity: "EmployeeProfile",
            entityId: employee.id,
            reason: "PIX_KEY_UPDATED",
            previousValue: {
              pixKeyType: previousPixKeyType,
              pixKeyMasked: maskPixKey(previousPixKey, previousPixKeyType),
              source: "Mapa de Parceiros"
            },
            newValue: {
              pixKeyType: pixValidation.pixKeyType,
              pixKeyMasked: maskPixKey(pixValidation.normalizedValue, pixValidation.pixKeyType),
              source: "Mapa de Parceiros"
            }
          }
        }).catch(() => undefined);
      }
      return nextSkillIds !== undefined
        ? tx.employeeProfile.findUniqueOrThrow({ where: { id: record.id }, include: { ...employeeInclude } })
        : record;
    });

    const sensitive = await prisma.employeeSensitiveData.findUnique({ where: { employeeId: updated.id } });
    return { data: mapEmployee(updated, role, sensitive ?? undefined) };
  } catch (error) {
    console.error("[employee] erro ao atualizar parceiro", error);
    recordErrorLog({
      userEmail: actor.email,
      code: "EMPLOYEE_UPDATE_DB_ERROR",
      message: error instanceof Error ? error.message : "Falha ao atualizar parceiro",
      route: "/api/employees",
      action: "EMPLOYEE_UPDATE",
      severity: "ERROR"
    });
    return mapPrismaError(error) ?? createServerError(error, "Erro inesperado ao atualizar parceiro. Tente novamente ou contate o administrador.");
  }
}

export async function exportOperationalEmployeesXlsxData(actor: Actor, filters: { query?: string | null; lob?: string[] | string | null; status?: string[] | string | null; supervisorId?: string[] | string | null; shiftId?: string[] | string | null; contractType?: string[] | string | null; roleTitle?: string[] | string | null; skill?: string[] | string | null; wave?: string[] | string | null }) {
  const user = await prisma.user.findUnique({ where: { email: actor.email }, include: { role: true } });
  if (!user) return createPermissionError("Usuário não autenticado.");
  if (user.deletedAt) return createPermissionError("Usuário sem acesso ativo.");
  actor = { ...actor, role: normalizeRole(user.role.name) };
  if (!canAccessEmployeeMap({ role: actor.role, status: user.status })) return createPermissionError("Você não tem permissão para exportar o Mapa de Parceiros.");

  const role = normalizeRole(actor.role);
  const rowsResult = await listOperationalEmployees(actor, { summary: false, limit: 10000 });
  const employees = Array.isArray(rowsResult) ? rowsResult : rowsResult.data;
  const query = clean(filters.query)?.toLowerCase() ?? "";
  const queryDigits = query.replace(/\D/g, "");
  const lobs = cleanFilterValues(filters.lob);
  const statuses = cleanFilterValues(filters.status);
  const supervisorIds = cleanFilterValues(filters.supervisorId);
  const shiftIds = cleanFilterValues(filters.shiftId);
  const contractTypes = normalizeContractTypeFilters(filters.contractType);
  const roleTitles = cleanFilterValues(filters.roleTitle);
  const skills = cleanFilterValues(filters.skill);
  const waves = cleanFilterValues(filters.wave);
  const filteredRows = employees.filter((employee) => {
    const row = employee as Record<string, any>;
    const cnpjDigits = String(row.sensitive?.cnpj ?? "").replace(/\D/g, "");
    const matchesQuery = !query
      || [employee.name, employee.wb, employee.email, employee.role, employee.lob, row.supervisor, row.skill, row.wave].join(" ").toLowerCase().includes(query)
      || (queryDigits.length >= 3 && cnpjDigits.includes(queryDigits));
    const matchesLob = !lobs.length || lobs.some((lob) => matchesEmployeeMapLobFilter(employee.lob, lob));
    const matchesStatus = !statuses.length || statuses.some((status) => matchesEmployeeStatusFilter(employee.status, row.userStatus, status));
    const matchesSupervisor = !supervisorIds.length || supervisorIds.some((supervisorId) => isNoneFilter(supervisorId) ? !row.supervisorId : row.supervisorId === supervisorId);
    const matchesShift = !shiftIds.length || shiftIds.includes(String(row.shiftId ?? ""));
    const matchesContract = !contractTypes.length || contractTypes.some((contractType) => String(row.contractType ?? "").toUpperCase() === contractType);
    const matchesRoleTitle = !roleTitles.length || roleTitles.some((roleTitle) => String(employee.role ?? "").toLowerCase() === roleTitle.toLowerCase());
    const matchesSkill = !skills.length || skills.some((skill) => isNoneFilter(skill) ? !row.skill : String(row.skill ?? "").toLowerCase() === skill.toLowerCase());
    const matchesWave = !waves.length || waves.some((wave) => isNoneFilter(wave) ? !row.wave : String(row.wave ?? "").toLowerCase() === wave.toLowerCase());
    return matchesQuery && matchesLob && matchesStatus && matchesSupervisor && matchesShift && matchesContract && matchesRoleTitle && matchesSkill && matchesWave;
  });

  const columns = employeeExportColumns(role);
  const headers = columns.map((column) => column.header);
  const exportRows = filteredRows.map((employee) => columns.map((column) => String(column.value(employee) ?? "")));

  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      action: "EDICAO",
      entity: "EmployeeProfile",
      entityId: "employee-map",
      reason: `Exportação XLSX do Mapa de Parceiros (${role})`,
      previousValue: {},
      newValue: {
        role,
        filters,
        exportedRows: filteredRows.length,
        columns: headers
      }
    }
  }).catch((error) => {
    console.error("[employee] falha ao auditar exportação", error);
  });

  return {
    headers,
    rows: exportRows,
    sheetName: "Parceiros",
    fileName: `parceiros_${new Date().toISOString().slice(0, 10)}.xlsx`
  };
}

export async function resetEmployeeUserPassword(actor: Actor, input: { employeeId: string; password: string; confirmPassword: string }) {
  try {
    const admin = await prisma.user.findUnique({ where: { email: actor.email }, include: { role: true } });
    if (!admin || admin.status !== "ACTIVE" || admin.deletedAt) return { error: "Usuário não autenticado." };
    if (normalizeRole(admin.role.name) !== "ADMIN") {
      const reason = normalizeRole(actor.role) === "SUPERVISOR" ? "Supervisor não possui permissão para resetar senha." : "Apenas Admin pode resetar senha.";
      await auditPermissionDenied(actor, { action: "USER_PASSWORD_RESET", entity: "User", reason, entityId: input.employeeId });
      return { error: reason };
    }
    if (!input.password || input.password.length < 8 || input.password.length > 128) return { error: "A nova senha deve ter entre 8 e 128 caracteres." };
    if (input.password !== input.confirmPassword) return { error: "A confirmação de senha não confere." };

    const employee = await prisma.employeeProfile.findFirst({ where: { id: input.employeeId, deletedAt: null }, include: { user: true } });
    if (!employee?.userId || !employee.user) return { error: "Este parceiro não possui usuário vinculado." };

    const externalStatus = await synchronizeUserPassword({ email: employee.user.email, password: input.password,
      persistLocal: (passwordHash) => prisma.$transaction(async (tx) => {
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
    }) });

    return { success: true, message: externalStatus === "LOCAL_SAVED_EXTERNAL_PENDING"
      ? "Senha temporária definida na Central. A sincronização externa está pendente. O usuário deverá entrar novamente e alterar a senha."
      : "Senha temporária definida. As sessões anteriores foram revogadas; o usuário deverá entrar novamente e alterar a senha." };
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

export async function deleteOperationalEmployee(actor: Actor, input: EmployeeDeleteInput) {
  try {
    const admin = await prisma.user.findUnique({ where: { email: actor.email }, include: { role: true } });
    if (!admin || admin.status !== "ACTIVE" || admin.deletedAt) return createPermissionError("Usuário não autenticado.");
    if (normalizeRole(admin.role.name) !== "ADMIN") {
      const reason = normalizeRole(actor.role) === "SUPERVISOR" ? "Supervisor não possui permissão para editar cadastros." : "Apenas ADMIN pode excluir cadastros.";
      await auditPermissionDenied(actor, { action: "EMPLOYEE_DELETE", entity: "EmployeeProfile", reason, entityId: input.id });
      return createPermissionError(reason);
    }

    const reason = clean(input.reason);
    if (!reason) return createValidationError({ reason: "Motivo da exclusão é obrigatório." }, "Motivo da exclusão é obrigatório.");
    if (String(input.confirmation ?? "").trim() !== "EXCLUIR") {
      return createValidationError({ confirmation: "Confirmação inválida. Digite EXCLUIR para continuar." }, "Confirmação inválida. Digite EXCLUIR para continuar.");
    }

    const employee = await prisma.employeeProfile.findFirst({
      where: { id: input.id, deletedAt: null },
      include: { user: { include: { role: true } }, lob: true, team: true, supervisor: true, shift: true }
    });
    if (!employee) return createNotFoundError("Parceiro não encontrado.");

    const dependencies = await getEmployeeDeleteDependencies(employee.id, employee.userId);
    const blockers = Object.entries(dependencies.critical).filter(([, count]) => count > 0);
    if (employee.user?.role?.name === "ADMIN" && employee.user.status === "ACTIVE") {
      const activeAdmins = await prisma.user.count({ where: { status: "ACTIVE", deletedAt: null, role: { name: "ADMIN" }, id: { not: employee.user.id } } });
      if (activeAdmins <= 0) {
        await auditEmployeeDelete(admin.id, employee, reason, "DELETE_EMPLOYEE_BLOCKED", dependencies, { reason: "LAST_ADMIN" });
        return createPermissionError("Não é permitido excluir o último ADMIN ativo.");
      }
    }

    if (blockers.length) {
      await auditEmployeeDelete(admin.id, employee, reason, "DELETE_EMPLOYEE_BLOCKED", dependencies, { blockers: Object.fromEntries(blockers) });
      return createRelationError("Este cadastro possui histórico operacional vinculado. Use Inativar parceiro para preservar auditoria.", {
        dependencies: blockers.map(([name, count]) => `${name}: ${count}`).join(", ")
      });
    }

    const now = new Date();
    const deletedWbLogin = buildDeletedIdentifier("wb", employee.wbLogin, employee.id);
    const deletedEmail = employee.user ? buildDeletedEmail(employee.user.email, employee.user.id) : null;

    await prisma.$transaction(async (tx) => {
      if (employee.userId) await assertActiveAdminRemains(tx, employee.userId, { status: "INACTIVE", deletedAt: now });
      await tx.employeeSensitiveData.deleteMany({ where: { employeeId: employee.id } });
      await tx.employeeRegistrationRequest.updateMany({
        where: { OR: [{ createdEmployeeProfileId: employee.id }, ...(employee.userId ? [{ createdUserId: employee.userId }] : [])] },
        data: { status: "INATIVO", deletedAt: now, reviewedById: admin.id, reviewedAt: now, reviewNotes: `Cadastro excluído por ADMIN. Motivo: ${reason}` }
      });
      await tx.employeeProfile.update({
        where: { id: employee.id },
        data: {
          wbLogin: deletedWbLogin,
          operationalStatus: "Inativo",
          deletedAt: now
        }
      });
      if (employee.userId && deletedEmail) {
        await tx.user.update({
          where: { id: employee.userId },
          data: {
            email: deletedEmail,
            status: "INACTIVE",
            deletedAt: now
          }
        });
      }
      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: "EXCLUSAO",
          entity: "EmployeeProfile",
          entityId: employee.id,
          reason: "SOFT_DELETE_EMPLOYEE_COMPLETED",
          previousValue: serializeEmployeeForAudit(employee as EmployeeWithRelations),
          newValue: {
            reason,
            deletedAt: now.toISOString(),
            deletionType: "soft-delete",
            dependencies,
            deletedWbLogin,
            userId: employee.userId,
            deletedEmail
          }
        }
      });
    });

    return { success: true, message: "Cadastro excluído com sucesso." };
  } catch (error) {
    console.error("[employee] erro ao excluir cadastro", error);
    recordErrorLog({
      userEmail: actor.email,
      code: "EMPLOYEE_DELETE_DB_ERROR",
      message: error instanceof Error ? error.message : "Falha ao excluir cadastro",
      route: "/api/employees/[id]",
      action: "EMPLOYEE_DELETE",
      severity: "ERROR"
    });
    return mapPrismaError(error) ?? createServerError(error, "Não foi possível excluir o cadastro.");
  }
}

type EmployeeWithRelations = Prisma.EmployeeProfileGetPayload<{ include: typeof employeeInclude }>;

function mapEmployeeSkills(
  assignments: Array<{ isPrimary: boolean; skill: { id: string; name: string; color: string; status?: string } }>,
  legacySkill?: string | null
) {
  const mapped = assignments.map((assignment) => ({
    id: assignment.skill.id,
    name: assignment.skill.name,
    color: assignment.skill.color,
    isPrimary: assignment.isPrimary,
    status: assignment.skill.status === "INACTIVE" ? "INACTIVE" as const : "ACTIVE" as const
  }));
  if (mapped.length || !legacySkill?.trim()) return mapped;
  return [{ id: `legacy:${legacySkill}`, name: legacySkill, color: "#2563EB", isPrimary: true, status: "ACTIVE" as const }];
}

function mapEmployee(employee: EmployeeWithRelations, role: string, sensitive?: EmployeeSensitiveData) {
  const canViewSensitive = canViewEmployeeSensitiveData({ role }, { roleTitle: employee.roleTitle, email: employee.user?.email });
  const canViewPix = canViewSensitive;
  const canViewBank = canViewSensitive;
  const canViewContact = canViewSensitive;
  const canViewPeopleProfile = canViewSensitive;
  const canViewDiversityData = canViewSensitive;
  const canViewTerminationData = canViewSensitive;
  const canEditData = canEditEmployeeData({ role }, { roleTitle: employee.roleTitle, email: employee.user?.email });
  const canEditSensitive = canEditEmployeeSensitiveData({ role }, { roleTitle: employee.roleTitle, email: employee.user?.email });
  return {
    id: employee.id,
    name: employee.fullName,
    socialName: canViewPeopleProfile ? employee.socialName ?? "" : "",
    wb: employee.wbLogin,
    lob: employee.lob.name,
    lobId: employee.lobId,
    team: employee.team.name,
    teamId: employee.teamId,
    supervisor: employee.supervisor?.fullName ?? "Sem supervisor",
    supervisorId: employee.supervisorId ?? "",
    directReports: employee._count.supervisees,
    skill: employee.skill ?? "",
    skills: mapEmployeeSkills(employee.skillAssignments, employee.skill),
    wave: employee.wave ?? "",
    shift: cleanShiftName(employee.shift.name) || "Sem turno",
    shiftId: employee.shiftId,
    schedule: employee.scheduleType,
    status: displayEmployeeStatus(employee.operationalStatus),
    employeeStatus: displayEmployeeStatus(employee.operationalStatus),
    employeeStatusRaw: employee.operationalStatus,
    quality: null,
    productivity: null,
    equipment: employee.equipments.length,
    admission: formatDate(employee.admissionDate),
    admissionIso: toDateInput(employee.admissionDate),
    seniority: employeeSeniorityGroup(employee.admissionDate),
    terminationDate: canViewTerminationData && employee.terminationDate ? formatDate(employee.terminationDate) : "",
    terminationDateIso: canViewTerminationData && employee.terminationDate ? toDateInput(employee.terminationDate) : "",
    terminationType: canViewTerminationData ? employee.terminationType ?? "" : "",
    terminationReason: canViewTerminationData ? employee.terminationReason ?? "" : "",
    trainingStartDate: canViewPeopleProfile && employee.trainingStartDate ? formatDate(employee.trainingStartDate) : "",
    trainingStartDateIso: canViewPeopleProfile && employee.trainingStartDate ? toDateInput(employee.trainingStartDate) : "",
    nestingStartDate: employee.nestingStartDate ? formatDate(employee.nestingStartDate) : "",
    nestingStartDateIso: employee.nestingStartDate ? toDateInput(employee.nestingStartDate) : "",
    goLiveDate: employee.goLiveDate ? formatDate(employee.goLiveDate) : "",
    goLiveDateIso: employee.goLiveDate ? toDateInput(employee.goLiveDate) : "",
    workStartTime: employee.workStartTime ?? "",
    workEndTime: employee.workEndTime ?? "",
    contractType: canViewPeopleProfile ? employee.contractType ?? "" : "",
    ethnicity: canViewDiversityData ? employee.ethnicity ?? "" : "",
    sexualOrientation: canViewDiversityData ? employee.sexualOrientation ?? "" : "",
    isPcd: canViewDiversityData ? employee.isPcd ?? "" : "",
    pcdDisabilityType: canViewDiversityData ? employee.pcdDisabilityType ?? "" : "",
    pcdDisabilityOther: canViewDiversityData ? employee.pcdDisabilityOther ?? "" : "",
    firstJob: canViewDiversityData ? employee.firstJob ?? "" : "",
    hasTelemarketingExperience: canViewDiversityData ? employee.hasTelemarketingExperience ?? "" : "",
    telemarketingWhere: canViewDiversityData ? employee.telemarketingWhere ?? "" : "",
    siteOperation: employee.siteOperation ?? "",
    internalNotes: canViewSensitive ? employee.internalNotes ?? "" : "",
    primaryPhone: canViewPeopleProfile ? employee.primaryPhone ?? "" : "",
    city: canViewPeopleProfile ? employee.city ?? "" : "",
    stateUf: canViewPeopleProfile ? employee.stateUf ?? "" : "",
    preferredSchedule: canViewPeopleProfile ? employee.preferredSchedule ?? "" : "",
    pixKeyType: canViewPix ? employee.pixKeyType ?? pixKeyFromBankData(sensitive?.bankData).pixKeyType : "",
    pixKey: canViewPix ? employee.pixKey ?? pixKeyFromBankData(sensitive?.bankData).pixKey : "",
    role: employee.roleTitle,
    email: employee.user?.email,
    userStatus: displayUserStatus(employee.user?.status),
    userStatusRaw: employee.user?.status ?? "",
    userId: employee.userId,
    systemRole: employee.user?.role?.name,
    isAgent: isAgentJobTitle(employee.roleTitle),
    canViewSensitive,
    canEditEmployeeData: canEditData,
    canEditPeopleData: canEditSensitive,
    canEditOperationalData: canEditData,
    canEditHierarchyData: canEditData,
    restrictedSections: {
      cadastrais: canViewSensitive || role === "COLABORADOR",
      contato: canViewContact || role === "COLABORADOR",
      emergencia: canViewContact || canViewSensitive,
      bancarios: canViewBank || canViewPix,
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
        pixKeyType: canViewPix ? employee.pixKeyType ?? pixKeyFromBankData(sensitive.bankData).pixKeyType : "",
        pixKey: canViewPix ? employee.pixKey ?? pixKeyFromBankData(sensitive.bankData).pixKey : "",
        emergencyContactData: canViewContact ? jsonToText(sensitive.emergencyContactData) : "Acesso restrito",
        familyData: jsonToText(sensitive.familyData)
      }
      : undefined,
    maskedSensitive: sensitive
      ? {
        cpf: maskDocument(sensitive.cpf),
        rg: maskDocument(sensitive.rg),
        bankData: canViewBank ? jsonToText(sensitive.bankData) : "Acesso restrito",
        pixKeyType: canViewPix ? employee.pixKeyType ?? pixKeyFromBankData(sensitive.bankData).pixKeyType : "",
        pixKey: canViewPix ? maskPixKey(employee.pixKey ?? pixKeyFromBankData(sensitive.bankData).pixKey, employee.pixKeyType ?? pixKeyFromBankData(sensitive.bankData).pixKeyType) : "Acesso restrito",
        emergencyContactData: canViewContact ? jsonToText(sensitive.emergencyContactData) : "Acesso restrito"
      }
      : undefined
  };
}

function mapLegacyEmployee(employee: LegacyEmployeeRow, role: string) {
  const canViewSensitive = canViewEmployeeSensitiveData({ role }, { roleTitle: employee.roleTitle, email: employee.email });
  const canEditData = canEditEmployeeData({ role }, { roleTitle: employee.roleTitle, email: employee.email });
  const canEditSensitive = canEditEmployeeSensitiveData({ role }, { roleTitle: employee.roleTitle, email: employee.email });
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
    directReports: 0,
    skill: employee.skill ?? "",
    skills: mapEmployeeSkills([], employee.skill),
    wave: employee.wave ?? "",
    shift: cleanShiftName(employee.shift) || "Sem turno",
    shiftId: employee.shiftId,
    schedule: employee.scheduleType,
    status: displayEmployeeStatus(employee.operationalStatus),
    employeeStatus: displayEmployeeStatus(employee.operationalStatus),
    employeeStatusRaw: employee.operationalStatus,
    quality: null,
    productivity: null,
    equipment: 0,
    admission: formatDate(employee.admissionDate),
    admissionIso: toDateInput(employee.admissionDate),
    seniority: employeeSeniorityGroup(employee.admissionDate),
    terminationDate: "",
    terminationDateIso: "",
    terminationType: "",
    terminationReason: "",
    trainingStartDate: "",
    trainingStartDateIso: "",
    nestingStartDate: "",
    nestingStartDateIso: "",
    goLiveDate: "",
    goLiveDateIso: "",
    workStartTime: "",
    workEndTime: "",
    contractType: employee.contractType ?? "",
    ethnicity: "",
    sexualOrientation: "",
    isPcd: "",
    pcdDisabilityType: "",
    pcdDisabilityOther: "",
    firstJob: "",
    hasTelemarketingExperience: "",
    telemarketingWhere: "",
    siteOperation: "",
    internalNotes: "",
    primaryPhone: "",
    city: "",
    stateUf: "",
    preferredSchedule: "",
    pixKeyType: "",
    pixKey: "",
    role: employee.roleTitle,
    email: employee.email ?? undefined,
    userId: employee.userId ?? undefined,
    userStatus: displayUserStatus(employee.userStatus),
    userStatusRaw: employee.userStatus ?? "",
    systemRole: employee.systemRole ?? undefined,
    isAgent: isAgentJobTitle(employee.roleTitle),
    canViewSensitive,
    canEditEmployeeData: canEditData,
    canEditPeopleData: canEditSensitive,
    canEditOperationalData: canEditData,
    canEditHierarchyData: canEditData,
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
  const canViewSensitive = canViewEmployeeSensitiveData({ role }, { roleTitle: employee.roleTitle, email: employee.user?.email });
  const canViewTerminationData = canViewSensitive;
  const canEditData = canEditEmployeeData({ role }, { roleTitle: employee.roleTitle, email: employee.user?.email });
  const canEditSensitive = canEditEmployeeSensitiveData({ role }, { roleTitle: employee.roleTitle, email: employee.user?.email });
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
    directReports: employee._count.supervisees,
    skill: employee.skill ?? "",
    skills: mapEmployeeSkills(employee.skillAssignments, employee.skill),
    wave: employee.wave ?? "",
    shift: cleanShiftName(employee.shift.name) || "Sem turno",
    shiftId: employee.shiftId,
    schedule: employee.scheduleType,
    status: displayEmployeeStatus(employee.operationalStatus),
    employeeStatus: displayEmployeeStatus(employee.operationalStatus),
    employeeStatusRaw: employee.operationalStatus,
    quality: null,
    productivity: null,
    equipment: employee._count.equipments,
    admission: formatDate(employee.admissionDate),
    admissionIso: toDateInput(employee.admissionDate),
    seniority: employeeSeniorityGroup(employee.admissionDate),
    terminationDate: canViewTerminationData && employee.terminationDate ? formatDate(employee.terminationDate) : "",
    terminationDateIso: canViewTerminationData && employee.terminationDate ? toDateInput(employee.terminationDate) : "",
    terminationType: canViewTerminationData ? employee.terminationType ?? "" : "",
    terminationReason: canViewTerminationData ? employee.terminationReason ?? "" : "",
    trainingStartDate: "",
    trainingStartDateIso: "",
    nestingStartDate: "",
    nestingStartDateIso: "",
    goLiveDate: "",
    goLiveDateIso: "",
    workStartTime: employee.workStartTime ?? "",
    workEndTime: employee.workEndTime ?? "",
    contractType: "",
    ethnicity: "",
    sexualOrientation: "",
    isPcd: "",
    pcdDisabilityType: "",
    pcdDisabilityOther: "",
    firstJob: "",
    hasTelemarketingExperience: "",
    telemarketingWhere: "",
    siteOperation: "",
    internalNotes: "",
    primaryPhone: "",
    city: "",
    stateUf: "",
    preferredSchedule: "",
    pixKeyType: "",
    pixKey: "",
    role: employee.roleTitle,
    email: employee.user?.email,
    userStatus: displayUserStatus(employee.user?.status),
    userStatusRaw: employee.user?.status ?? "",
    userId: employee.userId ?? undefined,
    systemRole: employee.user?.role.name,
    isAgent: isAgentJobTitle(employee.roleTitle),
    canViewSensitive,
    canEditEmployeeData: canEditData,
    canEditPeopleData: canEditSensitive,
    canEditOperationalData: canEditData,
    canEditHierarchyData: canEditData,
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
    col("supervisor", (employee) => employee.supervisor),
    col("subordinados_diretos", (employee) => employee.directReports),
    col("skill", (employee) => employee.skill),
    col("wave", (employee) => employee.wave),
    col("turno", (employee) => employee.shift),
    col("horario_entrada", (employee) => employee.workStartTime),
    col("horario_saida", (employee) => employee.workEndTime),
    col("status_colaborador", (employee) => employee.employeeStatus),
    col("status_usuario", (employee) => employee.userStatus),
    col("senioridade", (employee) => employee.seniority),
    col("data_desligamento", (employee) => employee.terminationDate),
    col("tipo_desligamento", (employee) => employee.terminationType),
    col("motivo_desligamento", (employee) => employee.terminationReason),
    col("data_inicio_nesting", (employee) => employee.nestingStartDate),
    col("data_go_live", (employee) => employee.goLiveDate)
  ];
  const diversity = [
    col("etnia", (employee) => employee.ethnicity),
    col("orientacao_sexual", (employee) => employee.sexualOrientation),
    col("eh_pcd", (employee) => employee.isPcd),
    col("tipo_deficiencia", (employee) => employee.pcdDisabilityType),
    col("tipo_deficiencia_outro", (employee) => employee.pcdDisabilityOther),
    col("primeiro_emprego", (employee) => employee.firstJob),
    col("ja_trabalhou_telemarketing", (employee) => employee.hasTelemarketingExperience),
    col("onde_trabalhou_telemarketing", (employee) => employee.telemarketingWhere)
  ];
  const pixColumns = [
    col("tipo_chave_pix", (employee) => employee.sensitive?.pixKeyType ?? employee.maskedSensitive?.pixKeyType ?? employee.pixKeyType),
    col("chave_pix", (employee) => employee.sensitive?.pixKey ?? employee.maskedSensitive?.pixKey ?? employee.pixKey)
  ];
  if (!canViewEmployeeSensitiveData({ role })) return operational;

  const people = [
    col("nome_social", (employee) => employee.socialName),
    col("telefone_principal", (employee) => employee.primaryPhone),
    col("cidade", (employee) => employee.city),
    col("estado_uf", (employee) => employee.stateUf),
    col("tipo_contrato", (employee) => employee.contractType),
    col("data_admissao", (employee) => employee.admission),
    col("observacoes_internas", (employee) => employee.internalNotes)
  ];
  return [
    ...operational,
    ...diversity,
    ...people,
    col("cpf", (employee) => employee.sensitive?.cpf ?? employee.maskedSensitive?.cpf),
    col("rg", (employee) => employee.sensitive?.rg ?? employee.maskedSensitive?.rg),
    col("cnpj", (employee) => employee.sensitive?.cnpj),
    col("data_nascimento", (employee) => employee.sensitive?.birthDate),
    col("endereco", (employee) => employee.sensitive?.address),
    col("dados_bancarios_pix", (employee) => employee.sensitive?.bankData),
    ...pixColumns,
    col("contato_emergencia", (employee) => employee.sensitive?.emergencyContactData),
    col("dados_familiares", (employee) => employee.sensitive?.familyData),
    col("usuario_ativo", (employee) => employee.userId ? "Sim" : "Não")
  ];
}

function col(header: string, value: (employee: Record<string, any>) => unknown) {
  return { header, value: (employee: Record<string, any>) => value(employee) ?? "" };
}

async function resolveEmployeeBatchWb(input?: EmployeeListQuery["wbLogins"]) {
  const parsed = parseWbLoginBatch(input ?? "");
  if (!parsed.normalizedValues.length) {
    return { applied: [] as string[], notFound: [] as string[], duplicatesRemoved: parsed.duplicatesRemoved };
  }
  const employees = await prisma.employeeProfile.findMany({
    where: {
      deletedAt: null,
      OR: parsed.normalizedValues.map((wbLogin) => ({ wbLogin: { equals: wbLogin, mode: "insensitive" as const } }))
    },
    select: { wbLogin: true }
  });
  const found = new Set(employees.map((employee) => normalizeWbLogin(employee.wbLogin)));
  return {
    applied: parsed.values.filter((value) => found.has(normalizeWbLogin(value))),
    notFound: parsed.values.filter((value) => !found.has(normalizeWbLogin(value))),
    duplicatesRemoved: parsed.duplicatesRemoved
  };
}

async function findEmployeeIdsByCnpjSearch(search: string) {
  const digits = search.replace(/\D/g, "");
  if (digits.length < 3) return [];
  const rawPattern = `%${search.trim()}%`;
  const digitsPattern = `%${digits}%`;
  const rows = await prisma.$queryRaw<Array<{ employeeId: string }>>(Prisma.sql`
    SELECT "employeeId"
    FROM "EmployeeSensitiveData"
    WHERE "cnpj" IS NOT NULL
      AND (
        LOWER("cnpj") LIKE LOWER(${rawPattern})
        OR regexp_replace("cnpj", '[^0-9]', '', 'g') LIKE ${digitsPattern}
      )
  `);
  return rows.map((row) => row.employeeId);
}

async function getEmployeeFilterOptions(where: Prisma.EmployeeProfileWhereInput) {
  const [skillRows, waveRows, roleTitleRows, statusRows] = await Promise.all([
    prisma.operationalSkill.findMany({
      where: { status: "ACTIVE" },
      select: { name: true },
      orderBy: { name: "asc" }
    }),
    prisma.employeeProfile.findMany({
      where: { ...where, wave: { not: null } },
      distinct: ["wave"],
      select: { wave: true },
      orderBy: { wave: "asc" }
    }),
    prisma.employeeProfile.findMany({
      where: { ...where, roleTitle: { not: "" } },
      distinct: ["roleTitle"],
      select: { roleTitle: true },
      orderBy: { roleTitle: "asc" }
    }),
    prisma.employeeProfile.findMany({
      where: { ...where, operationalStatus: { not: "" } },
      distinct: ["operationalStatus"],
      select: { operationalStatus: true },
      orderBy: { operationalStatus: "asc" }
    })
  ]);
  const statuses = Array.from(new Set([
    ...officialEmployeeStatusOptions,
    ...statusRows
      .map((row) => displayEmployeeStatus(row.operationalStatus))
      .filter(isSelectableEmployeeStatusOption)
  ])).sort(employeeStatusSort);
  return {
    skills: skillRows.map((row) => row.name).filter((value): value is string => Boolean(value?.trim())),
    waves: waveRows.map((row) => row.wave).filter((value): value is string => Boolean(value?.trim())),
    roleTitles: roleTitleRows.map((row) => row.roleTitle).filter((value): value is string => Boolean(value?.trim())),
    statuses
  };
}

function buildSupervisorFilterWhere(value: unknown): Prisma.EmployeeProfileWhereInput {
  const values = cleanFilterValues(value);
  if (!values.length) return {};
  return {
    OR: values.map((item) => isNoneFilter(item) ? { supervisorId: null } : { supervisorId: item })
  };
}

function buildIdFilterWhere(field: "shiftId", value: unknown): Prisma.EmployeeProfileWhereInput {
  const values = cleanFilterValues(value);
  if (!values.length) return {};
  return { [field]: { in: values } } as Prisma.EmployeeProfileWhereInput;
}

function buildNullableTextFilterWhere(field: "skill" | "wave" | "roleTitle", value: unknown): Prisma.EmployeeProfileWhereInput {
  const values = cleanFilterValues(value);
  if (!values.length) return {};
  const clauses: Prisma.EmployeeProfileWhereInput[] = [];
  values.forEach((item) => {
    if (isNoneFilter(item)) {
      clauses.push({ [field]: null } as Prisma.EmployeeProfileWhereInput, { [field]: "" } as Prisma.EmployeeProfileWhereInput);
    } else {
      clauses.push({ [field]: { equals: item, mode: "insensitive" } } as Prisma.EmployeeProfileWhereInput);
    }
  });
  return { OR: clauses };
}

function buildEmployeeSkillFilterWhere(value: unknown): Prisma.EmployeeProfileWhereInput {
  const values = cleanFilterValues(value);
  if (!values.length) return {};
  return {
    OR: values.map((item) => isNoneFilter(item)
      ? { AND: [{ OR: [{ skill: null }, { skill: "" }] }, { skillAssignments: { none: {} } }] }
      : {
          OR: [
            { skill: { equals: item, mode: "insensitive" as const } },
            { skillAssignments: { some: { skill: { name: { equals: item, mode: "insensitive" as const } } } } }
          ]
        })
  };
}

function buildContractTypeFilterWhere(value: unknown): Prisma.EmployeeProfileWhereInput {
  const values = normalizeContractTypeFilters(value);
  if (!values.length) return {};
  return { OR: values.map((item) => ({ contractType: { equals: item, mode: "insensitive" } })) };
}

function buildEmployeeMapLobFilterWhere(value: unknown): Prisma.EmployeeProfileWhereInput {
  const values = cleanFilterValues(value);
  if (!values.length) return {};
  const lobNames = Array.from(new Set(values.flatMap((item) => isTnsLobGroup(item) ? ["TNS", "Video", "Vídeo", "Comments", "Comentários"] : [item])));
  return {
    OR: lobNames.map((lob) => ({ lob: { name: { equals: lob, mode: "insensitive" } } }))
  };
}

function matchesEmployeeMapLobFilter(employeeLob: unknown, filter: unknown) {
  const rawFilter = clean(filter);
  if (!rawFilter || isAllFilter(rawFilter)) return true;
  if (isTnsLobGroup(rawFilter)) return isTnsLobGroup(employeeLob);
  return normalizeStatusToken(employeeLob) === normalizeStatusToken(rawFilter);
}

function isTnsLobGroup(value: unknown) {
  return ["TNS", "VIDEO", "VIDEOS", "COMMENTS", "COMENTARIOS"].includes(normalizeStatusToken(value));
}

function normalizeContractTypeFilters(value: unknown) {
  return cleanFilterValues(value)
    .map((item) => item.toUpperCase())
    .filter((item) => item === "PJ" || item === "CLT");
}

async function getEmployeeContractSummary(where: Prisma.EmployeeProfileWhereInput) {
  const [clt, pj] = await Promise.all([
    prisma.employeeProfile.count({ where: { AND: [where, { contractType: { equals: "CLT", mode: "insensitive" } }] } }),
    prisma.employeeProfile.count({ where: { AND: [where, { contractType: { equals: "PJ", mode: "insensitive" } }] } })
  ]);
  return { clt, pj };
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

const employeeStatusDisplayAliases: Record<string, string> = {
  ACTIVE: "Ativo",
  ATIVO: "Ativo",
  ATIVA: "Ativo",
  APPROVED: "Ativo",
  APROVADO: "Ativo",
  APROVADA: "Ativo",
  ONLINE: "Ativo",
  EM_ATENDIMENTO: "Ativo",
  ESCALADO: "Ativo",
  PRESENTE: "Ativo",
  FALTA: "Ativo",
  AUSENTE: "Ativo",
  FOLGA: "Ativo",
  FERIAS: "Ativo",
  ATRASO: "Ativo",
  SAIDA_ANTECIPADA: "Ativo",
  TROCA_APROVADA: "Ativo",
  VENDA_FOLGA_APROVADA: "Ativo",
  VENDA_DE_FOLGA_APROVADA: "Ativo",
  FOLGA_APROVADA: "Ativo",
  SEM_ESCALA: "Ativo",
  SEM_CRONOGRAMA: "Ativo",
  ERRO_ESCALA: "Ativo",
  ERRO_DE_ESCALA: "Ativo",
  ERRO_CRONOGRAMA: "Ativo",
  ERRO_DE_CRONOGRAMA: "Ativo",
  DESCOBERTO: "Ativo",
  CONFLITO: "Ativo",
  FERIADO: "Ativo",
  INACTIVE: "Inativo",
  INATIVO: "Inativo",
  INATIVA: "Inativo",
  OFFLINE: "Inativo",
  DESATIVADO: "Desativado",
  DESATIVADA: "Desativado",
  DESLIGADO: "Desligado",
  DESLIGADA: "Desligado",
  DESLIGADO_EM_TREINAMENTO: "Desligado em Treinamento",
  DESLIGADA_EM_TREINAMENTO: "Desligado em Treinamento",
  DESLIGADO_TREINAMENTO: "Desligado em Treinamento",
  DESLIGADA_TREINAMENTO: "Desligado em Treinamento",
  BLOCKED: "Inativo",
  BLOQUEADO: "Inativo",
  SUSPENSO: "Inativo",
  SUSPENSA: "Inativo",
  EM_TREINAMENTO: "Em treinamento",
  TREINAMENTO: "Em treinamento",
  NESTING: "Nesting",
  AFASTADO: "Afastado",
  PENDING: "Pendente de cadastro",
  PENDENTE: "Pendente de cadastro",
  PENDENTE_CADASTRO: "Pendente de cadastro",
  PENDENTE_DE_CADASTRO: "Pendente de cadastro",
  PENDENTE_APROVACAO: "Pendente de cadastro",
  PENDENTE_APROVAÇÃO: "Pendente de cadastro"
};

const officialEmployeeStatusOptions = ["Ativo", "Em treinamento", "Nesting", "Afastado", "Desligado", "Desligado em Treinamento", "Inativo", "Desativado"];

const employeeStatusFilterAliases: Record<string, string[]> = {
  Ativo: ["Ativo", "ATIVO", "ACTIVE"],
  Desligado: ["Desligado", "DESLIGADO"],
  "Desligado em Treinamento": [
    "Desligado em Treinamento",
    "Desligada em Treinamento",
    "DESLIGADO_EM_TREINAMENTO",
    "DESLIGADA_EM_TREINAMENTO",
    "Desligado treinamento",
    "Desligada treinamento",
    "DESLIGADO_TREINAMENTO",
    "DESLIGADA_TREINAMENTO"
  ],
  "Em treinamento": ["Em treinamento", "EM_TREINAMENTO"],
  Nesting: ["Nesting", "NESTING"],
  Inativo: ["Inativo", "INATIVO", "INACTIVE"],
  Desativado: ["Desativado", "DESATIVADO"],
  Afastado: ["Afastado", "AFASTADO"],
  Suspenso: ["Suspenso", "SUSPENSO"],
  "Pendente de cadastro": ["Pendente de cadastro", "PENDENTE_CADASTRO"]
};

function displayEmployeeStatus(status: unknown) {
  const raw = clean(status);
  if (!raw) return "";
  const token = normalizeStatusToken(raw);
  return employeeStatusDisplayAliases[token] ?? raw;
}

function displayUserStatus(status: unknown) {
  const token = normalizeStatusToken(status);
  const labels: Record<string, string> = {
    ACTIVE: "Ativo",
    INACTIVE: "Inativo",
    BLOCKED: "Bloqueado"
  };
  return labels[token] ?? clean(status);
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
  "DESATIVADO",
  "DESATIVADA",
  "DISABLED",
  "DESLIGADO",
  "DESLIGADA",
  "TERMINATED",
  "DESLIGADO_EM_TREINAMENTO",
  "DESLIGADA_EM_TREINAMENTO",
  "DESLIGADO_TREINAMENTO",
  "DESLIGADA_TREINAMENTO",
  "CANCELLED",
  "CANCELADO",
  "CANCELADA",
  "SUSPENSO",
  "SUSPENSA"
]);

function buildEmployeeStatusWhere(status: unknown): Prisma.EmployeeProfileWhereInput {
  const selectedStatuses = cleanFilterValues(status);
  if (!selectedStatuses.length) return {};
  const values = Array.from(new Set(selectedStatuses.flatMap((item) => {
    const canonical = canonicalEmployeeStatusLabel(item);
    return canonical ? employeeStatusFilterAliases[canonical] : [item];
  })));
  return { OR: values.map((value) => ({ operationalStatus: { equals: value, mode: "insensitive" } })) };
}

function matchesEmployeeStatusFilter(status: unknown, _userStatus: unknown, filter: unknown) {
  const rawFilter = clean(filter);
  if (!rawFilter || isAllFilter(rawFilter)) return true;
  const canonical = canonicalEmployeeStatusLabel(rawFilter);
  const values = canonical ? employeeStatusFilterAliases[canonical] : [rawFilter];
  return values.some((value) => normalizeStatusToken(value) === normalizeStatusToken(status));
}

function canonicalEmployeeStatusLabel(value: unknown) {
  const token = normalizeStatusToken(value);
  const alias = employeeStatusDisplayAliases[token];
  if (alias && officialEmployeeStatusOptions.includes(alias)) return alias;
  return officialEmployeeStatusOptions.find((status) => normalizeStatusToken(status) === token);
}

function isSelectableEmployeeStatusOption(value: string) {
  return Boolean(canonicalEmployeeStatusLabel(value));
}

function employeeStatusSort(a: string, b: string) {
  const aIndex = officialEmployeeStatusOptions.indexOf(a);
  const bIndex = officialEmployeeStatusOptions.indexOf(b);
  if (aIndex >= 0 && bIndex >= 0) return aIndex - bIndex;
  if (aIndex >= 0) return -1;
  if (bIndex >= 0) return 1;
  return a.localeCompare(b, "pt-BR");
}

function hasWhereInput(where: Prisma.EmployeeProfileWhereInput) {
  return Object.keys(where).length > 0;
}

function isAllFilter(value: string) {
  return ["TODOS", "TODAS", "ALL", "TUDO"].includes(normalizeStatusToken(value));
}

function isNoneFilter(value: string) {
  return ["NONE", "SEM", "SEM_SUPERVISOR", "SEM_SUPERVISAO", "SEM_SKILL", "SEM_WAVE"].includes(normalizeStatusToken(value));
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

function normalizeTerminationType(value: unknown) {
  const raw = clean(value);
  if (!raw) return undefined;
  const token = normalizeStatusToken(raw);
  const map: Record<string, string> = {
    VOLUNTARIO: "Voluntário",
    VOLUNTARIA: "Voluntário",
    VOLUNTARY: "Voluntário",
    INVOLUNTARIO: "Involuntário",
    INVOLUNTARIA: "Involuntário",
    INVOLUNTARY: "Involuntário"
  };
  return map[token];
}

function isMissingEmployeeProfileColumnError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /EmployeeProfile\.(socialName|primaryPhone|city|stateUf|preferredSchedule|pixKey|pixKeyType|trainingStartDate|terminationDate|terminationType|terminationReason|workStartTime|workEndTime|contractType|siteOperation|internalNotes|skill|wave)|column .* does not exist/i.test(message);
}

function employeeSeniorityGroup(admissionDate?: Date | null) {
  if (!admissionDate || Number.isNaN(admissionDate.getTime())) return "Não informado";
  const now = new Date();
  let completedMonths = (now.getFullYear() - admissionDate.getFullYear()) * 12 + now.getMonth() - admissionDate.getMonth();
  if (now.getDate() < admissionDate.getDate()) completedMonths -= 1;
  const months = Math.max(0, completedMonths);
  if (months < 3) return "-3m";
  if (months < 6) return "3-6m";
  if (months < 12) return "6-12m";
  return "+12m";
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

function cleanFilterValues(value: unknown) {
  const source = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return Array.from(new Set(source
    .map((item) => clean(item))
    .filter((item): item is string => typeof item === "string" && item.length > 0 && !isAllFilter(item))));
}

function cleanNullable(value: unknown) {
  if (value === undefined) return undefined;
  const next = String(value ?? "").trim();
  return next || null;
}

function formatCpfDocument(digits: string) {
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9, 11)}`;
}

function formatCnpjDocument(digits: string) {
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12, 14)}`;
}

function normalizeUserStatus(value: unknown): UserStatus | undefined {
  const next = normalizeStatusToken(value);
  if (!next) return undefined;
  const map: Record<string, UserStatus> = {
    ACTIVE: "ACTIVE",
    ATIVO: "ACTIVE",
    INACTIVE: "INACTIVE",
    INATIVO: "INACTIVE",
    INATIVA: "INACTIVE",
    DESATIVADO: "INACTIVE",
    DESATIVADA: "INACTIVE",
    DESLIGADO: "INACTIVE",
    DESLIGADA: "INACTIVE",
    DISABLED: "INACTIVE",
    TERMINATED: "INACTIVE",
    CANCELLED: "INACTIVE",
    CANCELADO: "INACTIVE",
    CANCELADA: "INACTIVE",
    BLOCKED: "BLOCKED",
    BLOQUEADO: "BLOCKED",
    SUSPENSO: "BLOCKED"
  };
  return map[next];
}

function userStatusFromOperationalStatus(value: unknown): UserStatus | undefined {
  const token = normalizeStatusToken(value);
  if (!token) return undefined;
  if (inactiveEmployeeStatusTokens.has(token)) return "INACTIVE";
  if (activeEmployeeStatusTokens.has(token)) return "ACTIVE";
  return undefined;
}

function isPastOrTodaySaoPaulo(date?: Date | null) {
  if (!date || Number.isNaN(date.getTime())) return false;
  const dateKey = date.toISOString().slice(0, 10);
  const todayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
  return dateKey <= todayKey;
}

function parseDateInput(value: unknown, error: string): { value?: Date | null } | { error: string } {
  if (value === undefined) return { value: undefined };
  const text = clean(value);
  if (!text) return { value: null };
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return { error };
  return { value: date };
}

function normalizeWorkTimeInput(value: unknown, error: string): { value?: string | null } | { error: string } {
  if (value === undefined) return { value: undefined };
  const raw = clean(value);
  if (!raw) return { value: null };
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return { error };
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return { error };
  return { value: `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}` };
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
    skill: employee.skill,
    wave: employee.wave,
    shiftId: employee.shiftId,
    workStartTime: employee.workStartTime,
    workEndTime: employee.workEndTime,
    scheduleType: employee.scheduleType,
    contractType: employee.contractType,
    admissionDate: employee.admissionDate,
    trainingStartDate: employee.trainingStartDate,
    terminationDate: employee.terminationDate,
    terminationType: employee.terminationType,
    terminationReason: employee.terminationReason,
    siteOperation: employee.siteOperation,
    internalNotes: employee.internalNotes,
    primaryPhone: employee.primaryPhone,
    city: employee.city,
    stateUf: employee.stateUf,
    preferredSchedule: employee.preferredSchedule
  };
}

function canBeSupervisorProfile(employee: { roleTitle: string | null; operationalStatus: string | null; user?: { role?: { name: string } | null } | null }) {
  const status = normalizeStatusToken(employee.operationalStatus);
  if (inactiveEmployeeStatusTokens.has(status)) return false;
  const roleName = employee.user?.role?.name;
  return canBeSupervisorJobTitle(employee.roleTitle) || ["SUPERVISOR", "GESTOR", "MANAGEMENT", "WFM", "ADMIN"].includes(roleName ?? "");
}

async function wouldCreateSupervisorCycle(employeeId: string, supervisorId: string) {
  const visited = new Set<string>();
  let currentId: string | null = supervisorId;
  for (let depth = 0; currentId && depth < 500; depth += 1) {
    if (currentId === employeeId) return true;
    if (visited.has(currentId)) return true;
    visited.add(currentId);
    const current: { supervisorId: string | null } | null = await prisma.employeeProfile.findFirst({
      where: { id: currentId, deletedAt: null },
      select: { supervisorId: true }
    });
    currentId = current?.supervisorId ?? null;
  }
  return false;
}

async function getEmployeeDeleteDependencies(employeeId: string, userId?: string | null) {
  const [
    supervisees,
    supervisedTeams,
    schedules,
    scheduleChanges,
    attendanceRecords,
    workHourRecords,
    workHourAdjustments,
    requestsByEmployee,
    requestsByUser,
    equipments,
    equipmentTickets,
    monthlyAdvances,
    shiftReportAbsences,
    performanceMetrics,
    qualityFeedbacks,
    tokenTransactions,
    rewardRedemptions,
    tokenBalance,
    storedFiles,
    registrations,
    auditLogs
  ] = await Promise.all([
    prisma.employeeProfile.count({ where: { supervisorId: employeeId, deletedAt: null } }),
    prisma.team.count({ where: { supervisorId: employeeId } }),
    prisma.schedule.count({ where: { employeeId, deletedAt: null } }),
    prisma.scheduleChangeHistory.count({ where: { employeeId } }),
    prisma.attendanceRecord.count({ where: { employeeId } }),
    prisma.workHourRecord.count({ where: { employeeId } }),
    prisma.workHourAdjustmentRequest.count({ where: { employeeId } }),
    prisma.request.count({ where: { employeeId, deletedAt: null } }),
    userId ? prisma.request.count({ where: { OR: [{ requesterId: userId }, { assigneeId: userId }], deletedAt: null } }) : Promise.resolve(0),
    prisma.equipment.count({ where: { employeeId, deletedAt: null } }),
    prisma.equipmentTicket.count({ where: { employeeId } }),
    prisma.monthlyAdvanceRecord.count({ where: { employeeId, status: { not: "REMOVED" } } }),
    prisma.shiftReportAbsence.count({ where: { employeeId } }),
    prisma.performanceMetric.count({ where: { employeeId } }),
    prisma.qualityFeedback.count({ where: { employeeId } }),
    prisma.tokenTransaction.count({ where: { employeeId } }),
    prisma.rewardRedemption.count({ where: { employeeId } }),
    prisma.tokenBalance.count({ where: { employeeId } }),
    prisma.storedFile.count({ where: { employeeId, deletedAt: null } }),
    prisma.employeeRegistrationRequest.count({ where: { OR: [{ createdEmployeeProfileId: employeeId }, ...(userId ? [{ createdUserId: userId }] : [])], deletedAt: null } }),
    prisma.auditLog.count({ where: { entity: "EmployeeProfile", entityId: employeeId } })
  ]);

  return {
    critical: {
      supervisees,
      supervisedTeams,
      schedules,
      scheduleChanges,
      attendanceRecords,
      workHourRecords,
      workHourAdjustments,
      requests: requestsByEmployee + requestsByUser,
      equipments,
      equipmentTickets,
      monthlyAdvances,
      shiftReportAbsences,
      performanceMetrics,
      qualityFeedbacks,
      tokenTransactions,
      rewardRedemptions,
      tokenBalance,
      storedFiles
    },
    preserved: {
      registrations,
      auditLogs
    }
  };
}

async function auditEmployeeDelete(
  actorId: string,
  employee: Prisma.EmployeeProfileGetPayload<{ include: { user: { include: { role: true } } } }>,
  reason: string,
  action: string,
  dependencies: Awaited<ReturnType<typeof getEmployeeDeleteDependencies>>,
  extra: Record<string, unknown> = {}
) {
  await prisma.auditLog.create({
    data: {
      actorId,
      action: "EXCLUSAO",
      entity: "EmployeeProfile",
      entityId: employee.id,
      reason: action,
      previousValue: {
        id: employee.id,
        fullName: employee.fullName,
        wbLogin: employee.wbLogin,
        userId: employee.userId,
        role: employee.user?.role?.name,
        status: employee.operationalStatus
      },
      newValue: {
        reason,
        dependencies,
        ...extra
      }
    }
  }).catch((error) => {
    console.error("[employee] falha ao auditar tentativa de exclusão", error);
  });
}

function buildDeletedIdentifier(prefix: string, value: string, id: string) {
  const suffix = `${Date.now()}-${id.slice(-6)}`;
  const compact = String(value ?? "").replace(/\s+/g, "").slice(0, 32);
  return `${prefix}-deleted-${suffix}-${compact}`;
}

function buildDeletedEmail(email: string, id: string) {
  return `deleted-${id.slice(-8)}-${Date.now()}@deleted.local`;
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

function jsonObject(value: Prisma.JsonValue | null | undefined): Prisma.JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Prisma.JsonObject : {};
}

function pixKeyFromBankData(value?: Prisma.JsonValue | null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { pixKey: "", pixKeyType: "" };
  const data = value as Prisma.JsonObject;
  return {
    pixKey: typeof data.pixKey === "string" ? data.pixKey : "",
    pixKeyType: typeof data.pixKeyType === "string" ? data.pixKeyType : ""
  };
}

function maskDocument(value?: string | null) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length <= 2) return "***";
  return `***${digits.slice(-2)}`;
}
