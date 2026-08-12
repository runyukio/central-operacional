import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";

import type { Actor } from "@/lib/mock-db";
import { recordErrorLog } from "@/lib/mock-db";
import { canBeSupervisorJobTitle } from "@/lib/job-title-normalization";
import { normalizeRole } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { cleanShiftName, isBlockedShiftName } from "@/lib/shift-display";

type StatusValue = "ACTIVE" | "INACTIVE";
type StatusMap = Record<string, StatusValue>;
type RoleTitleConfig = { name: string; status: StatusValue };

type SettingsAction = {
  type: string;
  [key: string]: unknown;
};

type ConfigRule = {
  id: string;
  name: string;
  status: StatusValue;
  [key: string]: unknown;
};

const settingsEmployeeSelect = {
  id: true,
  fullName: true,
  wbLogin: true,
  roleTitle: true,
  operationalStatus: true,
  lobId: true,
  teamId: true,
  supervisorId: true,
  shiftId: true,
  user: { select: { email: true, role: { select: { name: true } } } },
  lob: { select: { name: true } },
  team: { select: { name: true } },
  supervisor: { select: { fullName: true } },
  shift: { select: { name: true } }
} satisfies Prisma.EmployeeProfileSelect;

const settingsUserSelect = {
  id: true,
  name: true,
  email: true,
  status: true,
  createdAt: true,
  role: { select: { name: true, label: true } },
  employeeProfile: { select: { id: true, fullName: true } }
} satisfies Prisma.UserSelect;

const settingsTeamInclude = {
  lob: true,
  supervisor: {
    select: {
      fullName: true,
      user: { select: { email: true } }
    }
  }
} satisfies Prisma.TeamInclude;

type SettingsEmployee = Prisma.EmployeeProfileGetPayload<{ select: typeof settingsEmployeeSelect }>;

const essentialRoles = [
  "ADMIN",
  "GESTOR",
  "SUPERVISOR",
  "COLABORADOR",
  "WFM",
  "QUALIDADE",
  "RH",
  "FINANCEIRO",
  "TI",
  "RTA",
  "POC",
  "CLIENT"
];
const essentialDayOffTypes = ["Troca de Folga", "Venda de Folga", "Solicitação de Dia de Folga", "Troca de Turno"];
const permissionSeeds = [
  ["can_manage_users", "Gerenciar usuários"],
  ["can_manage_settings", "Gerenciar configurações"],
  ["can_manage_lobs", "Gerenciar LOBs"],
  ["can_manage_schedules", "Gerenciar cronogramas"],
  ["can_import_schedules", "Importar cronogramas"],
  ["can_add_schedule_manually", "Adicionar cronograma manual"],
  ["can_edit_schedule_full", "Editar cronograma completo"],
  ["can_justify_attendance", "Justificar ocorrências"],
  ["can_mark_present", "Marcar presença"],
  ["can_approve_day_off_supervisor_step", "Aprovar folga como supervisor"],
  ["can_approve_day_off_wfm_step", "Aprovar folga como WFM"],
  ["can_view_employee_map", "Visualizar mapa de funcionários"],
  ["can_edit_employee_data", "Editar dados de colaborador"],
  ["can_view_sensitive_employee_data", "Ver dados sensíveis"],
  ["can_export_employee_data", "Exportar colaboradores"],
  ["can_manage_registrations", "Gerenciar cadastros"],
  ["can_reset_password", "Resetar senha"],
  ["can_access_audit_logs", "Acessar auditoria"],
  ["can_manage_shift_reports", "Gerenciar report de turno"],
  ["can_manage_tokens", "Gerenciar tokens"],
  ["can_manage_coverage_rules", "Gerenciar regras de cobertura"]
] as const;

const supervisorAllowedPermissionKeys = new Set([
  "can_view_employee_map",
  "can_justify_attendance",
  "can_approve_day_off_supervisor_step"
]);

const supervisorBlockedPermissionKeys = new Set([
  "can_manage_users",
  "can_manage_settings",
  "can_manage_lobs",
  "can_manage_schedules",
  "can_import_schedules",
  "can_add_schedule_manually",
  "can_edit_schedule_full",
  "can_mark_present",
  "can_approve_day_off_wfm_step",
  "can_edit_employee_data",
  "can_view_sensitive_employee_data",
  "can_export_employee_data",
  "can_manage_registrations",
  "can_reset_password",
  "can_access_audit_logs",
  "can_manage_shift_reports",
  "can_manage_tokens",
  "can_manage_coverage_rules"
]);

const configKeys = {
  lobStatus: "settings.lobStatus",
  shiftStatus: "settings.shiftStatus",
  teamStatus: "settings.teamStatus",
  roleStatus: "settings.roleStatus",
  permissionStatus: "settings.permissionStatus",
  requestTypeStatus: "settings.requestTypeStatus",
  rolePermissions: "settings.rolePermissions",
  roleTitles: "settings.roleTitles",
  defaultMonth: "settings.defaultMonth",
  slaRules: "settings.slaRules",
  approvalRules: "settings.approvalRules",
  coverageRules: "settings.coverageRules",
  tokenRules: "settings.tokenRules",
  generalSettings: "settings.generalSettings"
};

