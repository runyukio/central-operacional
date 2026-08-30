import type { AppRole } from "@/lib/demo-auth";
import { normalizeAccessRole, roleHasCapability } from "@/lib/access-control";
import { isAgentJobTitle, normalizeComparableJobTitle } from "@/lib/job-title-normalization";

export type PermissionUser = {
  role?: string | null;
  email?: string | null;
  name?: string | null;
  status?: string | null;
  roleTitle?: string | null;
  jobTitle?: string | null;
  skill?: string | null;
  lob?: string | null;
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

const workflowManagedScheduleStatusKeys = new Set([
  "troca aprovada",
  "venda de folga aprovada",
  "venda folga aprovada",
  "folga aprovada"
]);

export function normalizeRole(role?: string | null): AppRole {
  return normalizeAccessRole(role);
}

export function isActiveUser(user: PermissionUser) {
  return !user.status || user.status === "ACTIVE" || user.status === "Ativo";
}

export function isAgentEmployee(employee?: PermissionEmployee | null) {
  return isAgentJobTitle(employee?.roleTitle ?? employee?.role);
}

export function isAgentOrClientUser(user: PermissionUser) {
  const role = normalizeRole(user.role);
  return role === "CLIENT" || role === "COLABORADOR";
}

export function canAccessNonAgentClientModules(user: PermissionUser) {
  return isActiveUser(user) && !isAgentOrClientUser(user);
}

export function canAccessExecutiveAdsReport(user: PermissionUser) {
  return isActiveUser(user) && roleHasCapability(user.role, "REALTIME_FULL");
}

export function canViewEmployeeDetails(user: PermissionUser, employee?: PermissionEmployee | null) {
  if (!isActiveUser(user)) return false;
  if (roleHasCapability(user.role, "EMPLOYEE_MAP")) return true;
  return Boolean(roleHasCapability(user.role, "PERSONAL") && user.email && employee?.email === user.email);
}

export function canViewEmployeeSensitiveData(user: PermissionUser, employee?: PermissionEmployee | null) {
  void employee;
  return isActiveUser(user) && roleHasCapability(user.role, "EMPLOYEE_SENSITIVE");
}

export function canViewEmployeeProfileBillingPreview(input: {
  viewer: PermissionUser;
  target: PermissionEmployee;
  viewerEmployeeId?: string | null;
  targetEmployeeId?: string | null;
}) {
  if (!isActiveUser(input.viewer)) return false;
  if (input.viewerEmployeeId && input.targetEmployeeId && input.viewerEmployeeId === input.targetEmployeeId) return true;
  const targetSystemRole = input.target.role ? normalizeRole(input.target.role) : null;
  return (
    normalizeRole(input.viewer.role) === "SUPERVISOR"
    && isAgentEmployee(input.target)
    && (!targetSystemRole || targetSystemRole === "COLABORADOR")
  );
}

export function canEditEmployeeData(user: PermissionUser, employee?: PermissionEmployee | null) {
  void employee;
  return isActiveUser(user) && roleHasCapability(user.role, "EMPLOYEE_EDIT");
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
  return isActiveUser(user) && roleHasCapability(user.role, "EMPLOYEE_MAP");
}

export function canAccessAdvanceModule(user: PermissionUser) {
  return isActiveUser(user) && roleHasCapability(user.role, "ADVANCE_VIEW");
}

export function canAccessStaffCoverage(user: PermissionUser) {
  return isActiveUser(user) && roleHasCapability(user.role, "STAFF_COVERAGE");
}

export function canAccessAdsStaffCoverage(user: PermissionUser) {
  return isActiveUser(user) && roleHasCapability(user.role, "STAFF_COVERAGE_ADS");
}

export function canAccessRealTime(user: PermissionUser) {
  return isActiveUser(user) && roleHasCapability(user.role, "REALTIME_FULL");
}

export function canAccessRealTimeQueues(user: PermissionUser) {
  return isActiveUser(user) && roleHasCapability(user.role, "REALTIME_QUEUES");
}

export function canAccessRealTimeAgentsReports(user: PermissionUser) {
  return canAccessRealTime(user);
}

// Operational classification remains available for business rules, never for authorization.
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
  return isActiveUser(user) && roleHasCapability(user.role, "CAPTURE");
}

