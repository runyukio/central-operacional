import type { AppRole } from "@/lib/demo-auth";
import { normalizeRole } from "@/lib/permissions";

export type NavItem = {
  label: string;
  href: string;
  icon: string;
  roles: AppRole[];
};

const allRoles: AppRole[] = ["ADMIN", "GESTOR", "SUPERVISOR", "COLABORADOR", "WFM", "QUALIDADE", "RH", "TI"];
const leadership: AppRole[] = ["ADMIN", "GESTOR", "SUPERVISOR", "WFM", "RH"];
const peopleOps: AppRole[] = ["ADMIN", "GESTOR", "RH", "WFM"];
const authenticatedOps: AppRole[] = ["ADMIN", "GESTOR", "SUPERVISOR", "WFM", "QUALIDADE", "RH", "TI"];

export const navItems: NavItem[] = [
  { label: "Central Operacional", href: "/central-operacional", icon: "LayoutDashboard", roles: ["ADMIN", "GESTOR", "SUPERVISOR", "WFM", "QUALIDADE", "RH", "TI"] },
  { label: "Meu Cronograma", href: "/minha-escala", icon: "CalendarDays", roles: allRoles },
  { label: "Cadastros", href: "/cadastros", icon: "UserPlus", roles: peopleOps },
  { label: "Cronogramas", href: "/escalas", icon: "CalendarRange", roles: ["ADMIN", "GESTOR", "SUPERVISOR", "WFM", "RH"] },
  { label: "Horas Operacionais", href: "/horas-operacionais", icon: "Clock", roles: ["ADMIN", "GESTOR", "SUPERVISOR", "WFM"] },
  { label: "Staff e Cobertura", href: "/staff-cobertura", icon: "UsersRound", roles: ["ADMIN", "GESTOR", "SUPERVISOR", "WFM"] },
  { label: "Solicitações", href: "/solicitacoes", icon: "ClipboardList", roles: authenticatedOps },
  { label: "Esteiras", href: "/esteiras", icon: "KanbanSquare", roles: ["ADMIN", "GESTOR", "SUPERVISOR", "WFM", "RH", "TI", "QUALIDADE"] },
  { label: "Mapa de Funcionários", href: "/mapa-funcionarios", icon: "Map", roles: leadership },
  { label: "Adiantamento", href: "/adiantamento", icon: "Coins", roles: ["ADMIN", "GESTOR", "WFM"] },
  { label: "Equipamentos e Logística", href: "/equipamentos", icon: "MonitorCog", roles: ["ADMIN", "GESTOR", "TI"] },
  { label: "Feedback Anônimo", href: "/feedback-anonimo", icon: "MessageCircleQuestion", roles: allRoles },
  { label: "Configurações", href: "/configuracoes", icon: "Settings", roles: ["ADMIN"] }
];

export function getNavItems(role?: string) {
  const normalizedRole = normalizeRole(role);
  return navItems.filter((item) => item.roles.includes(normalizedRole));
}

export function getDefaultPathForRole(role?: string) {
  return normalizeRole(role) === "COLABORADOR" ? "/minha-escala" : "/central-operacional";
}
