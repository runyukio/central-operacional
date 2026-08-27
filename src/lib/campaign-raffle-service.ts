import { createHash, randomInt } from "node:crypto";
import { Prisma } from "@prisma/client";

import {
  RAFFLE_MAX_NUMBER,
  RAFFLE_MIN_NUMBER,
  drawUniqueRaffleNumbers
} from "@/lib/campaign-raffle-core";
import type { Actor } from "@/lib/mock-db";
import { isAgentJobTitle } from "@/lib/job-title-normalization";
import { canAccessCampaignAgent, canManageCampaignStaff } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export class CampaignRaffleError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "CampaignRaffleError";
  }
}

type CampaignRaffleContext = Awaited<ReturnType<typeof loadCampaignRaffleContext>>;

export async function getCampaignRaffleAccess(actor: Actor) {
  const context = await loadCampaignRaffleContext(actor);
  return {
    canViewOwn: context.canViewOwn,
    canManage: context.canManage,
    lob: context.employee?.lob.name ?? null,
    roleTitle: context.employee?.roleTitle ?? null
  };
}

export async function getCampaignRaffleDashboard(actor: Actor, view: "agent" | "staff", campaignId?: string | null) {
  const context = await loadCampaignRaffleContext(actor);
  if (view === "staff") {
    if (!context.canManage) throw new CampaignRaffleError("Apenas WFM e ADM podem acessar a visão Staff.", 403);
    return loadStaffDashboard(context, campaignId);
  }
  if (!context.canViewOwn || !context.employee) {
    throw new CampaignRaffleError("A visão Agente está disponível somente para agentes da operação ADS.", 403);
  }
  return loadAgentDashboard(context);
}

export async function createRaffleCampaign(actor: Actor, input: { name: string }) {
  const context = await loadCampaignRaffleContext(actor);
  if (!context.canManage) throw new CampaignRaffleError("Apenas WFM e ADM podem criar campanhas.", 403);
  const name = input.name.replace(/\s+/g, " ").trim();
  if (name.length < 3 || name.length > 100) throw new CampaignRaffleError("Informe um nome entre 3 e 100 caracteres.");

  const campaign = await prisma.$transaction(async (tx) => {
    const created = await tx.raffleCampaign.create({
      data: {
        name,
        minNumber: RAFFLE_MIN_NUMBER,
        maxNumber: RAFFLE_MAX_NUMBER,
        createdById: context.user.id
      }
    });
    await tx.auditLog.create({
      data: {
        actorId: context.user.id,
        action: "CRIACAO",
        entity: "RaffleCampaign",
        entityId: created.id,
        after: { name, minNumber: RAFFLE_MIN_NUMBER, maxNumber: RAFFLE_MAX_NUMBER }
      }
    });
    return created;
  });
  return { id: campaign.id, name: campaign.name };
}

