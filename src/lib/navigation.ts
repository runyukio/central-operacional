import type { AppRole } from "@/lib/demo-auth";
import { rolesWithCapability } from "@/lib/access-control";
import {
  canAccessPerformance,
  canAccessCampaignAgent,
  canManageCampaignStaff,
  canAccessRealTimeQueues,
  canAccessStaffCoverage,
  normalizeRole,
  type PermissionUser
} from "@/lib/permissions";
import { canAccessOwnRealtimeHours, canAccessRealtimeHoursCapture } from "@/lib/realtime-hours-permissions";

export type NavItem = {
  label: string;
  href: string;
  icon: string;
  roles: AppRole[];
};

const campaignRoles = Array.from(new Set([
  ...rolesWithCapability("CAMPAIGN_AGENT"),
  ...rolesWithCapability("CAMPAIGN_STAFF")
]));

export type NavSection = {
  label: string;
  items: NavItem[];
};

const personalRoles = rolesWithCapability("PERSONAL");
const shiftReportRoles = Array.from(new Set([
  ...rolesWithCapability("SHIFT_REPORT_SUBMIT"),
  ...rolesWithCapability("SHIFT_REPORT_VIEW")
]));

export const navSections: NavSection[] = [
  {
    label: "Operação",
    items: [
      { label: "Central Operacional", href: "/central-operacional", icon: "LayoutDashboard", roles: rolesWithCapability("CENTRAL") },
      { label: "Real Time", href: "/real-time", icon: "MonitorCog", roles: rolesWithCapability("REALTIME_QUEUES") },
      { label: "Captura de Horas", href: "/captura-horas", icon: "Clock", roles: rolesWithCapability("CAPTURE") },
      { label: "Necessidade", href: "/staff-cobertura", icon: "UsersRound", roles: rolesWithCapability("STAFF_COVERAGE") },
      { label: "Performance", href: "/performance", icon: "Trophy", roles: rolesWithCapability("PERFORMANCE") }
    ]
  },
  {
    label: "Campanha",
    items: [
      { label: "Rifa", href: "/campanha", icon: "Gift", roles: campaignRoles }
    ]
  },
  {
    label: "Pessoas",
    items: [
      { label: "Meu Perfil", href: "/meu-perfil", icon: "UserCircle", roles: personalRoles },
      { label: "Meu Cronograma", href: "/minha-escala", icon: "CalendarDays", roles: personalRoles },
      { label: "Cadastros", href: "/cadastros", icon: "UserPlus", roles: rolesWithCapability("EMPLOYEE_EDIT") },
      { label: "Cronogramas", href: "/escalas", icon: "CalendarRange", roles: rolesWithCapability("SCHEDULE_VIEW") },
      { label: "Mapa de Parceiros", href: "/mapa-funcionarios", icon: "Map", roles: rolesWithCapability("EMPLOYEE_MAP") }
    ]
  },
  {
    label: "Rotina",
    items: [
      { label: "Minhas Horas", href: "/minhas-horas", icon: "Clock", roles: personalRoles },
      { label: "Horas Operacionais", href: "/horas-operacionais", icon: "Clock", roles: rolesWithCapability("WORK_HOURS_VIEW") },
      { label: "Report de Turno", href: "/report-turno", icon: "ClipboardCheck", roles: shiftReportRoles },
      { label: "Esteiras", href: "/esteiras", icon: "KanbanSquare", roles: rolesWithCapability("PIPELINES") },
      { label: "Mural", href: "/mural", icon: "Megaphone", roles: personalRoles },
      { label: "Feedback Anônimo", href: "/feedback-anonimo", icon: "MessageCircleQuestion", roles: rolesWithCapability("FEEDBACK_SUBMIT") }
    ]
  },
  {
    label: "Financeiro",
    items: [
      { label: "Adiantamento", href: "/adiantamento", icon: "Coins", roles: rolesWithCapability("ADVANCE_VIEW") },
      { label: "Billing", href: "/billing", icon: "Coins", roles: rolesWithCapability("BILLING_VIEW") },
      { label: "Financeiro", href: "/financeiro", icon: "FileBarChart", roles: rolesWithCapability("FINANCE_VIEW") }
    ]
  },
  {
    label: "Suporte",
    items: [
      { label: "Equipamentos e Logística", href: "/equipamentos", icon: "MonitorCog", roles: rolesWithCapability("EQUIPMENT_VIEW") },
      { label: "Configurações", href: "/configuracoes", icon: "Settings", roles: rolesWithCapability("SETTINGS") }
    ]
  }
];