export async function getSystemSettings(actor: Actor) {
  try {
    await assertAuthenticated(actor);
    if (normalizeRole(actor.role) !== "ADMIN") {
      return { data: await getLimitedSystemSettings() };
    }

    const [
      users,
      lobs,
      shifts,
      roles,
      permissions,
      requestTypes,
      skills,
      teams,
      employees,
      supervisorEmployees,
      lobStatus,
      shiftStatus,
      teamStatus,
      roleStatus,
      permissionStatus,
      requestTypeStatus,
      rolePermissions,
      roleTitles,
      defaultMonth,
      slaRules,
      approvalRules,
      coverageRules,
      tokenRules,
      generalSettings
    ] = await Promise.all([
      prisma.user.findMany({ where: { deletedAt: null }, select: settingsUserSelect, orderBy: { name: "asc" }, take: 300 }),
      prisma.lob.findMany({ orderBy: { name: "asc" } }),
      prisma.shift.findMany({ orderBy: { name: "asc" } }),
      prisma.role.findMany({ orderBy: { name: "asc" } }),
      prisma.permission.findMany({ orderBy: { key: "asc" } }),
      prisma.requestType.findMany({ orderBy: { name: "asc" } }),
      prisma.operationalSkill.findMany({ orderBy: [{ status: "asc" }, { name: "asc" }] }),
      prisma.team.findMany({ include: settingsTeamInclude, orderBy: { name: "asc" } }),
      prisma.employeeProfile.findMany({ where: { deletedAt: null }, select: settingsEmployeeSelect, orderBy: { fullName: "asc" }, take: 500 }),
      findSupervisorSettingEmployees(),
      readStatusMap(configKeys.lobStatus),
      readStatusMap(configKeys.shiftStatus),
      readStatusMap(configKeys.teamStatus),
      readStatusMap(configKeys.roleStatus),
      readStatusMap(configKeys.permissionStatus),
      readStatusMap(configKeys.requestTypeStatus),
      readObjectConfig<Record<string, string[]>>(configKeys.rolePermissions, {}),
      readRoleTitles(),
      readStringConfig(configKeys.defaultMonth, "2026-07"),
      readRuleList(configKeys.slaRules),
      readRuleList(configKeys.approvalRules),
      readRuleList(configKeys.coverageRules),
      readRuleList(configKeys.tokenRules),
      readObjectConfig<Record<string, unknown>>(configKeys.generalSettings, defaultGeneralSettings())
    ]);

    const superviseeCounts = countSuperviseesBySupervisor(employees);

    return {
      data: {
        users: users.map((user) => ({
          id: user.id,
          name: user.name,
          email: user.email,
          status: user.status,
          roleName: user.role.name,
          roleLabel: user.role.label,
          employeeId: user.employeeProfile?.id ?? "",
          employeeName: user.employeeProfile?.fullName ?? "",
          createdAt: user.createdAt.toISOString()
        })),
        lobs: lobs.map((lob) => ({ id: lob.id, name: lob.name, label: lob.name, description: lob.description ?? "", status: lobStatus[lob.id] ?? "ACTIVE", active: (lobStatus[lob.id] ?? "ACTIVE") === "ACTIVE", system: lob.name === "ALL", isSystem: lob.name === "ALL" })),
        shifts: formatShiftsForSettings(shifts, shiftStatus),
        roles: roles.map((role) => ({ id: role.id, name: role.name, label: role.label, description: role.description ?? "", status: roleStatus[role.id] ?? "ACTIVE", essential: essentialRoles.includes(role.name), permissions: permissionsForRole(role.name, rolePermissions) })),
        permissions: permissions.map((permission) => ({ id: permission.id, key: permission.key, label: permission.label, description: permission.description ?? "", status: permissionStatus[permission.id] ?? "ACTIVE" })),
        requestTypes: requestTypes.map((type) => ({ id: type.id, name: type.name, area: type.area, slaHours: type.slaHours, requiresApproval: type.requiresApproval, status: requestTypeStatus[type.id] ?? "ACTIVE", essential: essentialDayOffTypes.includes(type.name) })),
        skills: skills.map((skill) => ({ id: skill.id, name: skill.name, description: skill.description ?? "", color: skill.color, status: skill.status === "INACTIVE" ? "INACTIVE" : "ACTIVE" })),
        teams: teams.map((team) => ({ id: team.id, name: team.name, lobId: team.lobId, lob: team.lob.name, supervisorId: team.supervisorId ?? "", supervisorName: team.supervisor?.fullName ?? "", supervisorEmail: team.supervisor?.user?.email ?? "", status: teamStatus[team.id] ?? "ACTIVE" })),
        supervisors: supervisorEmployees
          .filter((employee) => canBeSupervisorOption(employee, superviseeCounts))
          .map((employee) => ({
            id: employee.id,
            name: employee.fullName,
            email: employee.user?.email ?? "",
            lobId: employee.lobId,
            lob: employee.lob.name,
            teamId: employee.teamId,
            team: employee.team.name,
            supervisees: superviseeCounts.get(employee.id) ?? 0,
            status: employee.operationalStatus
          })),
        employees: employees.map((employee) => ({
          id: employee.id,
          name: employee.fullName,
          email: employee.user?.email ?? "",
          wb: employee.wbLogin,
          roleTitle: employee.roleTitle,
          roleName: employee.user?.role?.name ?? "",
          lobId: employee.lobId,
          lob: employee.lob.name,
          teamId: employee.teamId,
          team: employee.team.name,
          supervisorId: employee.supervisorId ?? "",
          supervisorName: employee.supervisor?.fullName ?? "",
          shiftId: employee.shiftId,
          shift: cleanShiftName(employee.shift.name) || "Sem turno",
          status: employee.operationalStatus
        })),
        roleTitles,
        defaultMonth,
        slaRules,
        approvalRules,
        coverageRules,
        tokenRules,
        generalSettings
      }
    };
  } catch (error) {
    recordErrorLog({ userEmail: actor.email, code: "SETTINGS_LIST_ERROR", message: error instanceof Error ? error.message : "Falha ao listar configurações", route: "/api/settings", action: "SETTINGS_LIST", severity: "ERROR" });
    return { data: emptySettings() };
  }
}

