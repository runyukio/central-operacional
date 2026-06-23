import type { AppRole } from "@/lib/demo-auth";
import { isAgentJobTitle, normalizeComparableJobTitle } from "@/lib/job-title-normalization";

export type PermissionUser = {
  role?: string | null;
  email?: string | null;
  name?: string | null;
  status?: string | null;
  roleTitle?: string | null;
  jobTitle?: string | null;
  skill?: string | null;
};

export type PermissionEmployee = {
  email?: string | null;
  roleTitle?: string | null;
  role?: string | null;
  supervisor?: string | null;
  supervisorEmail?: string | null;
  teamId?: string | null;
  id?: string | null;
};

const roleAliases: Record<string, AppRole> = {
  COLLABORATOR: "COLABORADOR",
  COLABORADOR: "COLABORADOR",
  SUPERVISOR: "SUPERVISOR",
  WFM: "WFM",
  QUALITY: "QUALIDADE",
  QUALIDADE: "QUALIDADE",
  HR: "RH",
  RH: "RH",
  LOGISTICS_IT: "TI",
  TI: "TI",
  MANAGEMENT: "GESTOR",
  GESTOR: "GESTOR",
  COORDENADOR: "COORDENADOR",
  COORDINATOR: "COORDENADOR",
  GERENTE: "GERENTE",
  MANAGER: "GERENTE",
  CLIENT: "CLIENT",
  ADMIN: "ADMIN",
  ADMINISTRADOR: "ADMIN",
  ADMINISTRADORA: "ADMIN",
  "ADMIN CENTRAL": "ADMIN"
};

export function normalizeRole(role?: string | null): AppRole {
  return roleAliases[String(role ?? "COLABORADOR").toUpperCase()] ?? "COLABORADOR";
}

export function isActiveUser(user: PermissionUser) {
  return !user.status || user.status === "ACTIVE" || user.status === "Ativo";
}

export function isAgentEmployee(employee?: PermissionEmployee | null) {
  return isAgentJobTitle(employee?.roleTitle ?? employee?.role);
}

export function canViewEmployeeDetails(user: PermissionUser, employee?: PermissionEmployee | null) {
  const role = normalizeRole(user.role);
  if (!isActiveUser(user)) return false;
  if (["ADMIN", "GESTOR", "RH", "WFM", "SUPERVISOR"].includes(role)) return true;
  if (role === "COLABORADOR") return Boolean(user.email && employee?.email === user.email);
  return false;
}

export function canViewEmployeeSensitiveData(user: PermissionUser, employee?: PermissionEmployee | null) {
  const role = normalizeRole(user.role);
  if (!isActiveUser(user)) return false;
  if (["ADMIN", "GESTOR"].includes(role)) return true;
  if (role === "RH") return employee ? isAgentEmployee(employee) : true;
  return false;
}

export function canEditEmployeeData(user: PermissionUser, employee?: PermissionEmployee | null) {
  const role = normalizeRole(user.role);
  if (!isActiveUser(user)) return false;
  if (["ADMIN", "GESTOR"].includes(role)) return true;
  if (role === "RH") return employee ? isAgentEmployee(employee) : true;
  if (role === "WFM") return true;
  return false;
}

export function canExportEmployeeData(user: PermissionUser) {
  return canAccessEmployeeMap(user);
}

export function sanitizeEmployeeForRole<T extends Record<string, unknown>>(employee: T, user: PermissionUser): T {
  if (canViewEmployeeSensitiveData(user, employee as PermissionEmployee)) return employee;
  const clone = { ...employee };
  delete clone.sensitive;
  return clone;
}

export function canAccessEmployeeMap(user: PermissionUser) {
  const role = normalizeRole(user.role);
  return isActiveUser(user) && ["ADMIN", "GESTOR", "RH", "WFM", "SUPERVISOR"].includes(role);
}

export function canAccessAdvanceModule(user: PermissionUser) {
  const role = normalizeRole(user.role);
  return isActiveUser(user) && ["ADMIN", "GESTOR", "WFM"].includes(role);
}

