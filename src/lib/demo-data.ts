import {
  Award,
  BellRing,
  BriefcaseBusiness,
  CalendarCheck,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Coins,
  FileText,
  Headphones,
  HeartPulse,
  Laptop,
  Megaphone,
  MessageCircle,
  Monitor,
  ShieldCheck,
  Star,
  Target,
  Trophy,
  UserCheck,
  Users,
  UsersRound,
  Wrench,
  XCircle
} from "lucide-react";

export const operations = ["Todas as Operações", "CEC", "TNS", "ADS"];
export const lobs = ["CEC", "TNS", "ADS"];
export const shifts = ["Manhã", "Tarde", "Noite", "Madrugada", "Backoffice"];

export const commandStats = [
  { title: "Pessoas Escaladas", value: "1.256", change: "100%", helper: "vs dia anterior", icon: Users, tone: "blue" as const },
  { title: "Presentes", value: "1.112", change: "88,5%", helper: "vs dia anterior", icon: UserCheck, tone: "green" as const },
  { title: "Ausências", value: "144", change: "11,5%", helper: "vs dia anterior", icon: XCircle, tone: "orange" as const },
  { title: "Gaps por Turno", value: "42", change: "3,3%", helper: "vs dia anterior", icon: Clock, tone: "purple" as const },
  { title: "Solicitações Pendentes", value: "18", change: "-10%", helper: "vs dia anterior", icon: FileText, tone: "gold" as const },
  { title: "Equipamentos com Problema", value: "27", change: "+8%", helper: "vs dia anterior", icon: Monitor, tone: "red" as const }
];

export const presenceByShift = [
  { shift: "Madrugada", escalados: 1200, presentes: 1260 },
  { shift: "Manhã", escalados: 1220, presentes: 1248 },
  { shift: "Tarde", escalados: 780, presentes: 850 },
  { shift: "Noite", escalados: 1160, presentes: 1210 }
];

export const absenceReasons = [
  { name: "Atestado Médico", value: 48, fill: "#071B3A" },
  { name: "Falta Justificada", value: 32, fill: "#14B8A6" },
  { name: "Transporte", value: 20, fill: "#F59E0B" },
  { name: "Problemas Pessoais", value: 18, fill: "#7C3AED" },
  { name: "Outros", value: 26, fill: "#94A3B8" }
];

export const gapByShift = [
  { shift: "Madrugada", gaps: 38 },
  { shift: "Manhã", gaps: 49 },
  { shift: "Tarde", gaps: 37 },
  { shift: "Noite", gaps: 41 }
];

export const alerts = [
  { title: "Alto índice de ausências no turno da Manhã: 16,7%", status: "Crítico", time: "09:15", tone: "red" as const },
  { title: "Gap acima do limite no turno da Noite: 18", status: "Alerta", time: "09:10", tone: "orange" as const },
  { title: "27 equipamentos com problema", status: "Atenção", time: "09:05", tone: "orange" as const },
  { title: "Novo comunicado disponível para a operação", status: "Informativo", time: "08:50", tone: "blue" as const }
];

export const risks = [
  { title: "Ausências elevadas previstas no turno da Manhã", status: "Alto", tone: "red" as const },
  { title: "Gap acima do limite no turno da Manhã", status: "Alto", tone: "orange" as const },
  { title: "Equipamentos críticos inoperantes", status: "Médio", tone: "orange" as const },
  { title: "Solicitações acumuladas sem atendente", status: "Baixo", tone: "green" as const }
];

export const topPerformers = [
  { name: "Juliana Santos", role: "Supervisora", performance: "132%", productivity: "122%", quality: "97,2%", delta: "+2" },
  { name: "Rafael Lima", role: "Supervisor", performance: "128%", productivity: "118%", quality: "96,1%", delta: "+1" },
  { name: "Camila Oliveira", role: "Líder de Equipe", performance: "125%", productivity: "115%", quality: "94,8%", delta: "-" },
  { name: "Bruno Ferreira", role: "Analista", performance: "122%", productivity: "108%", quality: "93,7%", delta: "+3" },
  { name: "Fernanda Costa", role: "Analista", performance: "119%", productivity: "105%", quality: "92,5%", delta: "-1" }
];