async function getLimitedSystemSettings() {
  const [lobs, shifts, requestTypes, skills, teams, employees, supervisorEmployees, lobStatus, shiftStatus, teamStatus, requestTypeStatus, roleTitles, defaultMonth, generalSettings] = await Promise.all([
    prisma.lob.findMany({ orderBy: { name: "asc" } }),
    prisma.shift.findMany({ orderBy: { name: "asc" } }),
    prisma.requestType.findMany({ orderBy: { name: "asc" } }),
    prisma.operationalSkill.findMany({ orderBy: [{ status: "asc" }, { name: "asc" }] }),
    prisma.team.findMany({ include: settingsTeamInclude, orderBy: { name: "asc" } }),
    prisma.employeeProfile.findMany({ where: { deletedAt: null }, select: settingsEmployeeSelect, orderBy: { fullName: "asc" }, take: 500 }),
    findSupervisorSettingEmployees(),
    readStatusMap(configKeys.lobStatus),
    readStatusMap(configKeys.shiftStatus),
    readStatusMap(configKeys.teamStatus),
    readStatusMap(configKeys.requestTypeStatus),
    readRoleTitles(),
    readStringConfig(configKeys.defaultMonth, "2026-07"),
    readObjectConfig<Record<string, unknown>>(configKeys.generalSettings, defaultGeneralSettings())
  ]);

  const superviseeCounts = countSuperviseesBySupervisor(employees);

  return {
    ...emptySettings(),
    lobs: lobs.map((lob) => ({ id: lob.id, name: lob.name, label: lob.name, description: lob.description ?? "", status: lobStatus[lob.id] ?? "ACTIVE", active: (lobStatus[lob.id] ?? "ACTIVE") === "ACTIVE", system: lob.name === "ALL", isSystem: lob.name === "ALL" })),
    shifts: formatShiftsForSettings(shifts, shiftStatus),
    requestTypes: requestTypes.map((type) => ({ id: type.id, name: type.name, area: type.area, slaHours: type.slaHours, requiresApproval: type.requiresApproval, status: requestTypeStatus[type.id] ?? "ACTIVE", essential: essentialDayOffTypes.includes(type.name) })),
    skills: skills.map((skill) => ({ id: skill.id, name: skill.name, description: skill.description ?? "", color: skill.color, status: skill.status === "INACTIVE" ? "INACTIVE" : "ACTIVE" })),
    teams: teams.map((team) => ({ id: team.id, name: team.name, lobId: team.lobId, lob: team.lob.name, supervisorId: team.supervisorId ?? "", supervisorName: team.supervisor?.fullName ?? "", supervisorEmail: team.supervisor?.user?.email ?? "", status: teamStatus[team.id] ?? "ACTIVE" })),
    supervisors: supervisorEmployees
      .filter((employee) => canBeSupervisorOption(employee, superviseeCounts))
      .map((employee) => ({
        id: employee.id,
        name: employee.fullName,
        email: employee.user?.email ?? "",
        lobId: employee.lobId,
        lob: employee.lob.name,
        teamId: employee.teamId,
        team: employee.team.name,
        supervisees: superviseeCounts.get(employee.id) ?? 0,
        status: employee.operationalStatus
      })),
    employees: employees.map((employee) => ({
      id: employee.id,
      name: employee.fullName,
      email: employee.user?.email ?? "",
      wb: employee.wbLogin,
      roleTitle: employee.roleTitle,
      roleName: employee.user?.role?.name ?? "",
      lobId: employee.lobId,
      lob: employee.lob.name,
      teamId: employee.teamId,
      team: employee.team.name,
      supervisorId: employee.supervisorId ?? "",
      supervisorName: employee.supervisor?.fullName ?? "",
      shiftId: employee.shiftId,
      shift: cleanShiftName(employee.shift.name) || "Sem turno",
      status: employee.operationalStatus
    })),
    roleTitles,
    defaultMonth,
    generalSettings
  };
}