export function canAccessStaffCoverage(user: PermissionUser) {
  const role = normalizeRole(user.role);
  return isActiveUser(user) && ["ADMIN", "GESTOR", "WFM", "SUPERVISOR"].includes(role);
}

export function canAccessRealTime(user: PermissionUser) {
  const role = normalizeRole(user.role);
  if (!isActiveUser(user)) return false;
  if (["ADMIN", "GESTOR", "WFM", "SUPERVISOR"].includes(role)) return true;
  return hasRealTimeOperationalSkill(user.skill) || hasRealTimeOperationalSkill(user.roleTitle) || hasRealTimeOperationalSkill(user.jobTitle);
}

export function hasRealTimeOperationalSkill(value?: string | null) {
  return isRtaSkill(value) || isPocSkill(value);
}

export function isRtaSkill(value?: string | null) {
  const normalized = normalizeComparableJobTitle(value);
  if (!normalized) return false;
  const compact = normalized.replace(/[^a-z0-9]/g, "");
  return (
    /(^|[^a-z0-9])rta([^a-z0-9]|$)/.test(normalized) ||
    compact === "rta" ||
    compact === "realtime" ||
    compact.includes("realtimeanalyst") ||
    compact.includes("analistarealtime") ||
    compact.includes("analistarta")
  );
}

export function isPocSkill(value?: string | null) {
  const normalized = normalizeComparableJobTitle(value);
  if (!normalized) return false;
  const compact = normalized.replace(/[^a-z0-9]/g, "");
  return (
    /(^|[^a-z0-9])poc([^a-z0-9]|$)/.test(normalized) ||
    compact === "poc" ||
    compact.includes("pointofcontact")
  );
}

export function canAccessWorkSessionMonitoring(user: PermissionUser) {
  const role = normalizeRole(user.role);
  if (!isActiveUser(user)) return false;
  if (["ADMIN", "GESTOR", "WFM", "SUPERVISOR", "COORDENADOR", "GERENTE"].includes(role)) return true;
  const title = normalizeComparableJobTitle(user.roleTitle ?? user.jobTitle);
  return ["gestor", "gestora", "coordenador", "coordenadora", "gerente", "manager", "management"].includes(title);
}

export function canExportWorkSessionMonitoring(user: PermissionUser) {
  return canAccessWorkSessionMonitoring(user);
}

export function canAccessPerformance(user: PermissionUser) {
  return isActiveUser(user);
}

export function canAccessPerformanceWfh(user: PermissionUser) {
  const role = normalizeRole(user.role);
  if (!isActiveUser(user)) return false;
  if (["ADMIN", "GESTOR", "WFM", "SUPERVISOR", "RH", "COORDENADOR", "GERENTE", "MANAGEMENT", "CLIENT"].includes(role)) return true;
  const title = normalizeComparableJobTitle(user.roleTitle ?? user.jobTitle);
  return ["coordenador", "coordenadora", "gerente", "manager", "management"].includes(title);
}

export function canImportPerformance(user: PermissionUser) {
  const role = normalizeRole(user.role);
  return isActiveUser(user) && ["ADMIN", "WFM"].includes(role);
}

export function canExportPerformance(user: PermissionUser) {
  return normalizeRole(user.role) !== "CLIENT" && canAccessPerformanceWfh(user);
}

export function canManageStaffCoverageRequirements(user: PermissionUser) {
  const role = normalizeRole(user.role);
  return isActiveUser(user) && ["ADMIN", "WFM"].includes(role);
}

export function canExportStaffCoverage(user: PermissionUser) {
  return canAccessStaffCoverage(user);
}

export function canAccessAnonymousFeedback(user: PermissionUser) {
  return canViewAnonymousFeedbackAdmin(user) || canSubmitAnonymousFeedback(user);
}

export function canSubmitAnonymousFeedback(user: PermissionUser) {
  return isActiveUser(user) && Boolean(user.email) && !canViewAnonymousFeedbackAdmin(user);
}

export function canViewAnonymousFeedbackAdmin(user: PermissionUser) {
  const role = normalizeRole(user.role);
  if (!isActiveUser(user)) return false;
  if (["ADMIN", "GESTOR", "RH"].includes(role)) return true;
  return isAnonymousFeedbackLeadershipTitle(user.roleTitle ?? user.jobTitle);
}