export const performanceEvolution = [
  { day: "1 Mai", produtividade: 100, qualidade: 75, aderencia: 58 },
  { day: "6 Mai", produtividade: 116, qualidade: 88, aderencia: 63 },
  { day: "11 Mai", produtividade: 110, qualidade: 88, aderencia: 67 },
  { day: "16 Mai", produtividade: 118, qualidade: 98, aderencia: 73 },
  { day: "21 Mai", produtividade: 128, qualidade: 99, aderencia: 76 },
  { day: "23 Mai", produtividade: 130, qualidade: 100, aderencia: 79 }
];

export const teamRanking = [
  ["1º", "Equipe Alfa", "128%", "97,2%", "93,4%", "318,6"],
  ["2º", "Equipe Bravo", "120%", "95,8%", "90,1%", "305,9"],
  ["3º", "Equipe Charlie", "115%", "94,1%", "89,7%", "298,8"],
  ["4º", "Equipe Delta", "110%", "92,3%", "87,6%", "289,9"],
  ["5º", "Equipe Echo", "105%", "90,2%", "85,4%", "280,6"]
];

export const employees = Array.from({ length: 20 }).map((_, index) => {
  const names = [
    "João Silva",
    "Ana Carolina",
    "Bruno Ribeiro",
    "Camila Lima",
    "Diego Fernandes",
    "Eduardo Gomes",
    "Fernanda Souza",
    "Gabriel Rocha",
    "Hugo Tavares",
    "Isabela Nunes",
    "Juliana Santos",
    "Larissa Souza",
    "Marcos Costa",
    "Nathalia Alves",
    "Otavio Martins",
    "Paula Ribeiro",
    "Rafael Lima",
    "Sofia Mendes",
    "Thiago Ferreira",
    "Vanessa Carvalho"
  ];
  const status = index % 9 === 0 ? "Offline" : index % 4 === 0 ? "Em Atendimento" : "Online";
  return {
    id: `EMP-${index + 1}`,
    name: names[index],
    wb: `WB${String(1001 + index).padStart(4, "0")}`,
    lob: lobs[index % lobs.length],
    supervisor: index % 2 === 0 ? "Carla Supervisora" : "Rafael Supervisor",
    shift: shifts[index % 4],
    schedule: index % 5 === 0 ? "5x2" : "6x1",
    status,
    quality: index % 9 === 0 ? null : 73 + ((index * 7) % 26),
    productivity: index % 9 === 0 ? null : 70 + ((index * 5) % 29),
    equipment: index % 9 === 0 ? 0 : 2,
    admission: `0${(index % 9) + 1}/02/2023`,
    role: index % 5 === 0 ? "Analista" : "Atendente"
  };
});

export const scheduleDays = Array.from({ length: 35 }).map((_, index) => {
  const day = index - 2;
  const isOutside = day < 1 || day > 31;
  const date = isOutside ? (day < 1 ? 31 + day : day - 31) : day;
  const weekend = [4, 5, 11, 12, 18, 19, 25, 26].includes(date);
  const shift = date >= 20 && date <= 24 ? "Noite" : date >= 13 && date <= 17 ? "Tarde" : "Manhã";
  return {
    date,
    outside: isOutside,
    shift: weekend ? "Folga" : shift,
    label: weekend ? "Folga" : shift
  };
});

export const scheduleRequests = [
  { title: "Troca de Folga", date: "18/05/2026", status: "Pendente", icon: Clock },
  { title: "Troca de Turno", date: "10/05/2026", status: "Aprovada", icon: CheckCircle2 },
  { title: "Cancelamento de Folga", date: "02/05/2026", status: "Rejeitada", icon: XCircle }
];