export async function updateSystemSettings(actor: Actor, action: SettingsAction) {
  try {
    const admin = await prisma.user.findUnique({ where: { email: actor.email }, include: { role: true } });
    if (!admin || normalizeRole(actor.role) !== "ADMIN") return { error: "Apenas Admin pode alterar configurações." };

    const result = await prisma.$transaction(async (tx) => {
      switch (String(action.type)) {
        case "user":
          return saveUser(tx, admin.id, action);
        case "role":
          return saveRole(tx, admin.id, action);
        case "permission":
          return { error: "A matriz de permissões é definida centralmente por role." };
        case "lob":
          return saveLob(tx, admin.id, action);
        case "team":
          return saveTeam(tx, admin.id, action);
        case "supervisor":
          return saveSupervisorLink(tx, admin.id, action);
        case "shift":
          return saveShift(tx, admin.id, action);
        case "requestType":
          return saveRequestType(tx, admin.id, action);
        case "roleTitle":
          return saveRoleTitle(tx, admin.id, action);
        case "skill":
          return saveOperationalSkill(tx, admin.id, action);
        case "defaultMonth":
          return saveDefaultMonth(tx, admin.id, action);
        case "slaRule":
          return saveRule(tx, admin.id, configKeys.slaRules, "SlaRule", action);
        case "approvalRule":
          return saveRule(tx, admin.id, configKeys.approvalRules, "ApprovalRule", action);
        case "coverageRule":
          return saveRule(tx, admin.id, configKeys.coverageRules, "CoverageRule", action);
        case "tokenRule":
          return saveRule(tx, admin.id, configKeys.tokenRules, "TokenRule", action);
        case "generalSettings":
          return saveGeneralSettings(tx, admin.id, action);
        default:
          return { error: "Ação de configuração inválida." };
      }
    });

    if ("error" in result) return result;
    return { success: true, ...result };
  } catch (error) {
    console.error("[settings] erro ao salvar configuração", error);
    recordErrorLog({ userEmail: actor.email, code: "SETTINGS_SAVE_ERROR", message: error instanceof Error ? error.message : "Falha ao salvar configurações", route: "/api/settings", action: "SETTINGS_SAVE", severity: "ERROR" });
    return { error: "Não foi possível salvar a configuração." };
  }
}

async function saveUser(tx: Prisma.TransactionClient, adminId: string, action: SettingsAction) {
  const id = text(action.id);
  const name = cleanShiftName(text(action.name));
  const email = text(action.email).toLowerCase();
  const roleName = text(action.roleName) || "COLABORADOR";
  const status = text(action.status) || "ACTIVE";
  const employeeId = text(action.employeeId);
  if (!name || !email) return { error: "Nome e e-mail do usuário são obrigatórios." };
  const role = await tx.role.findUnique({ where: { name: roleName } });
  if (!role) return { error: "Role/perfil não encontrado." };
  if (status !== "ACTIVE" && id) {
    const user = await tx.user.findUnique({ where: { id }, include: { role: true } });
    if (user?.role.name === "ADMIN") {
      const activeAdmins = await tx.user.count({ where: { status: "ACTIVE", deletedAt: null, role: { name: "ADMIN" }, id: { not: id } } });
      if (!activeAdmins) return { error: "Não é permitido inativar o único Admin ativo." };
    }
  }
  const duplicate = await tx.user.findFirst({ where: { email, deletedAt: null, ...(id ? { id: { not: id } } : {}) } });
  if (duplicate) return { error: "Já existe usuário ativo com este e-mail." };
  const password = text(action.password);
  if (!id && password.length < 8) return { error: "Senha temporária deve ter pelo menos 8 caracteres." };
  const passwordHash = password ? await bcrypt.hash(password, 10) : undefined;
  const before = id ? await tx.user.findUnique({ where: { id }, include: { role: true, employeeProfile: true } }) : null;
  const passwordResetData = passwordHash
    ? { passwordHash, mustChangePassword: true, temporaryPassword: true, lastPasswordResetAt: new Date(), passwordResetById: adminId }
    : {};
  const user = id
    ? await tx.user.update({ where: { id }, data: { name, email, roleId: role.id, status: status === "INACTIVE" ? "INACTIVE" : "ACTIVE", ...passwordResetData } })
    : await tx.user.create({ data: { name, email, roleId: role.id, passwordHash: passwordHash!, status: "ACTIVE", mustChangePassword: true, temporaryPassword: true, lastPasswordResetAt: new Date(), passwordResetById: adminId } });
  if (employeeId) {
    await tx.employeeProfile.update({ where: { id: employeeId }, data: { userId: user.id } });
  }
  await auditSettings(tx, adminId, id ? "EDICAO" : "CRIACAO", "User", user.id, action, before);
  return { data: user };
}

async function saveRole(tx: Prisma.TransactionClient, adminId: string, action: SettingsAction) {
  const id = text(action.id);
  const name = text(action.name);
  const label = text(action.label);
  const description = text(action.description);
  const status = isBlockedShiftName(name) ? "INACTIVE" : statusValue(action.status);
  const role = id ? await tx.role.findUnique({ where: { id } }) : await tx.role.findUnique({ where: { name } });
  if (!role) return { error: "Role/perfil não encontrado." };
  if (role.name === "ADMIN" && status === "INACTIVE") return { error: "ADMIN é essencial e não pode ser inativado." };
  const updated = await tx.role.update({ where: { id: role.id }, data: { label: label || role.label, description: description || null } });
  if (status) await writeStatus(tx, configKeys.roleStatus, role.id, status);
  await auditSettings(tx, adminId, "EDICAO", "Role", role.id, action, role);
  return { data: updated };
}