export function canManageAnonymousFeedback(user: PermissionUser) {
  return canViewAnonymousFeedbackAdmin(user);
}

export function canExportAnonymousFeedback(user: PermissionUser) {
  return canViewAnonymousFeedbackAdmin(user);
}

function isAnonymousFeedbackLeadershipTitle(value?: string | null) {
  const title = normalizeComparableJobTitle(value);
  return ["coordenador", "coordenadora", "gestor", "gestora", "gerente", "manager", "management"].includes(title);
}

export function canAccessHierarchy(user: PermissionUser) {
  const role = normalizeRole(user.role);
  return isActiveUser(user) && ["ADMIN", "GESTOR", "RH", "WFM", "SUPERVISOR"].includes(role);
}

export function canManageHierarchy(user: PermissionUser) {
  const role = normalizeRole(user.role);
  return isActiveUser(user) && ["ADMIN", "RH", "WFM"].includes(role);
}

export function canEditAdvanceRecords(user: PermissionUser) {
  return canAccessAdvanceModule(user) && ["ADMIN", "GESTOR", "WFM"].includes(normalizeRole(user.role));
}

export function canImportAdvanceRecords(user: PermissionUser) {
  return canEditAdvanceRecords(user);
}

export function canExportAdvanceRecords(user: PermissionUser) {
  return canAccessAdvanceModule(user);
}

export function canDeleteAdvanceRecords(user: PermissionUser) {
  return canEditAdvanceRecords(user);
}

export function canEditSchedule(user: PermissionUser) {
  const role = normalizeRole(user.role);
  return isActiveUser(user) && ["ADMIN", "GESTOR", "WFM"].includes(role);
}

export function canImportWorkHours(user: PermissionUser) {
  return canEditWorkHours(user);
}

export function canEditWorkHours(user: PermissionUser) {
  const role = normalizeRole(user.role);
  return isActiveUser(user) && ["ADMIN", "GESTOR", "WFM"].includes(role);
}

export function canApproveWorkHourAdjustment(user: PermissionUser) {
  return canEditWorkHours(user);
}

export function canRequestWorkHourAdjustment(user: PermissionUser) {
  const role = normalizeRole(user.role);
  return isActiveUser(user) && ["ADMIN", "GESTOR", "WFM", "SUPERVISOR"].includes(role);
}

export function canImportCronogramas(user: PermissionUser) {
  return canEditSchedule(user);
}

export function canCreateCronogramaManually(user: PermissionUser) {
  return canEditSchedule(user);
}

export function canUpdateScheduleSlot(user: PermissionUser) {
  return canEditSchedule(user);
}

export function canApproveRegistration(user: PermissionUser) {
  const role = normalizeRole(user.role);
  return isActiveUser(user) && ["ADMIN", "GESTOR", "RH", "WFM"].includes(role);
}

export function canEditEmployeeSensitiveData(user: PermissionUser, employee?: PermissionEmployee | null) {
  return canEditEmployeeData(user, employee) && canViewEmployeeSensitiveData(user, employee);
}

export function canAccessSettings(user: PermissionUser) {
  return isActiveUser(user) && normalizeRole(user.role) === "ADMIN";
}

export function canManageUsers(user: PermissionUser) {
  return canAccessSettings(user);
}

export function canManageRoles(user: PermissionUser) {
  return canAccessSettings(user);
}

export function canManagePermissions(user: PermissionUser) {
  return canAccessSettings(user);
}

export function canManageOperationalSettings(user: PermissionUser) {
  return canAccessSettings(user);
}

export function canImportSchedules(user: PermissionUser) {
  return canImportCronogramas(user);
}

export function canAddScheduleManually(user: PermissionUser) {
  return canCreateCronogramaManually(user);
}

export function canMarkPresent(user: PermissionUser) {
  return canUpdateScheduleSlot(user);
}