export function canExportWorkSessionMonitoring(user: PermissionUser) {
  return canAccessWorkSessionMonitoring(user);
}

export function canAccessPerformance(user: PermissionUser) {
  return isActiveUser(user) && roleHasCapability(user.role, "PERFORMANCE");
}

export function canAccessCampaignAgent(user: PermissionUser) {
  return (
    isActiveUser(user)
    && roleHasCapability(user.role, "CAMPAIGN_AGENT")
    && normalizeComparableJobTitle(user.lob) === "ads"
    && isAgentJobTitle(user.roleTitle ?? user.jobTitle)
  );
}

export function canManageCampaignStaff(user: PermissionUser) {
  return isActiveUser(user) && roleHasCapability(user.role, "CAMPAIGN_STAFF");
}

export function canAccessCampaign(user: PermissionUser) {
  return canAccessCampaignAgent(user) || canManageCampaignStaff(user);
}

export function canAccessPerformanceWfh(user: PermissionUser) {
  return canAccessPerformance(user);
}

export function canAccessPerformanceFramework(user: PermissionUser) {
  return canAccessPerformance(user);
}

export function canImportPerformance(user: PermissionUser) {
  const role = normalizeRole(user.role);
  return isActiveUser(user) && (role === "ADMIN" || role === "WFM");
}

export function canExportPerformance(user: PermissionUser) {
  return canAccessPerformance(user);
}

export function canManageStaffCoverageRequirements(user: PermissionUser) {
  return isActiveUser(user) && roleHasCapability(user.role, "STAFF_COVERAGE_MANAGE");
}

export function canAutoUpdateAdsRequirement(user: PermissionUser) {
  const role = normalizeRole(user.role);
  return isActiveUser(user) && (role === "ADMIN" || role === "WFM");
}

export function canExportStaffCoverage(user: PermissionUser) {
  return canAccessStaffCoverage(user);
}

export function canAccessAnonymousFeedback(user: PermissionUser) {
  return canViewAnonymousFeedbackAdmin(user) || canSubmitAnonymousFeedback(user);
}

export function canSubmitAnonymousFeedback(user: PermissionUser) {
  return isActiveUser(user) && Boolean(user.email) && roleHasCapability(user.role, "FEEDBACK_SUBMIT");
}

export function canViewAnonymousFeedbackAdmin(user: PermissionUser) {
  return isActiveUser(user) && roleHasCapability(user.role, "FEEDBACK_MANAGE");
}

export function canManageAnonymousFeedback(user: PermissionUser) {
  return canViewAnonymousFeedbackAdmin(user);
}

export function canExportAnonymousFeedback(user: PermissionUser) {
  return canViewAnonymousFeedbackAdmin(user);
}

export function canAccessHierarchy(user: PermissionUser) {
  return isActiveUser(user) && roleHasCapability(user.role, "HIERARCHY_VIEW");
}

export function canManageHierarchy(user: PermissionUser) {
  return isActiveUser(user) && roleHasCapability(user.role, "HIERARCHY_MANAGE");
}

export function canEditAdvanceRecords(user: PermissionUser) {
  return isActiveUser(user) && roleHasCapability(user.role, "ADVANCE_MANAGE");
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
  return isActiveUser(user) && roleHasCapability(user.role, "SCHEDULE_EDIT");
}

export function canViewSchedules(user: PermissionUser) {
  return isActiveUser(user) && roleHasCapability(user.role, "SCHEDULE_VIEW");
}

export function canImportWorkHours(user: PermissionUser) {
  return canEditWorkHours(user);
}

export function canEditWorkHours(user: PermissionUser) {
  return isActiveUser(user) && roleHasCapability(user.role, "WORK_HOURS_EDIT");
}

export function canViewWorkHours(user: PermissionUser) {
  return isActiveUser(user) && roleHasCapability(user.role, "WORK_HOURS_VIEW");
}

export function canApproveWorkHourAdjustment(user: PermissionUser) {
  return canEditWorkHours(user);
}