async function savePermission(tx: Prisma.TransactionClient, adminId: string, action: SettingsAction) {
  const id = text(action.id);
  const key = text(action.key);
  const label = text(action.label);
  const description = text(action.description);
  const status = statusValue(action.status);
  if (!key || !label) return { error: "Chave e label da permissão são obrigatórios." };
  const permission = id
    ? await tx.permission.update({ where: { id }, data: { key, label, description: description || null } })
    : await tx.permission.upsert({ where: { key }, update: { label, description: description || null }, create: { key, label, description: description || null } });
  if (status) await writeStatus(tx, configKeys.permissionStatus, permission.id, status);
  const roleName = text(action.roleName);
  if (roleName) {
    if (roleName === "ADMIN" && action.granted === false) return { error: "Não é permitido remover permissões críticas do ADMIN." };
    if (roleName === "SUPERVISOR" && action.granted !== false && !supervisorAllowedPermissionKeys.has(permission.key)) {
      return { error: "Supervisor não pode receber permissões administrativas de WFM/Admin." };
    }
    const current = await readObjectConfig<Record<string, string[]>>(configKeys.rolePermissions, {}, tx);
    const sanitized = sanitizeRolePermissions(current);
    const currentList = new Set(sanitized[roleName] ?? defaultPermissionsForRole(roleName));
    if (action.granted === false) currentList.delete(permission.key);
    else currentList.add(permission.key);
    await writeJsonConfig(tx, configKeys.rolePermissions, sanitizeRolePermissions({ ...sanitized, [roleName]: Array.from(currentList) }), "Permissões por role");
  }
  await auditSettings(tx, adminId, id ? "EDICAO" : "CRIACAO", "Permission", permission.id, action);
  return { data: permission };
}

async function saveLob(tx: Prisma.TransactionClient, adminId: string, action: SettingsAction) {
  const id = text(action.id);
  const name = text(action.name).toUpperCase() === "ALL" ? "ALL" : text(action.name);
  const description = text(action.description);
  const status = statusValue(action.status);
  if (!name) return { error: "Nome da LOB é obrigatório." };
  if (name === "ALL" && status === "INACTIVE") return { error: "LOB ALL é sistêmica e deve permanecer ativa." };
  const lob = id
    ? await tx.lob.update({ where: { id }, data: { name, description: description || null } })
    : await tx.lob.upsert({ where: { name }, update: { description: description || null }, create: { name, description: description || null } });
  if (status) await writeStatus(tx, configKeys.lobStatus, lob.id, status);
  await auditSettings(tx, adminId, id ? "EDICAO" : "CRIACAO", "Lob", lob.id, action);
  return { data: lob };
}

async function saveTeam(tx: Prisma.TransactionClient, adminId: string, action: SettingsAction) {
  const id = text(action.id);
  const name = text(action.name);
  const lobId = text(action.lobId);
  const supervisorId = text(action.supervisorId);
  const status = statusValue(action.status);
  if (!name || !lobId) return { error: "Nome e LOB do time são obrigatórios." };
  const before = id ? await tx.team.findUnique({ where: { id } }) : null;
  const team = id
    ? await tx.team.update({ where: { id }, data: { name, lobId, supervisorId: supervisorId || null } })
    : await tx.team.upsert({ where: { name_lobId: { name, lobId } }, update: { supervisorId: supervisorId || null }, create: { name, lobId, supervisorId: supervisorId || null } });
  if (status) await writeStatus(tx, configKeys.teamStatus, team.id, status);
  await auditSettings(tx, adminId, id ? "EDICAO" : "CRIACAO", "Team", team.id, action, before);
  return { data: team };
}

async function saveSupervisorLink(tx: Prisma.TransactionClient, adminId: string, action: SettingsAction) {
  const supervisorId = text(action.supervisorId);
  const teamId = text(action.teamId);
  const employeeId = text(action.employeeId);
  if (!supervisorId) return { error: "Supervisor é obrigatório." };
  const supervisor = await tx.employeeProfile.findUnique({ where: { id: supervisorId }, include: { user: { include: { role: true } } } });
  if (!supervisor?.user || !["SUPERVISOR", "ADMIN"].includes(supervisor.user.role.name)) return { error: "Supervisor deve ter role SUPERVISOR ou ADMIN." };
  if (teamId) {
    const before = await tx.team.findUnique({ where: { id: teamId } });
    const team = await tx.team.update({ where: { id: teamId }, data: { supervisorId } });
    await auditSettings(tx, adminId, "EDICAO", "Team", team.id, action, before);
    return { data: team };
  }
  if (employeeId) {
    const before = await tx.employeeProfile.findUnique({ where: { id: employeeId } });
    const employee = await tx.employeeProfile.update({ where: { id: employeeId }, data: { supervisorId } });
    await auditSettings(tx, adminId, "EDICAO", "EmployeeProfile", employee.id, action, before);
    return { data: employee };
  }
  return { error: "Informe time ou colaborador para vínculo de supervisão." };
}

async function saveShift(tx: Prisma.TransactionClient, adminId: string, action: SettingsAction) {
  const id = text(action.id);
  const name = text(action.name);
  const startsAt = text(action.startsAt);
  const endsAt = text(action.endsAt);
  const color = text(action.color) || "#2563EB";
  const status = statusValue(action.status);
  if (!name || !startsAt || !endsAt) return { error: "Nome, entrada e saída do turno são obrigatórios." };
  if (!/^\d{2}:\d{2}$/.test(startsAt) || !/^\d{2}:\d{2}$/.test(endsAt)) return { error: "Horários devem estar no formato HH:mm." };
  const shift = id
    ? await tx.shift.update({ where: { id }, data: { name, startsAt, endsAt, color } })
    : await tx.shift.upsert({ where: { name }, update: { startsAt, endsAt, color }, create: { name, startsAt, endsAt, color } });
  if (status) await writeStatus(tx, configKeys.shiftStatus, shift.id, status);
  await auditSettings(tx, adminId, id ? "EDICAO" : "CRIACAO", "Shift", shift.id, action);
  return { data: shift };
}