export function canApproveRequest(user: PermissionUser, request?: { area?: string | null; type?: string | null }) {
  const role = normalizeRole(user.role);
  if (!isActiveUser(user)) return false;
  if (["ADMIN", "GESTOR"].includes(role)) return true;
  if (role === "WFM") return request ? /(wfm|escala|folga|ponto|presença|presenca)/i.test(`${request.area} ${request.type}`) : true;
  if (role === "RH") return request ? /(rh|clima|cadastral|pessoas)/i.test(`${request.area} ${request.type}`) : true;
  if (role === "TI") return request ? /(ti|equipamento|notebook|acesso|suporte)/i.test(`${request.area} ${request.type}`) : true;
  if (role === "QUALIDADE") return request ? /(qualidade|feedback)/i.test(`${request.area} ${request.type}`) : true;
  if (role === "SUPERVISOR") {
    if (!request) return false;
    return /(folga|day\s*off|troca|turno|escala)/i.test(`${request.area ?? ""} ${request.type ?? ""}`);
  }
  return false;
}

export function canViewTeam(user: PermissionUser, employee?: PermissionEmployee) {
  const role = normalizeRole(user.role);
  if (!isActiveUser(user)) return false;
  if (["ADMIN", "GESTOR", "RH", "WFM"].includes(role)) return true;
  if (role === "COLABORADOR") return user.email && employee?.email === user.email;
  if (role === "SUPERVISOR") {
    return Boolean(
      (user.email && employee?.supervisorEmail === user.email) ||
        (user.name && employee?.supervisor === user.name)
    );
  }
  return false;
}

export function canViewShiftReport(user: PermissionUser, report?: { supervisor?: string | null; supervisorEmail?: string | null }) {
  const role = normalizeRole(user.role);
  if (!isActiveUser(user)) return false;
  if (["ADMIN", "GESTOR", "WFM"].includes(role)) return true;
  if (role === "SUPERVISOR") {
    return !report || report.supervisor === user.name || report.supervisorEmail === user.email;
  }
  return false;
}

export function canManageEquipment(user: PermissionUser) {
  const role = normalizeRole(user.role);
  return isActiveUser(user) && ["ADMIN", "GESTOR", "TI"].includes(role);
}

export function canAccessAuditLogs(user: PermissionUser) {
  const role = normalizeRole(user.role);
  return isActiveUser(user) && ["ADMIN", "GESTOR"].includes(role);
}

export function canViewSensitiveFile(user: PermissionUser, file: { category?: string; ownerUserEmail?: string | null; employeeSupervisor?: string | null }) {
  const role = normalizeRole(user.role);
  if (!isActiveUser(user)) return false;
  if (["ADMIN", "GESTOR"].includes(role)) return true;
  if (file.ownerUserEmail && file.ownerUserEmail === user.email) return true;
  if (role === "SUPERVISOR" && file.employeeSupervisor === user.name) return true;
  if (role === "RH") return ["employee-documents", "absence-evidence", "request-attachments"].includes(file.category ?? "");
  if (role === "WFM") return ["schedule-imports", "absence-evidence", "shift-report-attachments"].includes(file.category ?? "");
  if (role === "QUALIDADE") return file.category === "quality-materials";
  if (role === "TI") return ["equipment-evidence", "request-attachments"].includes(file.category ?? "");
  return false;
}

export function canManageAttendance(user: PermissionUser) {
  const role = normalizeRole(user.role);
  return isActiveUser(user) && ["ADMIN", "GESTOR", "WFM"].includes(role);
}

export function canJustifyAbsence(user: PermissionUser, employee?: PermissionEmployee) {
  const role = normalizeRole(user.role);
  if (!isActiveUser(user)) return false;
  if (["ADMIN", "GESTOR", "WFM"].includes(role)) return true;
  return role === "SUPERVISOR" && canViewTeam(user, employee);
}

export function maskCpf(value?: string | null) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length < 2) return "***.***.***-**";
  return `***.***.***-${digits.slice(-2)}`;
}

export function maskBankAccount(value?: string | null) {
  const text = String(value ?? "");
  const last = text.replace(/\D/g, "").slice(-1) || "*";
  return `****-${last}`;
}

export function maskPix(value?: string | null) {
  const text = String(value ?? "");
  if (text.length <= 4) return "****";
  return `${text.slice(0, 2)}***${text.slice(-2)}`;
}