export async function distributeRaffleTickets(actor: Actor, input: {
  campaignId: string;
  employeeIds: string[];
  ticketsPerEmployee: number;
  idempotencyKey: string;
}) {
  const context = await loadCampaignRaffleContext(actor);
  if (!context.canManage) throw new CampaignRaffleError("Apenas WFM e ADM podem distribuir tickets.", 403);

  const employeeIds = Array.from(new Set(input.employeeIds.map((id) => id.trim()).filter(Boolean))).sort();
  const ticketsPerEmployee = Number(input.ticketsPerEmployee);
  if (!employeeIds.length) throw new CampaignRaffleError("Selecione pelo menos um agente ADS.");
  if (employeeIds.length > 500) throw new CampaignRaffleError("Selecione no máximo 500 agentes por envio.");
  if (!Number.isInteger(ticketsPerEmployee) || ticketsPerEmployee < 1 || ticketsPerEmployee > RAFFLE_MAX_NUMBER) {
    throw new CampaignRaffleError("A quantidade por agente deve estar entre 1 e 10.000.");
  }
  const totalTickets = employeeIds.length * ticketsPerEmployee;
  if (totalTickets > RAFFLE_MAX_NUMBER) throw new CampaignRaffleError("O envio não pode ultrapassar 10.000 tickets.");
  const idempotencyKey = input.idempotencyKey.trim();
  if (idempotencyKey.length < 16 || idempotencyKey.length > 100) throw new CampaignRaffleError("Identificador de envio inválido.");
  const requestFingerprint = createHash("sha256")
    .update(JSON.stringify({ campaignId: input.campaignId, employeeIds, ticketsPerEmployee }))
    .digest("hex");

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "RaffleCampaign" WHERE "id" = ${input.campaignId} FOR UPDATE`;
    const previous = await tx.raffleDistribution.findUnique({
      where: { idempotencyKey },
      include: { tickets: { select: { employeeId: true, number: true } } }
    });
    if (previous) {
      if (previous.requestFingerprint !== requestFingerprint) {
        throw new CampaignRaffleError("Este identificador já foi usado em outro envio.", 409);
      }
      return distributionResponse(previous.id, previous.tickets, true);
    }

    const campaign = await tx.raffleCampaign.findUnique({ where: { id: input.campaignId } });
    if (!campaign) throw new CampaignRaffleError("Campanha não encontrada.", 404);
    if (campaign.status !== "ACTIVE") throw new CampaignRaffleError("Esta campanha não está ativa.", 409);

    const eligibleEmployees = await tx.employeeProfile.findMany({
      where: {
        id: { in: employeeIds },
        deletedAt: null,
        terminationDate: null,
        lob: { name: { equals: "ADS", mode: "insensitive" } },
        user: { is: { status: "ACTIVE", deletedAt: null } }
      },
      select: { id: true, fullName: true, wbLogin: true, roleTitle: true, operationalStatus: true }
    });
    const eligible = eligibleEmployees.filter(isEligibleAdsAgent);
    if (eligible.length !== employeeIds.length) {
      const eligibleIds = new Set(eligible.map((employee) => employee.id));
      const invalidCount = employeeIds.filter((id) => !eligibleIds.has(id)).length;
      throw new CampaignRaffleError(`${invalidCount} parceiro(s) não são agentes ADS ativos e não podem receber tickets.`, 409);
    }

    const usedNumbers = await tx.raffleTicketAssignment.findMany({
      where: { campaignId: campaign.id },
      select: { number: true }
    });
    const drawn = drawUniqueRaffleNumbers({
      min: campaign.minNumber,
      max: campaign.maxNumber,
      usedNumbers: usedNumbers.map((ticket) => ticket.number),
      count: totalTickets,
      nextIndex: randomInt
    });
    const shuffledEmployees = cryptoShuffle(eligible);
    const distribution = await tx.raffleDistribution.create({
      data: {
        campaignId: campaign.id,
        assignedById: context.user.id,
        idempotencyKey,
        requestFingerprint,
        ticketsPerEmployee,
        employeeCount: shuffledEmployees.length,
        totalTickets
      }
    });
    const tickets = shuffledEmployees.flatMap((employee, employeeIndex) => (
      drawn
        .slice(employeeIndex * ticketsPerEmployee, (employeeIndex + 1) * ticketsPerEmployee)
        .map((number) => ({
          campaignId: campaign.id,
          distributionId: distribution.id,
          employeeId: employee.id,
          assignedById: context.user.id,
          number
        }))
    ));
    await tx.raffleTicketAssignment.createMany({ data: tickets });
    await tx.auditLog.create({
      data: {
        actorId: context.user.id,
        action: "CRIACAO",
        entity: "RaffleDistribution",
        entityId: distribution.id,
        after: {
          campaignId: campaign.id,
          campaignName: campaign.name,
          employeeIds,
          ticketsPerEmployee,
          totalTickets
        } as Prisma.InputJsonValue
      }
    });
    return distributionResponse(distribution.id, tickets, false);
  }, { maxWait: 5_000, timeout: 15_000 });
}

export async function deleteRaffleTicket(actor: Actor, input: { ticketId: string }) {
  const context = await loadCampaignRaffleContext(actor);
  if (!context.canManage) throw new CampaignRaffleError("Apenas WFM e ADM podem excluir tickets.", 403);

  const ticketId = input.ticketId.trim();
  if (!ticketId) throw new CampaignRaffleError("Ticket inválido.");

  return prisma.$transaction(async (tx) => {
    const ticket = await tx.raffleTicketAssignment.findUnique({
      where: { id: ticketId },
      select: {
        id: true,
        number: true,
        campaignId: true,
        distributionId: true,
        employeeId: true,
        campaign: { select: { name: true } },
        employee: { select: { fullName: true, wbLogin: true } }
      }
    });
    if (!ticket) throw new CampaignRaffleError("Este ticket não existe ou já foi excluído.", 404);

    const deleted = await tx.raffleTicketAssignment.deleteMany({ where: { id: ticket.id } });
    if (deleted.count !== 1) throw new CampaignRaffleError("Este ticket já foi excluído.", 409);

    await tx.auditLog.create({
      data: {
        actorId: context.user.id,
        action: "EXCLUSAO",
        entity: "RaffleTicketAssignment",
        entityId: ticket.id,
        before: {
          campaignId: ticket.campaignId,
          campaignName: ticket.campaign.name,
          distributionId: ticket.distributionId,
          employeeId: ticket.employeeId,
          employeeName: ticket.employee.fullName,
          wbLogin: ticket.employee.wbLogin,
          number: ticket.number
        }
      }
    });
    return {
      id: ticket.id,
      number: ticket.number,
      employeeName: ticket.employee.fullName,
      wbLogin: ticket.employee.wbLogin
    };
  }, { maxWait: 5_000, timeout: 10_000 });
}

async function loadCampaignRaffleContext(actor: Actor) {
  if (!actor.email) throw new CampaignRaffleError("Usuário não autenticado.", 401);
  const user = await prisma.user.findFirst({
    where: { email: { equals: actor.email, mode: "insensitive" }, deletedAt: null },
    select: {
      id: true,
      name: true,
      email: true,
      status: true,
      role: { select: { name: true } },
      employeeProfile: {
        select: {
          id: true,
          fullName: true,
          wbLogin: true,
          roleTitle: true,
          operationalStatus: true,
          deletedAt: true,
          terminationDate: true,
          lob: { select: { name: true } }
        }
      }
    }
  });
  if (!user || user.status !== "ACTIVE") throw new CampaignRaffleError("Usuário não autorizado.", 401);
  const employee = user.employeeProfile;
  const permissionUser = {
    role: user.role.name,
    status: user.status,
    roleTitle: employee?.roleTitle,
    jobTitle: employee?.roleTitle,
    lob: employee?.lob.name
  };
  return {
    user,
    employee,
    canManage: canManageCampaignStaff(permissionUser),
    canViewOwn: Boolean(employee && !employee.deletedAt && !employee.terminationDate && isEligibleAdsAgent(employee) && canAccessCampaignAgent(permissionUser))
  };
}

async function loadStaffDashboard(context: CampaignRaffleContext, campaignId?: string | null) {
  const [campaigns, eligibleRows] = await Promise.all([
    prisma.raffleCampaign.findMany({
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      select: {
        id: true,
        name: true,
        status: true,
        minNumber: true,
        maxNumber: true,
        createdAt: true,
        _count: { select: { tickets: true, distributions: true } }
      }
    }),
    prisma.employeeProfile.findMany({
      where: {
        deletedAt: null,
        terminationDate: null,
        lob: { name: { equals: "ADS", mode: "insensitive" } },
        user: { is: { status: "ACTIVE", deletedAt: null } }
      },
      select: {
        id: true,
        fullName: true,
        wbLogin: true,
        roleTitle: true,
        operationalStatus: true,
        shift: { select: { name: true } }
      },
      orderBy: { fullName: "asc" }
    })
  ]);
  const agents = eligibleRows.filter(isEligibleAdsAgent);
  const selectedCampaign = campaigns.find((campaign) => campaign.id === campaignId)
    ?? campaigns.find((campaign) => campaign.status === "ACTIVE")
    ?? campaigns[0]
    ?? null;
  const [counts, distributions, ticketAssignments] = selectedCampaign
    ? await Promise.all([
        prisma.raffleTicketAssignment.groupBy({
          by: ["employeeId"],
          where: { campaignId: selectedCampaign.id },
          _count: { _all: true }
        }),
        prisma.raffleDistribution.findMany({
          where: { campaignId: selectedCampaign.id },
          orderBy: { createdAt: "desc" },
          take: 20,
          select: {
            id: true,
            employeeCount: true,
            ticketsPerEmployee: true,
            totalTickets: true,
            createdAt: true,
            assignedBy: { select: { name: true, email: true } }
          }
        }),
        prisma.raffleTicketAssignment.findMany({
          where: { campaignId: selectedCampaign.id },
          orderBy: { number: "asc" },
          select: {
            id: true,
            number: true,
            createdAt: true,
            employee: {
              select: {
                id: true,
                fullName: true,
                wbLogin: true,
                operationalStatus: true
              }
            }
          }
        })
      ])
    : [[], [], []];
  const countByEmployee = new Map(counts.map((row) => [row.employeeId, row._count._all]));
  const usedTickets = selectedCampaign?._count.tickets ?? 0;
  const rangeSize = selectedCampaign ? selectedCampaign.maxNumber - selectedCampaign.minNumber + 1 : RAFFLE_MAX_NUMBER;
  const ticketHolderMap = new Map<string, {
    employeeId: string;
    name: string;
    wbLogin: string;
    status: string;
    tickets: Array<{ id: string; number: number; assignedAt: string }>;
  }>();
  for (const assignment of ticketAssignments) {
    const holder = ticketHolderMap.get(assignment.employee.id) ?? {
      employeeId: assignment.employee.id,
      name: assignment.employee.fullName,
      wbLogin: assignment.employee.wbLogin,
      status: assignment.employee.operationalStatus,
      tickets: []
    };
    holder.tickets.push({
      id: assignment.id,
      number: assignment.number,
      assignedAt: assignment.createdAt.toISOString()
    });
    ticketHolderMap.set(holder.employeeId, holder);
  }

  return {
    view: "staff" as const,
    access: { canManage: context.canManage, canViewOwn: context.canViewOwn },
    campaigns: campaigns.map((campaign) => ({
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      minNumber: campaign.minNumber,
      maxNumber: campaign.maxNumber,
      usedTickets: campaign._count.tickets,
      distributions: campaign._count.distributions,
      createdAt: campaign.createdAt.toISOString()
    })),
    selectedCampaignId: selectedCampaign?.id ?? null,
    summary: {
      usedTickets,
      availableTickets: Math.max(0, rangeSize - usedTickets),
      coveredAgents: counts.length,
      distributions: selectedCampaign?._count.distributions ?? 0
    },
    agents: agents.map((employee) => ({
      id: employee.id,
      name: employee.fullName,
      wbLogin: employee.wbLogin,
      shift: employee.shift.name,
      assignedTickets: countByEmployee.get(employee.id) ?? 0
    })),
    recentDistributions: distributions.map((distribution) => ({
      id: distribution.id,
      employeeCount: distribution.employeeCount,
      ticketsPerEmployee: distribution.ticketsPerEmployee,
      totalTickets: distribution.totalTickets,
      assignedBy: distribution.assignedBy.name || distribution.assignedBy.email,
      createdAt: distribution.createdAt.toISOString()
    })),
    ticketHolders: Array.from(ticketHolderMap.values()).sort((left, right) => left.name.localeCompare(right.name, "pt-BR"))
  };
}

async function loadAgentDashboard(context: CampaignRaffleContext) {
  const employee = context.employee!;
  const tickets = await prisma.raffleTicketAssignment.findMany({
    where: { employeeId: employee.id },
    orderBy: [{ campaign: { createdAt: "desc" } }, { number: "asc" }],
    select: {
      number: true,
      createdAt: true,
      campaign: { select: { id: true, name: true, status: true, minNumber: true, maxNumber: true, createdAt: true } }
    }
  });
  const campaigns = new Map<string, {
    id: string;
    name: string;
    status: string;
    minNumber: number;
    maxNumber: number;
    createdAt: string;
    tickets: Array<{ number: number; assignedAt: string }>;
  }>();
  for (const ticket of tickets) {
    const campaign = campaigns.get(ticket.campaign.id) ?? {
      id: ticket.campaign.id,
      name: ticket.campaign.name,
      status: ticket.campaign.status,
      minNumber: ticket.campaign.minNumber,
      maxNumber: ticket.campaign.maxNumber,
      createdAt: ticket.campaign.createdAt.toISOString(),
      tickets: []
    };
    campaign.tickets.push({ number: ticket.number, assignedAt: ticket.createdAt.toISOString() });
    campaigns.set(campaign.id, campaign);
  }
  return {
    view: "agent" as const,
    access: { canManage: context.canManage, canViewOwn: context.canViewOwn },
    employee: { name: employee.fullName, wbLogin: employee.wbLogin, lob: employee.lob.name },
    campaigns: Array.from(campaigns.values())
  };
}

function isEligibleAdsAgent(employee: { roleTitle: string; operationalStatus: string; lob?: { name: string } }) {
  const status = employee.operationalStatus.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  const isAds = employee.lob ? employee.lob.name.trim().toUpperCase() === "ADS" : true;
  return isAds && isAgentJobTitle(employee.roleTitle) && status !== "desligado";
}

function cryptoShuffle<T>(values: T[]) {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function distributionResponse(
  distributionId: string,
  tickets: Array<{ employeeId: string; number: number }>,
  idempotent: boolean
) {
  const allocations = new Map<string, number[]>();
  for (const ticket of tickets) {
    const current = allocations.get(ticket.employeeId) ?? [];
    current.push(ticket.number);
    allocations.set(ticket.employeeId, current);
  }
  return {
    distributionId,
    totalTickets: tickets.length,
    idempotent,
    allocations: Array.from(allocations, ([employeeId, numbers]) => ({ employeeId, numbers: numbers.sort((a, b) => a - b) }))
  };
}