async function saveRequestType(tx: Prisma.TransactionClient, adminId: string, action: SettingsAction) {
  const id = text(action.id);
  const name = text(action.name);
  const area = text(action.area) || "Operação";
  const slaHours = Number(action.slaHours) || 24;
  const requiresApproval = action.requiresApproval !== false;
  const status = statusValue(action.status);
  if (!name) return { error: "Nome do tipo de solicitação é obrigatório." };
  if (essentialDayOffTypes.includes(name) && status === "INACTIVE") return { error: "Tipos essenciais de folga não podem ser inativados." };
  const requestType = id
    ? await tx.requestType.update({ where: { id }, data: { name, area, slaHours, requiresApproval } })
    : await tx.requestType.upsert({ where: { name }, update: { area, slaHours, requiresApproval }, create: { name, area, slaHours, requiresApproval } });
  if (status) await writeStatus(tx, configKeys.requestTypeStatus, requestType.id, status);
  await auditSettings(tx, adminId, id ? "EDICAO" : "CRIACAO", "RequestType", requestType.id, action);
  return { data: requestType };
}

async function saveRoleTitle(tx: Prisma.TransactionClient, adminId: string, action: SettingsAction) {
  const name = text(action.name);
  if (!name) return { error: "Nome do cargo/função é obrigatório." };
  const current = await readRoleTitles(tx);
  const next = upsertRoleTitle(current, text(action.previousName), name, statusValue(action.status) ?? "ACTIVE");
  await writeJsonConfig(tx, configKeys.roleTitles, next, "Cargos/funções operacionais configuráveis");
  await auditSettings(tx, adminId, "EDICAO", "SystemConfig", configKeys.roleTitles, action);
  return { data: next };
}

async function saveOperationalSkill(tx: Prisma.TransactionClient, adminId: string, action: SettingsAction) {
  const id = text(action.id);
  const name = text(action.name);
  const normalizedName = normalizeSkillName(name);
  const description = text(action.description);
  const color = /^#[0-9A-F]{6}$/i.test(text(action.color)) ? text(action.color).toUpperCase() : "#2563EB";
  const status = statusValue(action.status) ?? "ACTIVE";
  if (!name) return { error: "Nome da skill é obrigatório." };
  const duplicate = await tx.operationalSkill.findFirst({ where: { normalizedName, ...(id ? { id: { not: id } } : {}) } });
  if (duplicate) return { error: "Já existe uma skill com esse nome." };
  const before = id ? await tx.operationalSkill.findUnique({ where: { id } }) : null;
  const skill = id
    ? await tx.operationalSkill.update({ where: { id }, data: { name, normalizedName, description: description || null, color, status } })
    : await tx.operationalSkill.create({ data: { name, normalizedName, description: description || null, color, status } });
  if (before && before.name !== name) {
    await tx.employeeProfile.updateMany({ where: { skill: before.name }, data: { skill: name } });
  }
  await auditSettings(tx, adminId, id ? "EDICAO" : "CRIACAO", "OperationalSkill", skill.id, action, before ?? undefined);
  return { data: skill };
}

async function saveDefaultMonth(tx: Prisma.TransactionClient, adminId: string, action: SettingsAction) {
  const value = text(action.value);
  if (!/^\d{4}-\d{2}$/.test(value)) return { error: "Mês padrão deve estar no formato AAAA-MM." };
  await writeJsonConfig(tx, configKeys.defaultMonth, value, "Mês padrão para testes locais");
  await auditSettings(tx, adminId, "EDICAO", "SystemConfig", configKeys.defaultMonth, action);
  return { data: { value } };
}

async function saveRule(tx: Prisma.TransactionClient, adminId: string, key: string, entity: string, action: SettingsAction) {
  const current = await readRuleList(key, tx);
  const id = text(action.id) || randomUUID();
  const name = text(action.name);
  if (!name) return { error: "Nome da regra é obrigatório." };
  const nextItem: ConfigRule = { ...action, id, name, status: statusValue(action.status) ?? "ACTIVE" } as ConfigRule;
  delete nextItem.type;
  const next = upsertById(current, nextItem);
  await writeJsonConfig(tx, key, next, entity);
  await auditSettings(tx, adminId, current.some((item) => item.id === id) ? "EDICAO" : "CRIACAO", entity, id, action);
  return { data: nextItem };
}

async function saveGeneralSettings(tx: Prisma.TransactionClient, adminId: string, action: SettingsAction) {
  const settings: Record<string, unknown> = { ...defaultGeneralSettings(), ...(action.values && typeof action.values === "object" ? action.values as Record<string, unknown> : action) };
  delete settings.type;
  await writeJsonConfig(tx, configKeys.generalSettings, settings, "Configurações gerais");
  await auditSettings(tx, adminId, "EDICAO", "SystemConfig", configKeys.generalSettings, action);
  return { data: settings };
}