export function canRequestWorkHourAdjustment(user: PermissionUser) {
  return isActiveUser(user) && roleHasCapability(user.role, "WORK_HOURS_REQUEST");
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

export function canAdminOverrideWorkflowScheduleStatus(user: PermissionUser, status?: string | null) {
  if (!isActiveUser(user) || normalizeRole(user.role) !== "ADMIN") return false;
  const normalizedStatus = String(status ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
  return workflowManagedScheduleStatusKeys.has(normalizedStatus);
}

export function canApproveRegistration(user: PermissionUser) {
  return isActiveUser(user) && roleHasCapability(user.role, "REGISTRATION_APPROVE");
}

export function canEditEmployeeSensitiveData(user: PermissionUser, employee?: PermissionEmployee | null) {
  return canEditEmployeeData(user, employee) && canViewEmployeeSensitiveData(user, employee);
}

export function canAccessSettings(user: PermissionUser) {
  return isActiveUser(user) && roleHasCapability(user.role, "SETTINGS");
}

export function canManageUsers(user: PermissionUser) {
  return isActiveUser(user) && roleHasCapability(user.role, "USERS_MANAGE");
}

export function canManageRoles(user: PermissionUser) {
  return isActiveUser(user) && roleHasCapability(user.role, "EMPLOYEE_ROLE_EDIT");
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
  if (!roleHasCapability(user.role, "PIPELINES")) return false;
  if (["ADMIN", "GESTOR"].includes(role)) return true;
  if (role === "WFM") return request ? /(wfm|escala|folga|ponto|presença|presenca)/i.test(`${request.area} ${request.type}`) : true;
  if (["RH", "FINANCEIRO"].includes(role)) {
    return request ? /(rh|clima|cadastral|pessoas)/i.test(`${request.area} ${request.type}`) : true;
  }
  if (role === "TI") return request ? /(ti|equipamento|notebook|acesso|suporte)/i.test(`${request.area} ${request.type}`) : true;
  if (role === "QUALIDADE") return request ? /(qualidade|feedback)/i.test(`${request.area} ${request.type}`) : true;
  if (role === "SUPERVISOR") {
    if (!request) return false;
    return /(folga|day\s*off|troca|turno|escala)/i.test(`${request.area ?? ""} ${request.type ?? ""}`);
  }
  return false;
}

export function canViewTeam(user: PermissionUser, employee?: PermissionEmployee) {
  if (!isActiveUser(user)) return false;
  if (normalizeRole(user.role) === "COLABORADOR") return Boolean(user.email && employee?.email === user.email);
  return roleHasCapability(user.role, "CENTRAL") ||
    roleHasCapability(user.role, "REALTIME_FULL") ||
    roleHasCapability(user.role, "SCHEDULE_VIEW") ||
    roleHasCapability(user.role, "EMPLOYEE_MAP");
}

export function canViewShiftReport(user: PermissionUser, report?: { supervisor?: string | null; supervisorEmail?: string | null }) {
  void report;
  return isActiveUser(user) && roleHasCapability(user.role, "SCHEDULE_VIEW");
}

export function canManageEquipment(user: PermissionUser) {
  return isActiveUser(user) && roleHasCapability(user.role, "EQUIPMENT_MANAGE");
}

export function canAccessEquipment(user: PermissionUser) {
  return isActiveUser(user) && roleHasCapability(user.role, "EQUIPMENT_VIEW");
}

export function canAccessAuditLogs(user: PermissionUser) {
  return isActiveUser(user) && roleHasCapability(user.role, "AUDIT_LOGS");
}

export function canViewSensitiveFile(user: PermissionUser, file: { category?: string; ownerUserEmail?: string | null; employeeSupervisor?: string | null }) {
  if (!isActiveUser(user)) return false;
  if (file.ownerUserEmail && file.ownerUserEmail === user.email) return true;
  if (roleHasCapability(user.role, "EMPLOYEE_SENSITIVE")) return true;
  const role = normalizeRole(user.role);
  if (role === "SUPERVISOR") return ["absence-evidence", "request-attachments", "shift-report-attachments"].includes(file.category ?? "");
  if (role === "QUALIDADE") return file.category === "quality-materials";
  if (role === "TI") return ["equipment-evidence", "request-attachments"].includes(file.category ?? "");
  return false;
}

export function canManageAttendance(user: PermissionUser) {
  return isActiveUser(user) && roleHasCapability(user.role, "ATTENDANCE_MANAGE");
}

export function canJustifyAbsence(user: PermissionUser, employee?: PermissionEmployee) {
  void employee;
  return isActiveUser(user) && roleHasCapability(user.role, "ATTENDANCE_JUSTIFY");
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
