import type { AppRole } from "@/lib/demo-auth";

export type NavItem = {
  label: string;
  href: string;
  icon: string;
  roles: AppRole[];
};

const allRoles: AppRole[] = ["ADMIN", "GESTOR", "SUPERVISOR", "COLABORADOR", "WFM", "QUALIDADE", "RH", "TI"];
const leadership: AppRole[] = ["ADMIN", "GESTOR", "SUPERVISOR", "WFM"];
const peopleOps: AppRole[] = ["ADMIN", "GESTOR", "RH", "WFM"];
const authenticatedOps: AppRole[] = ["ADMIN", "GESTOR", "SUPERVISOR", "WFM", "QUALIDADE", "RH", "TI"];

export const navItems: NavItem[] = [
  { label: "Central Operacional", href: "/central-operacional", icon: "LayoutDashboard", roles: ["ADMIN", "GESTOR", "SUPERVISOR", "WFM", "QUALIDADE", "RH", "TI"] },
  { label: "Meu Cronograma", href: "/minha-escala", icon: "CalendarDays", roles: allRoles },
  { label: "Cadastros", href: "/cadastros", icon: "UserPlus", roles: peopleOps },
  { label: "Cronogramas", href: "/escalas", icon: "CalendarRange", roles: ["ADMIN", "GESTOR", "SUPERVISOR", "WFM", "RH"] },
  { label: "Horas Operacionais", href: "/horas-operacionais", icon: "Clock", roles: ["ADMIN", "GESTOR", "SUPERVISOR", "WFM"] },
  { label: "Solicitações", href: "/solicitacoes", icon: "ClipboardList", roles: authenticatedOps },
  { label: "Esteiras", href: "/esteiras", icon: "KanbanSquare", roles: ["ADMIN", "GESTOR", "SUPERVISOR", "WFM", "RH", "TI", "QUALIDADE"] },
  { label: "Report de Turno", href: "/report-turno", icon: "ClipboardCheck", roles: ["ADMIN", "GESTOR", "SUPERVISOR", "WFM"] },
  { label: "Performance", href: "/performance", icon: "Trophy", roles: ["ADMIN"] },
  { label: "Comunicação / Mural", href: "/mural", icon: "Megaphone", roles: ["ADMIN"] },
  { label: "Qualidade e Feedback", href: "/qualidade", icon: "ShieldCheck", roles: ["ADMIN"] },
  { label: "Mapa de Funcionários", href: "/mapa-funcionarios", icon: "Map", roles: leadership },
  { label: "Staff e Cobertura", href: "/staff-cobertura", icon: "UsersRound", roles: ["ADMIN"] },
  { label: "Equipamentos e Logística", href: "/equipamentos", icon: "MonitorCog", roles: ["ADMIN", "GESTOR", "TI"] },
  { label: "Pesquisa de Clima", href: "/clima", icon: "HeartPulse", roles: ["ADMIN"] },
  { label: "Feedback Anônimo", href: "/feedback-anonimo", icon: "MessageCircleQuestion", roles: ["ADMIN"] },
  { label: "Tokens e Recompensas", href: "/tokens", icon: "Coins", roles: ["ADMIN"] },
  { label: "Configurações", href: "/configuracoes", icon: "Settings", roles: ["ADMIN"] }
];

export function getNavItems(role?: string) {
  const normalizedRole = (role ?? "COLABORADOR") as AppRole;
  return navItems.filter((item) => item.roles.includes(normalizedRole));
}

export function getDefaultPathForRole(role?: string) {
  return role === "COLABORADOR" ? "/minha-escala" : "/central-operacional";
}