async function ensureCoreSettings() {
  const allLob = await prisma.lob.upsert({
    where: { name: "ALL" },
    update: { description: "Atuação transversal / staff / multi-LOB" },
    create: { name: "ALL", description: "Atuação transversal / staff / multi-LOB" }
  });
  const lobStatus = await readStatusMap(configKeys.lobStatus);
  if (lobStatus[allLob.id] !== "ACTIVE") {
    await prisma.systemConfig.upsert({
      where: { key: configKeys.lobStatus },
      update: { value: { ...lobStatus, [allLob.id]: "ACTIVE" } },
      create: { key: configKeys.lobStatus, value: { [allLob.id]: "ACTIVE" }, description: "Status configurável de LOBs" }
    });
  }
  await Promise.all(permissionSeeds.map(([key, label]) => prisma.permission.upsert({ where: { key }, update: { label }, create: { key, label, description: label } })));
  const current = await readObjectConfig<Record<string, string[]>>(configKeys.rolePermissions, {});
  const next = { ...current };
  for (const role of essentialRoles) next[role] ??= defaultPermissionsForRole(role);
  await prisma.systemConfig.upsert({
    where: { key: configKeys.rolePermissions },
    update: { value: sanitizeRolePermissions(next) as Prisma.InputJsonValue },
    create: { key: configKeys.rolePermissions, value: sanitizeRolePermissions(next) as Prisma.InputJsonValue, description: "Permissões por role" }
  });
}

async function assertAuthenticated(actor: Actor) {
  if (!actor.email) throw new Error("Usuário não autenticado.");
}

async function readStatusMap(key: string, client: Prisma.TransactionClient | typeof prisma = prisma): Promise<StatusMap> {
  const config = await client.systemConfig.findUnique({ where: { key } });
  if (!config || typeof config.value !== "object" || Array.isArray(config.value) || !config.value) return {};
  return Object.fromEntries(Object.entries(config.value).map(([id, status]) => [id, status === "INACTIVE" ? "INACTIVE" : "ACTIVE"]));
}

async function readObjectConfig<T>(key: string, fallback: T, client: Prisma.TransactionClient | typeof prisma = prisma): Promise<T> {
  const config = await client.systemConfig.findUnique({ where: { key } });
  if (!config?.value || typeof config.value !== "object" || Array.isArray(config.value)) return fallback;
  return config.value as T;
}

async function readRuleList(key: string, client: Prisma.TransactionClient | typeof prisma = prisma): Promise<ConfigRule[]> {
  const config = await client.systemConfig.findUnique({ where: { key } });
  if (!Array.isArray(config?.value)) return [];
  return config.value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item) || !("id" in item) || !("name" in item)) return null;
      return item as ConfigRule;
    })
    .filter((item): item is ConfigRule => Boolean(item));
}

async function readRoleTitles(client: Prisma.TransactionClient | typeof prisma = prisma): Promise<RoleTitleConfig[]> {
  const config = await client.systemConfig.findUnique({ where: { key: configKeys.roleTitles } });
  if (!Array.isArray(config?.value)) {
    return ["Agente", "Supervisor", "WFM", "Qualidade", "RH", "Logística/TI", "Coordenador", "Gerente", "Outro"].map((name) => ({ name, status: "ACTIVE" }));
  }
  return config.value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      const name = String(record.name ?? "").trim();
      if (!name) return null;
      return { name, status: record.status === "INACTIVE" ? "INACTIVE" : "ACTIVE" } satisfies RoleTitleConfig;
    })
    .filter((item): item is RoleTitleConfig => Boolean(item));
}

async function readStringConfig(key: string, fallback: string) {
  const config = await prisma.systemConfig.findUnique({ where: { key } });
  return typeof config?.value === "string" ? config.value : fallback;
}

async function writeStatus(tx: Prisma.TransactionClient, key: string, id: string, status: StatusValue) {
  const current = await readStatusMap(key, tx);
  await writeJsonConfig(tx, key, { ...current, [id]: status }, "Status configurável");
}

async function writeJsonConfig(tx: Prisma.TransactionClient, key: string, value: unknown, description: string) {
  await tx.systemConfig.upsert({
    where: { key },
    update: { value: toJson(value), description },
    create: { key, value: toJson(value), description }
  });
}

function upsertRoleTitle(current: RoleTitleConfig[], previousName: string | undefined, name: string, status: StatusValue) {
  const index = current.findIndex((item) => item.name === (previousName || name));
  if (index >= 0) return current.map((item, itemIndex) => (itemIndex === index ? { name, status } : item));
  return [...current, { name, status }];
}

function upsertById(list: ConfigRule[], item: ConfigRule) {
  return list.some((entry) => entry.id === item.id) ? list.map((entry) => (entry.id === item.id ? item : entry)) : [...list, item];
}

function formatShiftsForSettings(shifts: Array<{ id: string; name: string; startsAt: string; endsAt: string; color: string }>, shiftStatus: Record<string, StatusValue>) {
  const byCleanName = new Map<string, { id: string; name: string; startsAt: string; endsAt: string; color: string; status: StatusValue; exactCleanName: boolean }>();
  for (const shift of shifts) {
    const cleanName = cleanShiftName(shift.name);
    if (!cleanName || isBlockedShiftName(cleanName)) continue;
    const status = shiftStatus[shift.id] ?? "ACTIVE";
    const exactCleanName = shift.name === cleanName;
    const current = byCleanName.get(cleanName);
    if (!current || (current.status !== "ACTIVE" && status === "ACTIVE") || (!current.exactCleanName && exactCleanName)) {
      byCleanName.set(cleanName, { ...shift, name: cleanName, status, exactCleanName });
    }
  }
  return Array.from(byCleanName.values()).map(({ exactCleanName: _exactCleanName, ...shift }) => shift);
}