export const scheduleGridRows = employees.slice(1, 9).map((employee, index) => ({
  employee,
  days: Array.from({ length: 10 }).map((_, dayIndex) => {
    const values = ["Manhã", "Tarde", "Noite", "Folga", "Manhã", "Tarde", "Noite", "Manhã", "Tarde", "Folga"];
    const value = index === 3 && dayIndex === 3 ? "Conflito" : values[(index + dayIndex) % values.length];
    return value;
  })
}));

export const requests = [
  { id: "REQ-1024", type: "Troca de folga", requester: "Larissa Souza", priority: "Média", status: "Aberto", area: "WFM", time: "Hoje, 09:15", icon: CalendarCheck },
  { id: "REQ-1025", type: "Ajuste de escala", requester: "Rafael Pereira", priority: "Alta", status: "Em análise", area: "WFM", time: "Hoje, 10:05", icon: UsersRound },
  { id: "REQ-1026", type: "Equipamento", requester: "Bruno Pereira", priority: "Média", status: "Aguardando aprovação", area: "TI", time: "Hoje, 10:40", icon: Laptop },
  { id: "REQ-1027", type: "Troca de folga", requester: "Vanessa Carvalho", priority: "Média", status: "Aprovado", area: "WFM", time: "Hoje, 08:55", icon: CalendarCheck },
  { id: "REQ-1028", type: "Ajuste de escala", requester: "Paula Ribeiro", priority: "Alta", status: "Recusado", area: "WFM", time: "Ontem, 16:40", icon: UsersRound },
  { id: "REQ-1029", type: "Suporte", requester: "Rafael Souza", priority: "Média", status: "Concluído", area: "Operações", time: "Ontem, 17:20", icon: Headphones },
  { id: "REQ-1030", type: "RH", requester: "Juliana Lima", priority: "Baixa", status: "Concluído", area: "RH", time: "Ontem, 18:30", icon: HeartPulse },
  { id: "REQ-1031", type: "Qualidade", requester: "Diego Fernandes", priority: "Média", status: "Aprovado", area: "Qualidade", time: "Ontem, 11:10", icon: ShieldCheck },
  { id: "REQ-1032", type: "Equipamento", requester: "Lucas Andrade", priority: "Baixa", status: "Recusado", area: "TI", time: "Ontem, 15:00", icon: Laptop },
  { id: "REQ-1033", type: "Troca de folga", requester: "Thiago Ferreira", priority: "Alta", status: "Aguardando aprovação", area: "WFM", time: "Hoje, 11:20", icon: CalendarCheck },
  { id: "REQ-1034", type: "Ajuste de escala", requester: "Marcos Costa", priority: "Alta", status: "Aberto", area: "WFM", time: "Hoje, 08:42", icon: UsersRound },
  { id: "REQ-1035", type: "Equipamento", requester: "Ana Ferreira", priority: "Baixa", status: "Aberto", area: "TI", time: "Hoje, 08:30", icon: Laptop }
];

export const kanbanColumns = ["Aberto", "Em análise", "Aguardando aprovação", "Aprovado", "Recusado", "Ajuste solicitado", "Concluído"];

export const announcements = [
  { title: "Atualização no Plano de Saúde", category: "Comunicado Importante", body: "Novas condições e coberturas a partir de junho.", date: "23/05/2026", area: "Administrativo", status: "Confirmar Leitura" },
  { title: "Manutenção Programada", category: "Atenção", body: "Sistemas indisponíveis no dia 26/05 das 00h às 04h.", date: "22/05/2026", area: "TI", status: "Confirmar Leitura" },
  { title: "Resultados do 1º Trimestre", category: "Informativo", body: "Confira os destaques e conquistas do período.", date: "21/05/2026", area: "Financeiro", status: "Confirmar Leitura" }
];

export const pinnedAnnouncements = [
  { title: "Atualização da Política Interna", subtitle: "Válido até 31/05/2026", icon: BellRing, tone: "red" },
  { title: "Treinamento de Segurança", subtitle: "Participe até 30/05", icon: ClipboardCheck, tone: "green" }
];

