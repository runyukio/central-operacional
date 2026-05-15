import bcrypt from "bcryptjs";

import type { EmployeeSensitiveData, Prisma, UserStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import type { Actor } from "@/lib/mock-db";
import { listEmployeesForActor as listMockEmployees, recordErrorLog } from "@/lib/mock-db";
import { canAccessEmployeeMap, canViewEmployeeSensitiveData, normalizeRole } from "@/lib/permissions";

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

export async function listOperationalEmployees(actor: Actor) {
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

export async function updateOperationalEmployee(actor: Actor, input: EmployeeAdminUpdateInput) {
  try {
    const user = await prisma.user.findUnique({ where: { email: actor.email }, include: { role: true } });
    if (!user) return { error: "Usuário não autenticado." };
    const role = normalizeRole(actor.role);
    if (!["ADMIN", "GESTOR", "RH", "WFM"].includes(role)) return { error: "Sem permissão para editar dados operacionais." };

    const employee = await prisma.employeeProfile.findFirst({
      where: { id: input.id, deletedAt: null },
      include: { ...employeeInclude }
    });
    if (!employee) return { error: "Colaborador não encontrado." };

    const actorIsAdmin = role === "ADMIN";
    const canEditOperational = ["ADMIN", "GESTOR", "WFM"].includes(role);
    const canEditPeopleData = ["ADMIN", "GESTOR", "RH"].includes(role);
    if (!canEditOperational && !canEditPeopleData) return { error: "Sem permissão para editar dados do colaborador." };

    const adminOnlyFields: Array<keyof EmployeeAdminUpdateInput> = ["wbLogin", "roleName", "userStatus"];
    const sensitivePeopleFields: Array<keyof EmployeeAdminUpdateInput> = ["fullName", "socialName", "email", "primaryPhone", "city", "stateUf", "preferredSchedule", "contractType", "admissionDate", "trainingStartDate"];
    const operationalFields: Array<keyof EmployeeAdminUpdateInput> = ["roleTitle", "operationalStatus", "lobId", "teamId", "supervisorId", "shiftId", "scheduleType", "siteOperation", "internalNotes"];
    if (!actorIsAdmin && adminOnlyFields.some((field) => input[field] !== undefined)) return { error: "Apenas Admin pode alterar WB/Login, role ou status de acesso." };
    if (!canEditPeopleData && sensitivePeopleFields.some((field) => input[field] !== undefined)) return { error: "Sem permissão para editar dados cadastrais/contratuais." };
    if (!canEditOperational && operationalFields.some((field) => input[field] !== undefined)) return { error: "Sem permissão para editar dados operacionais." };

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
    if ("error" in nextAdmissionDate) return { error: nextAdmissionDate.error };
    const nextTrainingDate = parseDateInput(input.trainingStartDate, "Data de treinamento inválida.");
    if ("error" in nextTrainingDate) return { error: nextTrainingDate.error };
    const nextSiteOperation = cleanNullable(input.siteOperation);
    const nextInternalNotes = cleanNullable(input.internalNotes);
    const nextPrimaryPhone = cleanNullable(input.primaryPhone);
    const nextCity = cleanNullable(input.city);
    const nextStateUf = cleanNullable(input.stateUf)?.toUpperCase() ?? undefined;
    const nextPreferredSchedule = cleanNullable(input.preferredSchedule);

    const hasAnyUpdate = Object.entries(input).some(([key, value]) => key !== "id" && value !== undefined);
    if (!hasAnyUpdate) return { error: "Informe ao menos um campo para atualizar." };
    if (input.fullName !== undefined && !nextFullName) return { error: "Nome obrigatório." };
    if (input.email !== undefined && (!nextEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail))) return { error: "E-mail inválido." };
    if (input.wbLogin !== undefined && !nextWbLogin) return { error: "WB/Login obrigatório." };
    if (input.lobId !== undefined && !nextLobId) return { error: "LOB obrigatória." };
    if (input.teamId !== undefined && !nextTeamId) return { error: "Time obrigatório." };
    if (input.shiftId !== undefined && !nextShiftId) return { error: "Turno obrigatório." };
    if (input.roleTitle !== undefined && !nextRoleTitle) return { error: "Cargo/Função obrigatório." };
    if (input.operationalStatus !== undefined && !nextStatus) return { error: "Status obrigatório." };
    if (input.scheduleType !== undefined && !nextScheduleType) return { error: "Escala obrigatória." };
    if (input.stateUf !== undefined && nextStateUf && nextStateUf.length !== 2) return { error: "Estado/UF deve ter 2 letras." };

    let targetRoleId: string | undefined;
    if (nextRoleName) {
      if (role !== "ADMIN") return { error: "Apenas Admin pode alterar role/permissão de sistema." };
      const activeAdmins = await prisma.user.count({ where: { status: "ACTIVE", deletedAt: null, role: { name: "ADMIN" } } });
      if (employee.userId && employee.userId === user.id && employee.user?.role?.name === "ADMIN" && nextRoleName !== "ADMIN" && activeAdmins <= 1) {
        return { error: "Não é permitido remover o único Admin ativo." };
      }
      const targetRole = await prisma.role.findUnique({ where: { name: nextRoleName } });
      if (!targetRole) return { error: "Role/permissão não encontrada." };
      targetRoleId = targetRole.id;
    }
    if (nextUserStatus && !["ACTIVE", "INACTIVE", "BLOCKED"].includes(nextUserStatus)) return { error: "Status de acesso inválido." };
    if (nextWbLogin && nextWbLogin !== employee.wbLogin) {
      const duplicatedWb = await prisma.employeeProfile.findFirst({ where: { wbLogin: nextWbLogin, deletedAt: null, id: { not: employee.id } } });
      if (duplicatedWb) return { error: "Já existe colaborador ativo com este WB/Login." };
    }
    if (nextEmail && nextEmail !== employee.user?.email) {
      const duplicatedEmail = await prisma.user.findFirst({ where: { email: nextEmail, deletedAt: null, id: employee.userId ? { not: employee.userId } : undefined } });
      if (duplicatedEmail) return { error: "Já existe usuário ativo com este e-mail." };
    }
    if (nextSupervisorId) {
      const supervisor = await prisma.employeeProfile.findFirst({ where: { id: nextSupervisorId, deletedAt: null }, include: { user: { include: { role: true } } } });
      if (!supervisor?.user || !["SUPERVISOR", "ADMIN"].includes(supervisor.user.role.name)) {
        return { error: "Supervisor selecionado precisa ter role SUPERVISOR ou ADMIN." };
      }
    }
    if (nextLobId) {
      const lob = await prisma.lob.findUnique({ where: { id: nextLobId } });
      if (!lob) return { error: "LOB selecionada não encontrada." };
    }
    if (nextTeamId) {
      const team = await prisma.team.findUnique({ where: { id: nextTeamId } });
      if (!team) return { error: "Time selecionado não encontrado." };
    }
    if (nextShiftId) {
      const shift = await prisma.shift.findUnique({ where: { id: nextShiftId } });
      if (!shift) return { error: "Turno selecionado não encontrado." };
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
    return { error: "Não foi possível atualizar o colaborador." };
  }
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
        data: { passwordHash, status: "ACTIVE" }
      });
      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: "EDICAO",
          entity: "User",
          entityId: employee.userId,
          reason: `Senha redefinida manualmente para ${employee.fullName}`,
          previousValue: { passwordHash: "protected" },
          newValue: { passwordHash: "updated" }
        }
      });
    });

    return { success: true, message: "Senha redefinida com sucesso." };
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
    shift: employee.shift.name,
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
