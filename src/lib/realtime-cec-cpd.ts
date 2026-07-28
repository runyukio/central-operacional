export type CecTicketForCpd = {
  ticket: string;
  agentName: string;
  status?: string;
};

export type CecAgentCpd = {
  agentName: string;
  cpd: number;
  share: number;
};

function normalizeKey(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("pt-BR");
}

export function normalizeCecTicket<T extends CecTicketForCpd>(
  input: T
): T & { ticket: string; agentName: string; status: string } {
  return {
    ...input,
    ticket: String(input.ticket ?? "").trim(),
    agentName: String(input.agentName ?? "").trim().replace(/\s+/g, " ") || "Sem agente",
    status: String(input.status ?? "").trim() || "Sem status"
  };
}

export function buildCecHourlyCpd(inputs: CecTicketForCpd[]) {
  const displayNames = new Map<string, string>();
  const distinctTicketsByAgent = new Map<string, Set<string>>();
  const tickets = inputs
    .map(normalizeCecTicket)
    .filter((ticket) => Boolean(normalizeKey(ticket.ticket)));

  tickets.forEach((ticket) => {
    const agentKey = normalizeKey(ticket.agentName) || "sem agente";
    const ticketKey = normalizeKey(ticket.ticket);
    if (!displayNames.has(agentKey)) displayNames.set(agentKey, ticket.agentName);
    const distinctTickets = distinctTicketsByAgent.get(agentKey) ?? new Set<string>();
    distinctTickets.add(ticketKey);
    distinctTicketsByAgent.set(agentKey, distinctTickets);
  });

  const totalCpd = [...distinctTicketsByAgent.values()].reduce((total, ticketsForAgent) => total + ticketsForAgent.size, 0);
  const agents: CecAgentCpd[] = [...distinctTicketsByAgent.entries()]
    .map(([agentKey, ticketsForAgent]) => ({
      agentName: displayNames.get(agentKey) || "Sem agente",
      cpd: ticketsForAgent.size,
      share: totalCpd ? (ticketsForAgent.size / totalCpd) * 100 : 0
    }))
    .sort((left, right) => right.cpd - left.cpd || left.agentName.localeCompare(right.agentName, "pt-BR"));
  const activeAgents = agents.length;

  return {
    tickets,
    agents,
    totalCpd,
    activeAgents,
    averageCpd: activeAgents ? Math.round((totalCpd / activeAgents) * 100) / 100 : 0
  };
}
