import type { AppRole } from "@/lib/demo-auth";
import { canAccessRealTime, normalizeRole, type PermissionUser } from "@/lib/permissions";

export type NavItem = {
  label: string;
  href: string;
  icon: string;
  roles: AppRole[];
};

export type NavSection = {
  label: string;
  items: NavItem[];
};

const nonClientRoles: AppRole[] = ["ADMIN", "GESTOR", "SUPERVISOR", "COLABORADOR", "WFM", "QUALIDADE", "RH", "TI", "COORDENADOR", "GERENTE"];
const performanceRoles: AppRole[] = [...nonClientRoles, "CLIENT"];
const muralRoles: AppRole[] = [...nonClientRoles, "CLIENT"];
const financeiroRoles: AppRole[] = [...nonClientRoles, "CLIENT"];
const centralRoles: AppRole[] = ["ADMIN", "GESTOR", "SUPERVISOR", "WFM", "QUALIDADE", "RH", "TI", "COORDENADOR", "GERENTE"];
const realTimeRoles: AppRole[] = ["ADMIN", "GESTOR", "SUPERVISOR", "WFM"];
const leadership: AppRole[] = ["ADMIN", "GESTOR", "SUPERVISOR", "WFM", "RH", "COORDENADOR", "GERENTE"];
const peopleOps: AppRole[] = ["ADMIN", "GESTOR", "RH", "WFM"];

export const navSections: NavSection[] = [
  {
    label: "Operação",
    items: [
      { label: "Central Operacional", href: "/central-operacional", icon: "LayoutDashboard", roles: centralRoles },
      { label: "Real Time", href: "/real-time", icon: "MonitorCog", roles: realTimeRoles },
      { label: "Requerido", href: "/staff-cobertura", icon: "UsersRound", roles: ["ADMIN", "GESTOR", "SUPERVISOR", "WFM", "CLIENT"] },
      { label: "Performance", href: "/performance", icon: "Trophy", roles: performanceRoles }
    ]
  },
  {
    label: "Pessoas",
    items: [
      { label: "Meu Perfil", href: "/meu-perfil", icon: "UserCircle", roles: nonClientRoles },
      { label: "Meu Cronograma", href: "/minha-escala", icon: "CalendarDays", roles: nonClientRoles },
      { label: "Cadastros", href: "/cadastros", icon: "UserPlus", roles: peopleOps },
      { label: "Cronogramas", href: "/escalas", icon: "CalendarRange", roles: ["ADMIN", "GESTOR", "SUPERVISOR", "WFM", "RH"] },
      { label: "Mapa de Funcionários", href: "/mapa-funcionarios", icon: "Map", roles: leadership }
    ]
  },
  {
    label: "Rotina",
    items: [
      { label: "Horas Operacionais", href: "/horas-operacionais", icon: "Clock", roles: ["ADMIN", "GESTOR", "SUPERVISOR", "WFM"] },
      { label: "Esteiras", href: "/esteiras", icon: "KanbanSquare", roles: ["ADMIN", "GESTOR", "SUPERVISOR", "WFM", "RH", "TI", "QUALIDADE"] },
      { label: "Mural", href: "/mural", icon: "Megaphone", roles: muralRoles },
      { label: "Feedback Anônimo", href: "/feedback-anonimo", icon: "MessageCircleQuestion", roles: nonClientRoles }
    ]
  },
  {
    label: "Financeiro",
    items: [
      { label: "Adiantamento", href: "/adiantamento", icon: "Coins", roles: ["ADMIN", "GESTOR", "WFM"] },
      { label: "Billing", href: "/billing", icon: "Coins", roles: ["ADMIN", "SUPERVISOR"] },
      { label: "Financeiro", href: "/financeiro", icon: "FileBarChart", roles: financeiroRoles }
    ]
  },
  {
    label: "Suporte",
    items: [
      { label: "Equipamentos e Logística", href: "/equipamentos", icon: "MonitorCog", roles: ["ADMIN", "GESTOR", "TI"] },
      { label: "Configurações", href: "/configuracoes", icon: "Settings", roles: ["ADMIN"] }
    ]
  }
];

export const navItems: NavItem[] = navSections.flatMap((section) => section.items);

export function getNavItems(userOrRole?: string | PermissionUser) {
  const user = typeof userOrRole === "string" ? { role: userOrRole } : userOrRole;
  const normalizedRole = normalizeRole(user?.role);
  return navItems.filter((item) => item.roles.includes(normalizedRole) || (item.href === "/real-time" && canAccessRealTime({ ...user, status: user?.status ?? "ACTIVE" })));
}

export function getNavSections(userOrRole?: string | PermissionUser) {
  const visibleItems = getNavItems(userOrRole);
  const visibleHrefs = new Set(visibleItems.map((item) => item.href));
  return navSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => visibleHrefs.has(item.href))
    }))
    .filter((section) => section.items.length > 0);
}

export function getDefaultPathForRole(role?: string) {
  const normalizedRole = normalizeRole(role);
  if (normalizedRole === "CLIENT") return "/performance";
  return normalizedRole === "COLABORADOR" ? "/meu-perfil" : "/central-operacional";
}

export function canAccessPathForRole(pathname: string, userOrRole?: string | PermissionUser) {
  const user = typeof userOrRole === "string" ? { role: userOrRole } : userOrRole;
  const normalizedRole = normalizeRole(user?.role);
  if (normalizedRole === "CLIENT") {
    if (pathname === "/" || pathname === "/alterar-senha") return true;
    if (pathname === "/performance" || pathname.startsWith("/performance/")) return true;
    if (pathname === "/api/performance" || pathname.startsWith("/api/performance/")) return true;
    if (pathname === "/staff-cobertura" || pathname.startsWith("/staff-cobertura/")) return true;
    if (pathname === "/api/staff-coverage" || pathname.startsWith("/api/staff-coverage/")) return true;
    if (pathname === "/mural" || pathname.startsWith("/mural/")) return true;
    if (pathname === "/api/mural" || pathname.startsWith("/api/mural/")) return true;
    if (pathname === "/financeiro" || pathname.startsWith("/financeiro/")) return true;
    if (pathname === "/api/financeiro" || pathname.startsWith("/api/financeiro/")) return true;
    return false;
  }
  if (pathname === "/meu-perfil" || pathname.startsWith("/perfil/")) return nonClientRoles.includes(normalizedRole);
  if (pathname === "/real-time" || pathname.startsWith("/real-time/")) return canAccessRealTime({ ...user, status: user?.status ?? "ACTIVE" });
  const protectedItem = navItems.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
  return protectedItem ? protectedItem.roles.includes(normalizedRole) : true;
}