export const navItems: NavItem[] = navSections.flatMap((section) => section.items);

export function getNavItems(userOrRole?: string | PermissionUser) {
  const user = typeof userOrRole === "string" ? { role: userOrRole } : userOrRole;
  const normalizedRole = normalizeRole(user?.role);
  const permissionUser = { ...user, status: user?.status ?? "ACTIVE" };
  return navItems.filter((item) => {
    if (item.href === "/captura-horas") return canAccessRealtimeHoursCapture(permissionUser);
    if (item.href === "/real-time") return canAccessRealTimeQueues(permissionUser);
    if (item.href === "/staff-cobertura") return canAccessStaffCoverage(permissionUser);
    if (item.href === "/performance") return canAccessPerformance(permissionUser);
    if (item.href === "/campanha") return canAccessCampaignAgent(permissionUser) || canManageCampaignStaff(permissionUser);
    if (item.href === "/campanha/agente") return canAccessCampaignAgent(permissionUser);
    if (item.href === "/campanha/staff") return canManageCampaignStaff(permissionUser);
    if (item.href === "/minhas-horas") return canAccessOwnRealtimeHours(permissionUser);
    return item.roles.includes(normalizedRole);
  });
}

export function getNavSections(userOrRole?: string | PermissionUser) {
  const visibleItems = getNavItems(userOrRole);
  const visibleHrefs = new Set(visibleItems.map((item) => item.href));
  return navSections
    .map((section) => ({ ...section, items: section.items.filter((item) => visibleHrefs.has(item.href)) }))
    .filter((section) => section.items.length > 0);
}

export function getDefaultPathForRole(role?: string) {
  return getNavItems({ role, status: "ACTIVE" })[0]?.href ?? "/meu-perfil";
}

export function canAccessPathForRole(pathname: string, userOrRole?: string | PermissionUser) {
  const user = typeof userOrRole === "string" ? { role: userOrRole } : userOrRole;
  const normalizedRole = normalizeRole(user?.role);
  const permissionUser = { ...user, status: user?.status ?? "ACTIVE" };

  if (pathname === "/" || pathname === "/alterar-senha") return true;

  if (normalizedRole === "CLIENT") {
    if (pathname === "/staff-cobertura" || pathname.startsWith("/staff-cobertura/") || pathname === "/api/staff-coverage" || pathname.startsWith("/api/staff-coverage/")) return canAccessStaffCoverage(permissionUser);
    if (pathname === "/real-time" || pathname.startsWith("/real-time/") || pathname === "/api/realtime" || pathname.startsWith("/api/realtime/")) return canAccessRealTimeQueues(permissionUser);
    if (pathname === "/performance" || pathname.startsWith("/performance/") || pathname === "/api/performance" || pathname.startsWith("/api/performance/")) return canAccessPerformance(permissionUser);
    return false;
  }

  if (pathname === "/performance" || pathname.startsWith("/performance/") || pathname === "/api/performance" || pathname.startsWith("/api/performance/")) return canAccessPerformance(permissionUser);
  if (pathname === "/campanha/agente" || pathname.startsWith("/campanha/agente/")) return canAccessCampaignAgent(permissionUser);
  if (pathname === "/campanha/staff" || pathname.startsWith("/campanha/staff/")) return canManageCampaignStaff(permissionUser);
  if (pathname === "/campanha" || pathname.startsWith("/api/campaigns/raffle")) return canAccessCampaignAgent(permissionUser) || canManageCampaignStaff(permissionUser);
  if (pathname === "/staff-cobertura" || pathname.startsWith("/staff-cobertura/") || pathname === "/api/staff-coverage" || pathname.startsWith("/api/staff-coverage/")) return canAccessStaffCoverage(permissionUser);
  if (pathname === "/meu-perfil" || pathname.startsWith("/perfil/")) return personalRoles.includes(normalizedRole);
  if (pathname === "/minhas-horas" || pathname.startsWith("/minhas-horas/") || pathname === "/api/realtime-hours/me" || pathname.startsWith("/api/realtime-hours/me/")) return canAccessOwnRealtimeHours(permissionUser);
  if (pathname === "/real-time" || pathname.startsWith("/real-time/") || pathname === "/api/realtime" || pathname.startsWith("/api/realtime/")) return canAccessRealTimeQueues(permissionUser);
  if (pathname === "/captura-horas" || pathname.startsWith("/captura-horas/")) return canAccessRealtimeHoursCapture(permissionUser);

  const protectedItem = navItems.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
  return protectedItem ? protectedItem.roles.includes(normalizedRole) : true;
}