async function auditSettings(tx: Prisma.TransactionClient, actorId: string, action: "CRIACAO" | "EDICAO", entity: string, entityId: string, payload: unknown, previousValue?: unknown) {
  await tx.auditLog.create({
    data: {
      actorId,
      action,
      entity,
      entityId,
      reason: "Alteração em Configurações",
      previousValue: previousValue === undefined ? undefined : toJson(previousValue),
      newValue: toJson(payload)
    }
  });
}

async function findSupervisorSettingEmployees() {
  const supervisorRoles = ["SUPERVISOR", "GESTOR", "MANAGEMENT", "WFM", "ADMIN"];
  return prisma.employeeProfile.findMany({
    where: {
      deletedAt: null,
      OR: [
        { roleTitle: { contains: "supervisor", mode: "insensitive" } },
        { roleTitle: { contains: "gestor", mode: "insensitive" } },
        { roleTitle: { contains: "coordenador", mode: "insensitive" } },
        { roleTitle: { contains: "gerente", mode: "insensitive" } },
        { user: { role: { name: { in: supervisorRoles } } } },
        { supervisees: { some: { deletedAt: null } } }
      ]
    },
    select: settingsEmployeeSelect,
    orderBy: { fullName: "asc" }
  });
}

function canBeSupervisorOption(
  employee: { id: string; roleTitle: string | null; operationalStatus: string | null; user?: { role?: { name: string } | null } | null },
  superviseeCounts: Map<string, number>
) {
  const status = text(employee.operationalStatus).normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase().replace(/\s+/g, "_");
  const alreadySupervises = (superviseeCounts.get(employee.id) ?? 0) > 0;
  const roleName = text(employee.user?.role?.name).toUpperCase();
  const inactiveStatuses = new Set(["INACTIVE", "INATIVO", "DESLIGADO", "DESLIGADO_EM_TREINAMENTO", "DESATIVADO"]);
  return !inactiveStatuses.has(status) && (
    alreadySupervises ||
    canBeSupervisorJobTitle(employee.roleTitle) ||
    ["SUPERVISOR", "GESTOR", "MANAGEMENT", "WFM", "ADMIN"].includes(roleName)
  );
}

function countSuperviseesBySupervisor(employees: Array<{ supervisorId: string | null }>) {
  const counts = new Map<string, number>();
  employees.forEach((employee) => {
    if (!employee.supervisorId) return;
    counts.set(employee.supervisorId, (counts.get(employee.supervisorId) ?? 0) + 1);
  });
  return counts;
}

function defaultPermissionsForRole(roleName: string) {
  if (roleName === "ADMIN") return permissionSeeds.map(([key]) => key);
  if (roleName === "WFM") return ["can_manage_schedules", "can_import_schedules", "can_add_schedule_manually", "can_edit_schedule_full", "can_mark_present", "can_approve_day_off_wfm_step", "can_manage_coverage_rules", "can_view_employee_map"];
  if (roleName === "SUPERVISOR") return Array.from(supervisorAllowedPermissionKeys);
  if (roleName === "RH") return ["can_manage_registrations", "can_view_employee_map", "can_view_sensitive_employee_data"];
  if (roleName === "GESTOR") return ["can_view_employee_map", "can_export_employee_data", "can_access_audit_logs"];
  return [];
}

function permissionsForRole(roleName: string, rolePermissions: Record<string, string[]>) {
  const sanitized = sanitizeRolePermissions(rolePermissions);
  return sanitized[roleName] ?? defaultPermissionsForRole(roleName);
}

function sanitizeRolePermissions(rolePermissions: Record<string, string[]>) {
  const next: Record<string, string[]> = { ...rolePermissions };
  const supervisorPermissions = new Set(next.SUPERVISOR ?? defaultPermissionsForRole("SUPERVISOR"));
  supervisorBlockedPermissionKeys.forEach((permission) => supervisorPermissions.delete(permission));
  supervisorAllowedPermissionKeys.forEach((permission) => supervisorPermissions.add(permission));
  next.SUPERVISOR = Array.from(supervisorPermissions).filter((permission) => supervisorAllowedPermissionKeys.has(permission));
  return next;
}

function defaultGeneralSettings() {
  return {
    operationName: "Central Operacional",
    defaultMonth: "2026-07",
    timezone: "America/Sao_Paulo",
    enableScheduleUpload: true,
    enableDayOffRequests: true,
    enableDayOffSell: true,
    enablePublicRegistration: true,
    enableEmployeeImport: true,
    enableInternalNotifications: true,
    sensitiveDataPolicy: "restricted"
  };
}

function emptySettings() {
  return {
    users: [],
    lobs: [],
    shifts: [],
    roles: [],
    permissions: [],
    requestTypes: [],
    skills: [],
    teams: [],
    supervisors: [],
    employees: [],
    roleTitles: [],
    defaultMonth: "2026-07",
    slaRules: [],
    approvalRules: [],
    coverageRules: [],
    tokenRules: [],
    generalSettings: defaultGeneralSettings()
  };
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeSkillName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().replace(/\s+/g, " ");
}

function statusValue(value: unknown): StatusValue | undefined {
  return value === "ACTIVE" || value === "INACTIVE" ? value : undefined;
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