export const notificationItems = [
  { title: "Comunicado Importante", body: "Atualização no Plano de Saúde", date: "23/05/2026 09:15", tone: "red" },
  { title: "Manutenção Programada", body: "Sistemas indisponíveis no dia 26/05", date: "23/05/2026 08:45", tone: "orange" },
  { title: "Resultados do 1º Trimestre", body: "Confira os destaques do período", date: "23/05/2026 08:30", tone: "blue" },
  { title: "Treinamento de Segurança", body: "Participe até 30/05", date: "22/05/2026 17:20", tone: "green" },
  { title: "Nova Pesquisa de Clima", body: "Sua opinião é muito importante", date: "22/05/2026 16:10", tone: "purple" }
];

export const communicationCategories = [
  { label: "Administrativo", count: "12 novos", icon: UsersRound, tone: "purple" },
  { label: "Recursos Humanos", count: "8 novos", icon: HeartPulse, tone: "green" },
  { label: "TI e Sistemas", count: "6 novos", icon: Monitor, tone: "blue" },
  { label: "Operações", count: "15 novos", icon: Target, tone: "orange" },
  { label: "Financeiro", count: "4 novos", icon: BriefcaseBusiness, tone: "green" },
  { label: "OSMS", count: "3 novos", icon: ShieldCheck, tone: "red" }
];

export const qualityFeedback = [
  { employee: "Ana Paula", type: "Positivo", theme: "Clareza na comunicação", quality: "95%", status: "Lido", message: "Parabéns pela clareza nas informações..." },
  { employee: "Bruno Souza", type: "Positivo", theme: "Empatia demonstrada", quality: "90%", status: "Lido", message: "Ótima empatia ao entender a necessidade..." },
  { employee: "Carla Mendes", type: "Atenção", theme: "Informação incompleta", quality: "70%", status: "Pendente", message: "Faltou detalhar o prazo de retorno..." },
  { employee: "Diego Ribeiro", type: "Positivo", theme: "Atitude exemplar", quality: "98%", status: "Lido", message: "Excelente postura e proatividade..." },
  { employee: "Juliana Costa", type: "Positivo", theme: "Uso adequado de tom", quality: "94%", status: "Lido", message: "Uso do tom de voz adequado ao perfil..." }
];

export const equipmentRows = Array.from({ length: 10 }).map((_, index) => {
  const types = ["Notebook Dell", "Headset", "Monitor", "Desktop", "Rádio Comunicador", "Impressora Térmica"];
  const status = index % 5 === 0 ? "Em Manutenção" : index % 4 === 0 ? "Inoperante" : "Funcionando";
  return {
    code: `EQP-${String(index + 1).padStart(4, "0")}`,
    type: types[index % types.length],
    employee: employees[index]?.name ?? "Colaborador",
    status,
    delivered: `${String(23 - index).padStart(2, "0")}/05/2026`,
    impact: status === "Inoperante" ? "Alto" : status === "Em Manutenção" ? "Médio" : "Baixo"
  };
});

export const equipmentTickets = [
  { code: "#CHM-1023", title: "Caminhão Toco - EQP-0004", body: "Falha no sistema de freios", status: "Alto", age: "Aberto há 2h" },
  { code: "#CHM-1022", title: "Empilhadeira - EQP-0002", body: "Manutenção preventiva", status: "Médio", age: "Aberto há 5h" },
  { code: "#CHM-1021", title: "Compressor - EQP-0007", body: "Vazamento de ar", status: "Médio", age: "Aberto há 1d" },
  { code: "#CHM-1020", title: "Rádio Comunicador - EQP-0009", body: "Interferência no sinal", status: "Baixo", age: "Aberto há 2d" }
];

export const coverageMatrix = [
  { turno: "Madrugada", range: "00:00 - 06:00", values: [92, 95, 90, 88, 93, 85, 82], media: 89 },
  { turno: "Manhã", range: "06:00 - 14:00", values: [96, 98, 97, 95, 96, 93, 91], media: 95 },
  { turno: "Tarde", range: "14:00 - 22:00", values: [94, 93, 92, 90, 91, 88, 86], media: 91 },
  { turno: "Noite", range: "22:00 - 00:00", values: [89, 91, 88, 87, 90, 83, 80], media: 87 }
];

