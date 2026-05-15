import bcrypt from "bcryptjs";

import type { EmployeeSensitiveData, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import type { Actor } from "@/lib/mock-db";
import { listEmployeesForActor as listMockEmployees, recordErrorLog } from "@/lib/mock-db";
import { normalizeRole } from "@/lib/permissions";

const allowDemoDataFallback = process.env.ALLOW_DEMO_LOGIN === "true" || process.env.ALLOW_DEMO_DATA === "true";
const employeeInclude = {
  user: { include: { role: true } },
  lob: true,
  shift: true,
  supervisor: true,
  equipments: true
} satisfies Prisma.EmployeeProfileInclude;

export async function listOperationalEmployees(actor: Actor) {
  try {
    const user = await prisma.user.findUnique({ where: { email: actor.email }, include: { role: true, employeeProfile: true } });
    if (!user) return allowDemoDataFallback ? listMockEmployees(actor) : [];

    const role = normalizeRole(actor.role);
    const employees = await prisma.employeeProfile.findMany({
      where:
        role === "COLABORADOR" && user.employeeProfile
          ? { id: user.employeeProfile.id, deletedAt: null }
          : role === "SUPERVISOR" && user.employeeProfile
            ? { supervisorId: user.employeeProfile.id, deletedAt: null }
            : { deletedAt: null },
      include: {
        ...employeeInclude
      },
      orderBy: { fullName: "asc" },
      take: 200
    });

    const sensitiveRows = employees.length
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

export async function updateOperationalEmployee(actor: Actor, input: { id: string; roleTitle?: string; operationalStatus?: string; roleName?: string; supervisorId?: string }) {
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

    const nextRoleTitle = input.roleTitle?.trim();
    const nextStatus = input.operationalStatus?.trim();
    const nextRoleName = input.roleName?.trim();
    const nextSupervisorId = input.supervisorId?.trim();
    if (!nextRoleTitle && !nextStatus && !nextRoleName && nextSupervisorId === undefined) return { error: "Informe ao menos um campo para atualizar." };

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
    if (nextSupervisorId) {
      const supervisor = await prisma.employeeProfile.findFirst({ where: { id: nextSupervisorId, deletedAt: null }, include: { user: { include: { role: true } } } });
      if (!supervisor?.user || !["SUPERVISOR", "ADMIN"].includes(supervisor.user.role.name)) {
        return { error: "Supervisor selecionado precisa ter role SUPERVISOR ou ADMIN." };
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (targetRoleId && employee.userId) {
        await tx.user.update({ where: { id: employee.userId }, data: { roleId: targetRoleId } });
      }
      const record = await tx.employeeProfile.update({
        where: { id: employee.id },
        data: {
          ...(nextRoleTitle ? { roleTitle: nextRoleTitle } : {}),
          ...(nextStatus ? { operationalStatus: nextStatus } : {}),
          ...(nextSupervisorId !== undefined ? { supervisorId: nextSupervisorId || null } : {})
        },
        include: { ...employeeInclude }
      });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "EDICAO",
          entity: "EmployeeProfile",
          entityId: employee.id,
          reason: "Atualização de dados operacionais pelo painel administrativo",
          previousValue: { roleTitle: employee.roleTitle, operationalStatus: employee.operationalStatus, role: employee.user?.role?.name, supervisorId: employee.supervisorId },
          newValue: { roleTitle: record.roleTitle, operationalStatus: record.operationalStatus, role: record.user?.role?.name, supervisorId: record.supervisorId }
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
    wb: employee.wbLogin,
    lob: employee.lob.name,
    supervisor: employee.supervisor?.fullName ?? "Sem supervisor",
    supervisorId: employee.supervisorId ?? "",
    shift: employee.shift.name,
    schedule: employee.scheduleType,
    status: employee.operationalStatus,
    quality: null,
    productivity: null,
    equipment: employee.equipments.length,
    admission: formatDate(employee.admissionDate),
    role: employee.roleTitle,
    email: employee.user?.email,
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
