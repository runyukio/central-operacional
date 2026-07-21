export type AppRole =
  | "ADMIN"
  | "GESTOR"
  | "SUPERVISOR"
  | "COLABORADOR"
  | "WFM"
  | "QUALIDADE"
  | "RH"
  | "FINANCEIRO"
  | "TI"
  | "RTA"
  | "POC"
  | "COORDENADOR"
  | "GERENTE"
  | "CLIENT"
  | "GLOBAL";

export const demoUsers = [
  { email: "admin@central.com", name: "Admin Central", role: "ADMIN", label: "Administrador" },
  { email: "gestor@central.com", name: "Marina Gestão", role: "GESTOR", label: "Gestão" },
  { email: "supervisor@central.com", name: "Carla Supervisora", role: "SUPERVISOR", label: "Supervisor" },
  { email: "colaborador@central.com", name: "João Silva", role: "COLABORADOR", label: "Atendimento" },
  { email: "wfm@central.com", name: "WFM Operações", role: "WFM", label: "Gestor" },
  { email: "qualidade@central.com", name: "Ana Qualidade", role: "QUALIDADE", label: "Qualidade" },
  { email: "rh@central.com", name: "Beatriz RH", role: "RH", label: "Recursos Humanos" },
  { email: "financeiro@central.com", name: "Fernanda Financeiro", role: "FINANCEIRO", label: "Financeiro" },
  { email: "ti@central.com", name: "Thiago TI", role: "TI", label: "Logística / TI" },
  { email: "rta@central.com", name: "RTA Operações", role: "RTA", label: "Real Time Analyst" },
  { email: "poc@central.com", name: "POC Operações", role: "POC", label: "Point of Contact" },
  { email: "client@central.com", name: "Cliente Performance", role: "CLIENT", label: "Cliente" },
  { email: "global@central.com", name: "Global Viewer", role: "GLOBAL", label: "Global Read Only" }
] as const satisfies ReadonlyArray<{ email: string; name: string; role: AppRole; label: string }>;

export function getDemoUser(email?: string | null) {
  return demoUsers.find((user) => user.email === email) ?? demoUsers[0];
}