export const coverageByShift = [
  { shift: "Madrugada", cobertura: 89, meta: 95 },
  { shift: "Manhã", cobertura: 95, meta: 95 },
  { shift: "Tarde", cobertura: 91, meta: 95 },
  { shift: "Noite", cobertura: 87, meta: 95 }
];

export const climateThemes = [
  { theme: "Ferramentas", value: 34 },
  { theme: "Liderança", value: 27 },
  { theme: "Processos", value: 21 },
  { theme: "Ambiente", value: 18 }
];

export const tokenHistory = [
  { title: "Presença perfeita", amount: "+40", date: "23/05/2026", type: "Ganho" },
  { title: "Qualidade acima da meta", amount: "+80", date: "20/05/2026", type: "Ganho" },
  { title: "Resgate vale-presente", amount: "-250", date: "18/05/2026", type: "Resgate" },
  { title: "Reconhecimento manual", amount: "+120", date: "15/05/2026", type: "Ganho" }
];

export const rewards = [
  { name: "Vale-presente", cost: 250, stock: 18, icon: Award },
  { name: "Day off", cost: 500, stock: 8, icon: CalendarCheck },
  { name: "Kit reconhecimento", cost: 180, stock: 22, icon: Star },
  { name: "Curso online", cost: 320, stock: 15, icon: Trophy }
];

export const chatMessages = [
  { author: "Carla Supervisora", message: "Bom dia, equipe. Atenção aos comunicados do turno.", time: "09:10", self: false },
  { author: "João Silva", message: "Confirmado, estou acompanhando os chamados prioritários.", time: "09:12", self: true },
  { author: "WFM Operações", message: "Cobertura de tarde está no limite; evitem trocas sem validação.", time: "09:18", self: false }
];

export const auditLogs = [
  ["23/05/2026 09:32", "Admin Central", "IMPORTAÇÃO", "ScheduleImport", "Escala_Maio_2026_v3.xlsx", "241 linhas válidas"],
  ["23/05/2026 09:18", "Carla Supervisora", "APROVAÇÃO", "Request", "REQ-1024", "Cobertura validada"],
  ["23/05/2026 08:55", "Thiago TI", "ALTERAÇÃO_EQUIPAMENTO", "Equipment", "EQP-0004", "Status: Inoperante"],
  ["22/05/2026 17:20", "Ana Qualidade", "CRIAÇÃO", "QualityFeedback", "QF-129", "Pílula enviada"],
  ["22/05/2026 16:10", "Beatriz RH", "CRIAÇÃO", "ClimateSurvey", "CLM-05", "Pesquisa publicada"]
];

export const reportCards = [
  { title: "Relatório de escala", icon: CalendarCheck, records: "248 registros" },
  { title: "Relatório de solicitações", icon: FileText, records: "63 solicitações" },
  { title: "Relatório de performance", icon: Trophy, records: "5 equipes" },
  { title: "Relatório de qualidade", icon: ShieldCheck, records: "128 feedbacks" },
  { title: "Relatório de equipamentos", icon: Wrench, records: "1.248 ativos" },
  { title: "Relatório de clima", icon: HeartPulse, records: "82% participação" },
  { title: "Relatório de auditoria", icon: ClipboardCheck, records: "1.824 logs" }
];

export const settingsSections = [
  "Usuários",
  "Perfis",
  "Permissões",
  "LOBs",
  "Times",
  "Supervisores",
  "Turnos",
  "Tipos de solicitação",
  "SLAs",
  "Regras de aprovação",
  "Regras de cobertura",
  "Regras de tokens",
  "Configurações gerais"
];

export const moduleIcons = {
  users: Users,
  check: CheckCircle2,
  clock: Clock,
  trophy: Trophy,
  shield: ShieldCheck,
  target: Target,
  coins: Coins,
  message: MessageCircle,
  megaphone: Megaphone,
  laptop: Laptop
};
