import type { AppRole } from "@/lib/demo-auth";

export type NavItem = {
  label: string;
  href: string;
  icon: string;
  roles: AppRole[];
};

const allRoles: AppRole[] = ["ADMIN", "GESTOR", "SUPERVISOR", "COLABORADOR", "WFM", "QUALIDADE", "RH", "TI"];
const leadership: AppRole[] = ["ADMIN", "GESTOR", "SUPERVISOR", "WFM"];
const adminOps: AppRole[] = ["ADMIN", "GESTOR"];
const peopleOps: AppRole[] = ["ADMIN", "GESTOR", "RH", "WFM"];
const authenticatedOps: AppRole[] = ["ADMIN", "GESTOR", "WFM", "QUALIDADE", "RH", "TI"];

export const navItems: NavItem[] = [
  { label: "Central Operacional", href: "/central-operacional", icon: "LayoutDashboard", roles: ["ADMIN", "GESTOR", "SUPERVISOR", "WFM", "QUALIDADE", "RH", "TI"] },
  { label: "Minha Escala", href: "/minha-escala", icon: "CalendarDays", roles: allRoles },
  { label: "Cadastros", href: "/cadastros", icon: "UserPlus", roles: peopleOps },
  { label: "Escalas", href: "/escalas", icon: "CalendarRange", roles: ["ADMIN", "GESTOR", "SUPERVISOR", "WFM"] },
  { label: "Horas Operacionais", href: "/horas-operacionais", icon: "Clock", roles: ["ADMIN", "GESTOR", "SUPERVISOR", "WFM"] },
  { label: "Solicitações", href: "/solicitacoes", icon: "ClipboardList", roles: authenticatedOps },
  { label: "Esteiras", href: "/esteiras", icon: "KanbanSquare", roles: ["ADMIN", "GESTOR", "SUPERVISOR", "WFM", "RH", "TI", "QUALIDADE"] },
  { label: "Report de Turno", href: "/report-turno", icon: "ClipboardCheck", roles: ["ADMIN", "GESTOR", "SUPERVISOR", "WFM"] },
  { label: "Performance", href: "/performance", icon: "Trophy", roles: authenticatedOps },
  { label: "Comunicação / Mural", href: "/mural", icon: "Megaphone", roles: authenticatedOps },
  { label: "Qualidade e Feedback", href: "/qualidade", icon: "ShieldCheck", roles: ["ADMIN", "GESTOR", "QUALIDADE"] },
  { label: "Mapa de Funcionários", href: "/mapa-funcionarios", icon: "Map", roles: leadership },
  { label: "Staff e Cobertura", href: "/staff-cobertura", icon: "UsersRound", roles: ["ADMIN", "GESTOR", "WFM"] },
  { label: "Equipamentos e Logística", href: "/equipamentos", icon: "MonitorCog", roles: ["ADMIN", "GESTOR", "TI"] },
  { label: "Pesquisa de Clima", href: "/clima", icon: "HeartPulse", roles: ["ADMIN", "GESTOR", "RH"] },
  { label: "Feedback Anônimo", href: "/feedback-anonimo", icon: "MessageCircleQuestion", roles: authenticatedOps },
  { label: "Tokens e Recompensas", href: "/tokens", icon: "Coins", roles: authenticatedOps },
  { label: "Chat", href: "/chat", icon: "MessagesSquare", roles: authenticatedOps },
  { label: "Relatórios", href: "/relatorios", icon: "FileBarChart", roles: ["ADMIN", "GESTOR", "WFM", "QUALIDADE", "RH", "TI"] },
  { label: "Auditoria", href: "/auditoria", icon: "ScrollText", roles: adminOps },
  { label: "Uso da Plataforma", href: "/uso-plataforma", icon: "FileBarChart", roles: adminOps },
  { label: "Configurações", href: "/configuracoes", icon: "Settings", roles: ["ADMIN"] }
];

export function getNavItems(role?: string) {
  const normalizedRole = (role ?? "COLABORADOR") as AppRole;
  return navItems.filter((item) => item.roles.includes(normalizedRole));
}

export function getDefaultPathForRole(role?: string) {
  return role === "COLABORADOR" ? "/minha-escala" : "/central-operacional";
}
