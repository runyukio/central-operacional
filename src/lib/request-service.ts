import { AuditAction, Prisma } from "@prisma/client";

import type { Actor, Priority as UiPriority, RequestRecord, RequestStatus as UiRequestStatus } from "@/lib/mock-db";
import {
  addRequestComment as addMockRequestComment,
  createRequest as createMockRequest,
  listRequests as listMockRequests,
  recordErrorLog,
  updateRequestStatus as updateMockRequestStatus
} from "@/lib/mock-db";
import { prisma } from "@/lib/prisma";
import { canApproveRequest, normalizeRole } from "@/lib/permissions";
import { cleanShiftName } from "@/lib/shift-display";

const uiToDbStatus = {
  Aberto: "ABERTO",
  "Em análise": "EM_ANALISE",
  Aprovado: "APROVADO",
  Recusado: "RECUSADO",
  Concluído: "CONCLUIDO",
  Cancelado: "CANCELADO"
} as const;

const dbToUiStatus: Record<string, UiRequestStatus> = {
  ABERTO: "Aberto",
  EM_ANALISE: "Em análise",
  AGUARDANDO_APROVACAO: "Em análise",
  APROVADO: "Aprovado",
  RECUSADO: "Recusado",
  AJUSTE_SOLICITADO: "Em análise",
  CONCLUIDO: "Concluído",
  CANCELADO: "Cancelado"
};

const uiToDbPriority = {
  Baixa: "BAIXA",
  Média: "MEDIA",
  Alta: "ALTA",
  Crítica: "CRITICA"
} as const;

const dbToUiPriority: Record<string, UiPriority> = {
  BAIXA: "Baixa",
  MEDIA: "Média",
  ALTA: "Alta",
  CRITICA: "Crítica"
};

const dayOffKinds = ["DAY_OFF_SWAP", "DAY_OFF_SELL", "DAY_OFF_REQUEST"] as const;
type DayOffKind = (typeof dayOffKinds)[number];

const immutableStatuses = ["CONCLUIDO", "RECUSADO", "CANCELADO"] as const;
const pendingStatuses = ["ABERTO", "EM_ANALISE", "AGUARDANDO_APROVACAO", "AJUSTE_SOLICITADO"] as const;
const wfmFinalRoles = ["ADMIN", "GESTOR", "WFM"];
const supervisorStepRoles = ["ADMIN", "GESTOR", "SUPERVISOR"];
const terminalFlowStatuses = ["APROVADO", "CONCLUIDO", "RECUSADO", "CANCELADO"] as const;
const allowDemoDataFallback = process.env.ALLOW_DEMO_LOGIN === "true" || process.env.ALLOW_DEMO_DATA === "true";

class DomainError extends Error {}

export type RequestFilters = {
  type?: string;
  status?: string;
  priority?: string;
  requester?: string;
  assignee?: string;
  date?: string;
  scope?: "mine" | "all";
};

export type CreateRequestInput = {
  type: string;
  title: string;
  description: string;
  priority: UiPriority;
  dayOffKind?: DayOffKind;
  requestedDate?: string;
  currentDayOffDate?: string;
  desiredDayOffDate?: string;
  dayOffToSellDate?: string;
  availabilityShift?: string;
  preferredStartTime?: string;
  preferredEndTime?: string;
  acknowledgement?: boolean;
  desiredDayOffRequestDate?: string;
  dayOffReason?: string;
  urgency?: UiPriority;
  justification?: string;
  attachmentUrl?: string;
};

export type RequestStatusActionInput = {
  finalApprovedShift?: string;
  finalApprovedStartTime?: string;
  finalApprovedEndTime?: string;
};

export async function listOperationalRequests(actor: Actor, filters: RequestFilters = {}) {
  try {
    const user = await findActiveUser(actor.email);
    if (!user) return allowDemoDataFallback ? listMockRequests(actor) : [];

    const where: Prisma.RequestWhereInput = buildRequestWhere(actor, user, filters);
    const requests = await prisma.request.findMany({
      where,
      include: requestInclude,
      orderBy: { createdAt: "desc" }
    });

    return requests.map(mapPrismaRequest);
  } catch (error) {
    recordErrorLog({
      userEmail: actor.email,
      code: "REQUEST_LIST_DB_FALLBACK",
      message: error instanceof Error ? error.message : "Falha ao listar solicitações no banco",
      route: "/api/requests",
      action: "REQUEST_LIST",
      severity: "WARNING"
    });
    return allowDemoDataFallback ? listMockRequests(actor) : [];
  }
}

export async function createOperationalRequest(actor: Actor, input: CreateRequestInput) {
  const validationError = validateCreateInput(input);
  if (validationError) return { error: validationError };

  try {
    const user = await findActiveUser(actor.email);
    if (!user && allowDemoDataFallback) {
      return {
        data: createMockRequest(actor, {
          type: input.type,
          title: input.title,
          priority: input.priority,
          description: input.description,
          payload: payloadForInput(input)
        }),
        persisted: false
      };
    }
    if (!user) return { error: "Usuário ativo não encontrado para criar solicitação." };

    const area = areaForRequest(input.type);
    if (isDayOffRequest(input) && user.employeeProfile?.id) {
      const dayOffError = await validateDayOffRequestInDatabase(user.employeeProfile.id, input);
      if (dayOffError) return { error: dayOffError };
    }

    const request = await prisma.$transaction(async (tx) => {
      const type = await tx.requestType.upsert({
        where: { name: input.type },
        update: { area },
        create: { name: input.type, area, slaHours: input.priority === "Crítica" ? 4 : 24, requiresApproval: true }
      });

      const created = await tx.request.create({
        data: {
          code: await nextRequestCode(tx),
          title: input.title,
          description: input.description,
          requesterId: user.id,
          employeeId: user.employeeProfile?.id,
          typeId: type.id,
          assignedArea: area,
          priority: uiToDbPriority[input.priority],
          status: "ABERTO",
          payload: payloadForInput(input) as Prisma.InputJsonObject,
          history: {
            create: {
              actorId: user.id,
              action: "Criação",
              to: "ABERTO",
              reason: "Solicitação criada"
            }
          },
          comments: input.justification
            ? {
                create: {
                  authorId: user.id,
                  message: input.justification
                }
              }
            : undefined
        },
        include: requestInclude
      });

      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "CRIACAO",
          entity: "Request",
          entityId: created.id,
          reason: "Solicitação criada",
          newValue: { code: created.code, type: input.type, status: "ABERTO" }
        }
      });

      await notifyApprovers(tx, created.id, created.code, input.type, user.name, area, user.employeeProfile?.supervisorId);
      await tx.notification.create({
        data: {
          userId: user.id,
          title: isDayOffRequest(input) ? "Solicitação de folga criada" : "Solicitação criada",
          body: isDayOffRequest(input) ? "Sua solicitação foi enviada para aprovação." : `${created.code} foi registrada com status Aberto.`,
          category: "Solicitações",
          type: "REQUEST",
          entity: "Request",
          entityId: created.id,
          href: `/solicitacoes?request=${created.code}`
        }
      });
      return created;
    });

    return { data: mapPrismaRequest(request), persisted: true };
  } catch (error) {
    recordErrorLog({
      userEmail: actor.email,
      code: "REQUEST_CREATE_DB_FALLBACK",
      message: error instanceof Error ? error.message : "Falha ao criar solicitação no banco",
      route: "/api/requests",
      action: "REQUEST_CREATE",
      severity: "ERROR"
    });
    if (!allowDemoDataFallback) return { error: "Não foi possível criar a solicitação no banco." };
    return {
      data: createMockRequest(actor, {
        type: input.type,
        title: input.title,
        priority: input.priority,
        description: input.description,
        payload: payloadForInput(input)
      }),
      persisted: false
    };
  }
}

export async function updateOperationalRequestStatus(actor: Actor, id: string, status: UiRequestStatus, reason?: string, actionInput: RequestStatusActionInput = {}) {
  if (status === "Recusado" && !reason?.trim()) {
    return { error: "Informe o motivo da recusa." };
  }

  try {
    const user = await findActiveUser(actor.email);
    if (!user && allowDemoDataFallback) {
      const result = updateMockRequestStatus(actor, id, status, reason, actionInput);
      if (!result || result === "FORBIDDEN") return result;
      if ("record" in result) return { data: result.record, scheduleUpdated: result.scheduleUpdated, persisted: false };
      return { error: result.error };
    }
    if (!user) return "FORBIDDEN" as const;

    const existing = await prisma.request.findFirst({
      where: { OR: [{ id }, { code: id }] },
      include: requestInclude
    });

    if (!existing) return null;
    const initialTransition = resolveRequestTransition(actor, user, existing, status);
    if (initialTransition === "FORBIDDEN") return "FORBIDDEN" as const;
    if ("error" in initialTransition) return initialTransition;

    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.request.findUnique({
        where: { id: existing.id },
        include: requestInclude
      });

      if (!current) throw new DomainError("Solicitação não encontrada.");
      const transition = resolveRequestTransition(actor, user, current, status);
      if (transition === "FORBIDDEN") throw new DomainError("Sem permissão para alterar esta solicitação.");
      if ("error" in transition) throw new DomainError(transition.error);

      const guard = await tx.request.updateMany({
        where: { id: current.id, status: current.status },
        data: { updatedAt: new Date() }
      });
      if (guard.count !== 1) throw new DomainError("Esta solicitação já foi processada por outra ação.");

      const scheduleResult =
        transition.applySchedule && isDayOffRequest(current)
          ? await applyDayOffRequestToSchedule(tx, current, user.id, actionInput)
          : { updated: false, message: "" };

      const saved = await tx.request.update({
        where: { id: current.id },
        data: {
          status: transition.nextStatus,
          updatedAt: new Date(),
          payload: transition.applySchedule && isDayOffRequest(current)
            ? {
                ...((current.payload ?? {}) as Prisma.InputJsonObject),
                scheduleAppliedAt: new Date().toISOString(),
                scheduleAppliedById: user.id,
                scheduleApplicationStatus: scheduleResult.updated ? "APPLIED" : "NOT_APPLIED",
                scheduleApplicationError: scheduleResult.updated ? null : scheduleResult.message,
                finalApprovedShift: actionInput.finalApprovedShift ?? null,
                finalApprovedStartTime: actionInput.finalApprovedStartTime ?? null,
                finalApprovedEndTime: actionInput.finalApprovedEndTime ?? null
              }
            : current.payload as Prisma.InputJsonValue,
          history: {
            create: {
              actorId: user.id,
              action: transition.historyAction,
              from: current.status,
              to: transition.nextStatus,
              reason,
              metadata: transition.applySchedule && isDayOffRequest(current) ? { scheduleUpdated: scheduleResult.updated, scheduleMessage: scheduleResult.message } : undefined
            }
          },
          comments: reason
            ? {
                create: {
                  authorId: user.id,
                  message: reason
                }
              }
            : undefined
        },
        include: requestInclude
      });

      if (transition.applySchedule && isDayOffRequest(current) && scheduleResult.updated) {
        await tx.requestHistory.create({
          data: {
            requestId: saved.id,
            actorId: user.id,
            action: "Cronograma atualizado",
            from: transition.nextStatus,
            to: transition.nextStatus,
            reason: scheduleResult.message,
            metadata: { scheduleUpdated: true }
          }
        });
      }

      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: transition.auditAction,
          entity: "Request",
          entityId: saved.id,
          reason: reason ?? transition.historyAction,
          previousValue: { status: current.status },
          newValue: { status: transition.nextStatus }
        }
      });

      await tx.notification.create({
        data: {
          userId: current.requesterId,
          title: transition.requesterTitle,
          body: transition.nextStatus === "RECUSADO" && reason ? `${transition.requesterBody} Motivo: ${reason}` : transition.requesterBody,
          category: "Solicitações",
          type: transition.requesterNotificationType,
          entity: "Request",
          entityId: saved.id,
          href: `/solicitacoes?request=${saved.code}`
        }
      });

      if (transition.notifyWfm) {
        await notifyWfmApprovers(tx, saved.id, saved.code, current.type.name, current.requester.name);
      }

      if (transition.notifySupervisor) {
        await notifyRequestSupervisor(tx, current, transition.supervisorTitle, transition.supervisorBody);
      }

      return saved;
    });

    const historyMetadata = updated.history[0]?.metadata as { scheduleUpdated?: boolean } | null;
    return { data: mapPrismaRequest(updated), scheduleUpdated: Boolean(historyMetadata?.scheduleUpdated), persisted: true };
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    recordErrorLog({
      userEmail: actor.email,
      code: "REQUEST_STATUS_DB_FALLBACK",
      message: error instanceof Error ? error.message : "Falha ao atualizar solicitação no banco",
      route: "/api/requests/status",
      action: "REQUEST_STATUS",
      severity: "ERROR"
    });
    if (!allowDemoDataFallback) return { error: "Não foi possível atualizar a solicitação no banco." };
    const result = updateMockRequestStatus(actor, id, status, reason, actionInput);
    if (!result || result === "FORBIDDEN") return result;
    if ("record" in result) return { data: result.record, scheduleUpdated: result.scheduleUpdated, persisted: false };
    return { error: result.error };
  }
}

export async function addOperationalRequestComment(actor: Actor, id: string, body: string) {
  if (!body.trim()) return { error: "Comentário obrigatório." };

  try {
    const user = await findActiveUser(actor.email);
    if (!user && allowDemoDataFallback) {
      const result = addMockRequestComment(actor, id, body);
      if (!result || result === "FORBIDDEN") return result;
      return { data: result, persisted: false };
    }
    if (!user) return "FORBIDDEN" as const;

    const existing = await prisma.request.findFirst({ where: { OR: [{ id }, { code: id }] }, include: requestInclude });
    if (!existing) return null;
    if (!canViewRequest(actor, user, existing)) return "FORBIDDEN" as const;

    const updated = await prisma.$transaction(async (tx) => {
      await tx.requestComment.create({ data: { requestId: existing.id, authorId: user.id, message: body } });
      await tx.requestHistory.create({
        data: {
          requestId: existing.id,
          actorId: user.id,
          action: "Comentário",
          from: existing.status,
          to: existing.status,
          reason: body
        }
      });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "EDICAO",
          entity: "Request",
          entityId: existing.id,
          reason: "Comentário adicionado",
          newValue: { body }
        }
      });

      const participantIds = new Set([existing.requesterId, existing.assigneeId].filter(Boolean) as string[]);
      participantIds.delete(user.id);
      for (const participantId of participantIds) {
        await tx.notification.create({
          data: {
            userId: participantId,
            title: "Novo comentário na solicitação",
            body: `${user.name}: ${body}`,
            category: "Solicitações",
            type: "REQUEST",
            entity: "Request",
            entityId: existing.id,
            href: `/solicitacoes?request=${existing.code}`
          }
        });
      }

      return tx.request.findUniqueOrThrow({ where: { id: existing.id }, include: requestInclude });
    });

    return { data: mapPrismaRequest(updated), persisted: true };
  } catch (error) {
    recordErrorLog({
      userEmail: actor.email,
      code: "REQUEST_COMMENT_DB_FALLBACK",
      message: error instanceof Error ? error.message : "Falha ao comentar solicitação",
      route: "/api/requests/comments",
      action: "REQUEST_COMMENT",
      severity: "ERROR"
    });
    if (!allowDemoDataFallback) return { error: "Não foi possível comentar a solicitação no banco." };
    const result = addMockRequestComment(actor, id, body);
    if (!result || result === "FORBIDDEN") return result;
    return { data: result, persisted: false };
  }
}

const requestInclude = {
  type: true,
  requester: true,
  assignee: true,
  employee: true,
  comments: {
    include: { author: true },
    orderBy: { createdAt: "desc" as const },
    take: 20
  },
  history: {
    include: { actor: true },
    orderBy: { createdAt: "desc" as const },
    take: 30
  }
};

type PrismaRequest = Prisma.RequestGetPayload<{ include: typeof requestInclude }>;
type ActiveUser = NonNullable<Awaited<ReturnType<typeof findActiveUser>>>;
type DbRequestStatus = (typeof uiToDbStatus)[keyof typeof uiToDbStatus];
type NotificationKind = "INFO" | "SUCCESS" | "WARNING" | "ERROR" | "REQUEST" | "APPROVAL";
type RequestTransition =
  | "FORBIDDEN"
  | { error: string }
  | {
      nextStatus: DbRequestStatus;
      applySchedule: boolean;
      historyAction: string;
      auditAction: AuditAction;
      requesterTitle: string;
      requesterBody: string;
      requesterNotificationType: NotificationKind;
      notifyWfm?: boolean;
      notifySupervisor?: boolean;
      supervisorTitle?: string;
      supervisorBody?: string;
    };

async function findActiveUser(email: string) {
  return prisma.user.findUnique({
    where: { email },
    include: {
      role: true,
      employeeProfile: true
    }
  });
}

function buildRequestWhere(actor: Actor, user: ActiveUser, filters: RequestFilters) {
  const role = normalizeRole(actor.role);
  const where: Prisma.RequestWhereInput = { deletedAt: null };

  if (filters.scope === "mine") {
    where.requesterId = user.id;
  } else if (role === "COLABORADOR") {
    where.requesterId = user.id;
  } else if (role === "SUPERVISOR" && user.employeeProfile?.id) {
    where.OR = [{ employee: { supervisorId: user.employeeProfile.id } }, { requesterId: user.id }];
  } else if (role === "RH") {
    where.assignedArea = "RH";
  } else if (role === "TI") {
    where.assignedArea = "TI";
  } else if (role === "QUALIDADE") {
    where.assignedArea = "Qualidade";
  }

  if (filters.type && filters.type !== "Todos") where.type = { name: filters.type };
  if (filters.status && filters.status !== "Todos" && filters.status in uiToDbStatus) {
    const mapped = uiToDbStatus[filters.status as keyof typeof uiToDbStatus];
    where.status =
      mapped === "EM_ANALISE"
        ? { in: ["EM_ANALISE", "AGUARDANDO_APROVACAO", "AJUSTE_SOLICITADO"] }
        : mapped;
  }
  if (filters.priority && filters.priority !== "Todos" && filters.priority in uiToDbPriority) where.priority = uiToDbPriority[filters.priority as UiPriority];
  if (filters.requester) where.requester = { name: { contains: filters.requester, mode: "insensitive" } };
  if (filters.assignee) where.assignee = { name: { contains: filters.assignee, mode: "insensitive" } };
  if (filters.date) {
    const start = new Date(`${filters.date}T00:00:00`);
    const end = new Date(`${filters.date}T23:59:59`);
    if (!Number.isNaN(start.getTime())) where.createdAt = { gte: start, lte: end };
  }

  return where;
}

function canViewRequest(actor: Actor, user: ActiveUser, request: PrismaRequest) {
  const role = normalizeRole(actor.role);
  if (["ADMIN", "GESTOR", "WFM"].includes(role)) return true;
  if (role === "COLABORADOR") return request.requesterId === user.id;
  if (role === "SUPERVISOR") return request.employee?.supervisorId === user.employeeProfile?.id || request.requesterId === user.id;
  return canApproveRequest(actor, { area: request.assignedArea, type: request.type.name });
}

function canMutateRequest(actor: Actor, userId: string, request: PrismaRequest, status: UiRequestStatus) {
  const role = normalizeRole(actor.role);
  if (status === "Cancelado") {
    return ["ADMIN", "GESTOR"].includes(role) || (request.requesterId === userId && ["ABERTO", "AGUARDANDO_APROVACAO"].includes(request.status));
  }
  if (role === "COLABORADOR") return false;
  if (["ADMIN", "GESTOR", "WFM"].includes(role)) return true;
  if (role === "SUPERVISOR") return isDayOffRequest(request.type.name);
  return canApproveRequest(actor, { area: request.assignedArea, type: request.type.name });
}

function resolveRequestTransition(actor: Actor, user: ActiveUser, request: PrismaRequest, targetStatus: UiRequestStatus): RequestTransition {
  if (!(targetStatus in uiToDbStatus)) return { error: "Status inválido para a esteira atual." };

  const role = normalizeRole(actor.role);
  const current = normalizeDbRequestStatus(request.status);
  const isRequester = request.requesterId === user.id;
  const isTeamSupervisor = Boolean(user.employeeProfile?.id && request.employee?.supervisorId === user.employeeProfile.id);
  const isSupervisorStep = supervisorStepRoles.includes(role) && (role !== "SUPERVISOR" || isTeamSupervisor);
  const isFinalApprover = wfmFinalRoles.includes(role);
  const target = uiToDbStatus[targetStatus as keyof typeof uiToDbStatus];

  if ((terminalFlowStatuses as readonly string[]).includes(current) && !(current === "APROVADO" && target === "CONCLUIDO" && isFinalApprover)) {
    return { error: "Esta solicitação já foi processada." };
  }

  if (role === "COLABORADOR") {
    if (target === "CANCELADO" && isRequester && current === "ABERTO") {
      return {
        nextStatus: "CANCELADO",
        applySchedule: false,
        historyAction: "Cancelamento",
        auditAction: "EDICAO",
        requesterTitle: "Solicitação cancelada",
        requesterBody: `${request.code} foi cancelada.`,
        requesterNotificationType: "WARNING"
      };
    }
    return "FORBIDDEN";
  }

  if (target === "APROVADO") {
    if (current === "ABERTO") {
      if (!isSupervisorStep) {
        return role === "WFM"
          ? { error: "A solicitação precisa da aprovação do supervisor antes da aprovação final do WFM." }
          : "FORBIDDEN";
      }
      return {
        nextStatus: "EM_ANALISE",
        applySchedule: false,
        historyAction: "Aprovação do supervisor",
        auditAction: "APROVACAO",
        requesterTitle: "Solicitação encaminhada ao WFM",
        requesterBody: "Seu supervisor aprovou a primeira etapa. A solicitação está em análise pelo WFM.",
        requesterNotificationType: "REQUEST",
        notifyWfm: true
      };
    }

    if (current === "EM_ANALISE") {
      if (!isFinalApprover) return "FORBIDDEN";
      return {
        nextStatus: "APROVADO",
        applySchedule: isDayOffRequest(request),
        historyAction: "Aprovação final WFM",
        auditAction: "APROVACAO",
        requesterTitle: finalApprovalTitle(request.type.name),
        requesterBody: finalApprovalBody(request.type.name),
        requesterNotificationType: "SUCCESS",
        notifySupervisor: true,
        supervisorTitle: "Solicitação aprovada pelo WFM",
        supervisorBody: `${request.code} foi aprovada pelo WFM e o cronograma foi atualizado.`
      };
    }

    return { error: "Esta solicitação não pode ser aprovada neste status." };
  }

  if (target === "RECUSADO") {
    if (current === "ABERTO" && !isSupervisorStep && !isFinalApprover) return "FORBIDDEN";
    if (current === "EM_ANALISE" && !isFinalApprover) return "FORBIDDEN";
    return {
      nextStatus: "RECUSADO",
      applySchedule: false,
      historyAction: current === "EM_ANALISE" ? "Recusa WFM" : "Recusa do supervisor",
      auditAction: "RECUSA",
      requesterTitle: "Sua solicitação de folga foi recusada",
      requesterBody: "Sua solicitação de folga foi recusada. Consulte o motivo no histórico.",
      requesterNotificationType: "ERROR",
      notifySupervisor: current === "EM_ANALISE",
      supervisorTitle: "Solicitação recusada pelo WFM",
      supervisorBody: `${request.code} foi recusada pelo WFM.`
    };
  }

  if (target === "CONCLUIDO") {
    if (current !== "APROVADO" || !isFinalApprover) return "FORBIDDEN";
    return {
      nextStatus: "CONCLUIDO",
      applySchedule: false,
      historyAction: "Conclusão administrativa",
      auditAction: "EDICAO",
      requesterTitle: "Solicitação concluída",
      requesterBody: `${request.code} foi concluída administrativamente.`,
      requesterNotificationType: "INFO"
    };
  }

  if (target === "CANCELADO") {
    if (!isFinalApprover && !(isRequester && current === "ABERTO")) return "FORBIDDEN";
    if (!["ABERTO", "EM_ANALISE"].includes(current)) return { error: "Esta solicitação não pode mais ser cancelada." };
    return {
      nextStatus: "CANCELADO",
      applySchedule: false,
      historyAction: "Cancelamento",
      auditAction: "EDICAO",
      requesterTitle: "Solicitação cancelada",
      requesterBody: `${request.code} foi cancelada.`,
      requesterNotificationType: "WARNING",
      notifySupervisor: current === "EM_ANALISE",
      supervisorTitle: "Solicitação cancelada",
      supervisorBody: `${request.code} foi cancelada antes da aprovação final.`
    };
  }

  if (target === "EM_ANALISE" && current === "ABERTO" && isSupervisorStep) {
    return {
      nextStatus: "EM_ANALISE",
      applySchedule: false,
      historyAction: "Aprovação do supervisor",
      auditAction: "APROVACAO",
      requesterTitle: "Solicitação encaminhada ao WFM",
      requesterBody: "Seu supervisor aprovou a primeira etapa. A solicitação está em análise pelo WFM.",
      requesterNotificationType: "REQUEST",
      notifyWfm: true
    };
  }

  return { error: "Transição de status não permitida." };
}

function normalizeDbRequestStatus(status: string): DbRequestStatus {
  if (status === "AGUARDANDO_APROVACAO" || status === "AJUSTE_SOLICITADO") return "EM_ANALISE";
  if (status === "PENDENTE") return "ABERTO";
  if (status === "FINALIZADO") return "CONCLUIDO";
  return (Object.values(uiToDbStatus) as string[]).includes(status) ? (status as DbRequestStatus) : "ABERTO";
}

function mapPrismaRequest(request: PrismaRequest): RequestRecord {
  const payload = (request.payload ?? {}) as Record<string, unknown>;
  return {
    id: request.code,
    type: request.type.name,
    title: request.title,
    requester: request.requester.name,
    requesterEmail: request.requester.email,
    priority: dbToUiPriority[request.priority] ?? "Média",
    status: dbToUiStatus[request.status] ?? "Aberto",
    area: request.assignedArea,
    assignee: request.assignee?.name,
    time: formatDateTime(request.createdAt),
    description: request.description,
    payload,
    history: request.history.map((item) => ({
      at: formatDateTime(item.createdAt),
      actor: item.actor.name,
      action: item.action ?? actionForStatus(dbToUiStatus[item.to] ?? "Aberto"),
      reason: item.reason ?? undefined
    })),
    comments: request.comments.map((comment) => ({
      at: formatDateTime(comment.createdAt),
      author: comment.author.name,
      body: comment.message
    })),
    createdAt: formatDateTime(request.createdAt),
    updatedAt: formatDateTime(request.updatedAt)
  };
}

function validateCreateInput(input: CreateRequestInput) {
  if (!input.type.trim()) return "Tipo da solicitação é obrigatório.";
  if (!input.title.trim()) return "Título é obrigatório.";
  if (!input.description.trim()) return "Descrição é obrigatória.";

  const dayOffKind = normalizeDayOffKind(input);
  if (dayOffKind === "DAY_OFF_SWAP") {
    if (!input.currentDayOffDate) return "Data atual da folga é obrigatória.";
    if (!input.desiredDayOffDate) return "Nova data desejada é obrigatória.";
    if (!input.justification?.trim()) return "Justificativa é obrigatória.";
    if (input.currentDayOffDate === input.desiredDayOffDate) return "A nova data não pode ser igual à data atual.";
  }
  if (dayOffKind === "DAY_OFF_SELL") {
    if (!input.dayOffToSellDate) return "Data da folga que deseja vender é obrigatória.";
    if (!input.availabilityShift?.trim() && (!input.preferredStartTime || !input.preferredEndTime)) return "Informe o turno desejado ou disponibilidade de horário.";
    if (!input.justification?.trim()) return "Justificativa é obrigatória.";
    if (!input.acknowledgement) return "Confirme a ciência de que a venda de folga depende de aprovação.";
  }
  if (dayOffKind === "DAY_OFF_REQUEST") {
    const targetDate = input.desiredDayOffRequestDate || input.desiredDayOffDate || input.requestedDate;
    if (!targetDate) return "Data desejada para folga é obrigatória.";
    if (!input.dayOffReason?.trim()) return "Motivo da solicitação é obrigatório.";
    if (!input.justification?.trim()) return "Justificativa é obrigatória.";
  }

  return "";
}

function payloadForInput(input: CreateRequestInput) {
  const dayOffKind = normalizeDayOffKind(input);
  return {
    internalType: dayOffKind,
    dayOffKind,
    requestedDate: input.requestedDate || null,
    currentDayOffDate: input.currentDayOffDate || null,
    desiredDayOffDate: input.desiredDayOffDate || null,
    dayOffToSellDate: input.dayOffToSellDate || null,
    availabilityShift: input.availabilityShift || null,
    preferredStartTime: input.preferredStartTime || null,
    preferredEndTime: input.preferredEndTime || null,
    acknowledgement: input.acknowledgement ?? null,
    desiredDayOffRequestDate: input.desiredDayOffRequestDate || input.requestedDate || null,
    dayOffReason: input.dayOffReason || null,
    urgency: input.urgency || input.priority || null,
    justification: input.justification || null,
    attachmentUrl: input.attachmentUrl || null,
    scheduleApplicationStatus: dayOffKind ? "PENDING" : null,
    scaleIntegrationPending: Boolean(dayOffKind)
  };
}

function isDayOffRequest(value: CreateRequestInput | PrismaRequest | string) {
  return Boolean(normalizeDayOffKind(value));
}

function normalizeDayOffKind(value: CreateRequestInput | PrismaRequest | string | null | undefined): DayOffKind | null {
  if (!value) return null;
  const payload = typeof value === "string" ? {} : ((value as PrismaRequest).payload ?? {}) as Record<string, unknown>;
  const typeName =
    typeof value === "string"
      ? value
      : "type" in value && typeof (value as PrismaRequest).type === "object"
        ? (value as PrismaRequest).type.name
        : (value as CreateRequestInput).type;
  const raw = String(payload.dayOffKind ?? payload.internalType ?? (value as CreateRequestInput).dayOffKind ?? "");
  if ((dayOffKinds as readonly string[]).includes(raw)) return raw as DayOffKind;
  if (/venda de folga|vender folga/i.test(typeName)) return "DAY_OFF_SELL";
  if (/solicita(ç|c)[aã]o de dia de folga|dia de folga|folga solicitada/i.test(typeName)) return "DAY_OFF_REQUEST";
  if (/troca de folga|trocar folga/i.test(typeName)) return "DAY_OFF_SWAP";
  return null;
}

function dayOffTypeLabel(kind: DayOffKind) {
  if (kind === "DAY_OFF_SELL") return "Venda de Folga";
  if (kind === "DAY_OFF_REQUEST") return "Solicitação de Dia de Folga";
  return "Troca de Folga";
}

async function validateDayOffRequestInDatabase(employeeId: string, input: CreateRequestInput) {
  const kind = normalizeDayOffKind(input);
  if (!kind) return "";

  const employeeScheduleCount = await prisma.schedule.count({ where: { employeeId } });
  const findSchedule = async (value: string | undefined) => {
    const date = parseDateOnly(value);
    if (!date) return { date: null, schedule: null };
    const schedule = await prisma.schedule.findUnique({ where: { employeeId_date: { employeeId, date } } });
    return { date, schedule };
  };

  if (kind === "DAY_OFF_SWAP") {
    const current = await findSchedule(input.currentDayOffDate);
    const desired = await findSchedule(input.desiredDayOffDate);
    if (!current.date || !desired.date) return "Datas da troca de folga inválidas.";
    if (employeeScheduleCount && !current.schedule) return "Data atual da folga fora do período de cronograma carregado.";
    if (employeeScheduleCount && !desired.schedule) return "Nova data desejada fora do período de cronograma carregado.";
    if (current.schedule && current.schedule.status !== "FOLGA") return "A data atual informada não está registrada como folga para este colaborador.";
    if (desired.schedule && desired.schedule.status === "FOLGA") return "A nova data desejada já está registrada como folga.";
    return duplicateDayOffRequest(employeeId, kind, { currentDayOffDate: input.currentDayOffDate, desiredDayOffDate: input.desiredDayOffDate });
  }

  if (kind === "DAY_OFF_SELL") {
    const target = await findSchedule(input.dayOffToSellDate);
    if (!target.date) return "Data da folga que deseja vender inválida.";
    if (employeeScheduleCount && !target.schedule) return "Data da folga fora do período de cronograma carregado.";
    if (target.schedule && target.schedule.status !== "FOLGA") return "A data selecionada não está registrada como folga.";
    return duplicateDayOffRequest(employeeId, kind, { dayOffToSellDate: input.dayOffToSellDate });
  }

  const targetDate = input.desiredDayOffRequestDate || input.desiredDayOffDate || input.requestedDate;
  const target = await findSchedule(targetDate);
  if (!target.date) return "Data desejada para folga inválida.";
  if (employeeScheduleCount && !target.schedule) return "Data desejada fora do período de cronograma carregado.";
  if (target.schedule && target.schedule.status === "FOLGA") return "A data desejada já está registrada como folga.";
  return duplicateDayOffRequest(employeeId, kind, { desiredDayOffRequestDate: targetDate });
}

async function duplicateDayOffRequest(employeeId: string, kind: DayOffKind, expected: Record<string, unknown>) {
  const candidates = await prisma.request.findMany({
    where: {
      employeeId,
      type: { name: dayOffTypeLabel(kind) },
      status: { in: [...pendingStatuses] }
    },
    take: 20
  });

  const duplicate = candidates.some((request) => {
    const payload = (request.payload ?? {}) as Record<string, unknown>;
    return Object.entries(expected).every(([key, value]) => String(payload[key] ?? "") === String(value ?? ""));
  });

  return duplicate ? "Já existe uma solicitação de folga pendente para esta data." : "";
}

async function applyDayOffRequestToSchedule(tx: Prisma.TransactionClient, request: PrismaRequest, actorId: string, actionInput: RequestStatusActionInput) {
  const kind = normalizeDayOffKind(request);
  if (!kind) return { updated: false, message: "" };
  const payload = (request.payload ?? {}) as Record<string, unknown>;
  if (payload.scheduleAppliedAt) throw new DomainError("Esta solicitação já teve o cronograma aplicado.");
  if (!request.employeeId) throw new DomainError("Solicitação sem colaborador vinculado para aplicar cronograma.");

  const employee = await tx.employeeProfile.findUnique({ where: { id: request.employeeId }, include: { shift: true } });
  if (!employee) throw new DomainError("Colaborador não encontrado para aplicar cronograma.");

  if (kind === "DAY_OFF_SWAP") return applySwapSchedule(tx, request, employee, actorId, payload);
  if (kind === "DAY_OFF_SELL") return applySellSchedule(tx, request, employee, actorId, payload, actionInput);
  return applyRequestedDayOffSchedule(tx, request, employee, actorId, payload);
}

async function applySwapSchedule(tx: Prisma.TransactionClient, request: PrismaRequest, employee: { id: string; shiftId: string; lobId: string; supervisorId: string | null }, actorId: string, payload: Record<string, unknown>) {
  const currentDate = parseDateOnly(payload.currentDayOffDate ?? payload.dataAtual);
  const desiredDate = parseDateOnly(payload.desiredDayOffDate ?? payload.dataDesejada);
  if (!currentDate || !desiredDate) throw new DomainError("Datas da troca de folga inválidas.");

  const current = await tx.schedule.findUnique({ where: { employeeId_date: { employeeId: employee.id, date: currentDate } }, include: { shift: true } });
  const desired = await tx.schedule.findUnique({ where: { employeeId_date: { employeeId: employee.id, date: desiredDate } }, include: { shift: true } });
  if (!current || !desired) throw new DomainError("Cronograma não encontrado para as duas datas da troca.");
  if (current.status !== "FOLGA") throw new DomainError("A data atual não está como folga no cronograma.");
  if (desired.status === "FOLGA") throw new DomainError("A nova data desejada já está como folga.");

  const before = { current: serialize(current), desired: serialize(desired) };

  const currentAfter = await tx.schedule.upsert({
    where: { employeeId_date: { employeeId: employee.id, date: currentDate } },
    update: {
      shiftId: desired.shiftId,
      startsAt: desired.startsAt,
      endsAt: desired.endsAt,
      status: desired.status,
      observation: `Troca de folga aprovada pela solicitação ${request.code}`
    },
    create: {
      employeeId: employee.id,
      shiftId: desired.shiftId,
      date: currentDate,
      startsAt: desired.startsAt,
      endsAt: desired.endsAt,
      status: desired.status,
      source: "day-off-swap",
      lobId: employee.lobId,
      supervisorId: employee.supervisorId,
      observation: `Troca de folga aprovada pela solicitação ${request.code}`
    }
  });

  const desiredAfter = await tx.schedule.upsert({
    where: { employeeId_date: { employeeId: employee.id, date: desiredDate } },
    update: {
      shiftId: null,
      startsAt: null,
      endsAt: null,
      status: "FOLGA",
      observation: `Nova folga aprovada pela solicitação ${request.code}`
    },
    create: {
      employeeId: employee.id,
      shiftId: null,
      date: desiredDate,
      startsAt: null,
      endsAt: null,
      status: "FOLGA",
      source: "day-off-swap",
      lobId: employee.lobId,
      supervisorId: employee.supervisorId,
      observation: `Nova folga aprovada pela solicitação ${request.code}`
    }
  });

  await tx.scheduleChangeHistory.create({
    data: {
      scheduleId: currentAfter.id,
      employeeId: employee.id,
      changedById: actorId,
      date: currentDate,
      before: before.current,
      after: serialize(currentAfter),
      previousValue: before.current,
      newValue: serialize(currentAfter),
      reason: `Troca de folga aprovada pela solicitação ${request.code}`
    }
  });
  await tx.scheduleChangeHistory.create({
    data: {
      scheduleId: desiredAfter.id,
      employeeId: employee.id,
      changedById: actorId,
      date: desiredDate,
      before: before.desired,
      after: serialize(desiredAfter),
      previousValue: before.desired,
      newValue: serialize(desiredAfter),
      reason: `Troca de folga aprovada pela solicitação ${request.code}`
    }
  });

  return { updated: true, message: "Troca de folga aplicada no cronograma." };
}

async function applySellSchedule(tx: Prisma.TransactionClient, request: PrismaRequest, employee: { id: string; shiftId: string; lobId: string; supervisorId: string | null; shift: { id: string; name: string; startsAt: string; endsAt: string } }, actorId: string, payload: Record<string, unknown>, actionInput: RequestStatusActionInput) {
  const targetDate = parseDateOnly(payload.dayOffToSellDate);
  if (!targetDate) throw new DomainError("Data da venda de folga inválida.");
  const schedule = await tx.schedule.findUnique({ where: { employeeId_date: { employeeId: employee.id, date: targetDate } }, include: { shift: true } });
  if (!schedule) throw new DomainError("Cronograma não encontrado para a data da venda de folga.");
  if (schedule.status !== "FOLGA") throw new DomainError("A data selecionada não está como folga.");

  const shiftName = cleanShiftName(actionInput.finalApprovedShift || String(payload.availabilityShift ?? employee.shift.name)) || employee.shift.name;
  const finalShift = (await tx.shift.findFirst({ where: { OR: [{ name: shiftName }, { name: { startsWith: `${shiftName} (` } }] } })) ?? employee.shift;
  const before = serialize(schedule);
  const after = await tx.schedule.update({
    where: { id: schedule.id },
    data: {
      shiftId: finalShift.id,
      startsAt: actionInput.finalApprovedStartTime || String(payload.preferredStartTime ?? "") || finalShift.startsAt,
      endsAt: actionInput.finalApprovedEndTime || String(payload.preferredEndTime ?? "") || finalShift.endsAt,
      status: "ESCALADO",
      source: "day-off-sell",
      observation: `Venda de folga aprovada pela solicitação ${request.code}`
    }
  });

  await tx.scheduleChangeHistory.create({
    data: {
      scheduleId: after.id,
      employeeId: employee.id,
      changedById: actorId,
      date: targetDate,
      before,
      after: serialize(after),
      previousValue: before,
      newValue: serialize(after),
      reason: `Venda de folga aprovada pela solicitação ${request.code}`
    }
  });
  return { updated: true, message: "Venda de folga aplicada no cronograma." };
}

async function applyRequestedDayOffSchedule(tx: Prisma.TransactionClient, request: PrismaRequest, employee: { id: string }, actorId: string, payload: Record<string, unknown>) {
  const targetDate = parseDateOnly(payload.desiredDayOffRequestDate ?? payload.desiredDayOffDate ?? payload.requestedDate);
  if (!targetDate) throw new DomainError("Data desejada para folga inválida.");
  const schedule = await tx.schedule.findUnique({ where: { employeeId_date: { employeeId: employee.id, date: targetDate } }, include: { shift: true } });
  if (!schedule) throw new DomainError("Cronograma não encontrado para a data desejada.");
  if (schedule.status === "FOLGA") throw new DomainError("A data desejada já está como folga.");

  const before = serialize(schedule);
  const after = await tx.schedule.update({
    where: { id: schedule.id },
    data: {
      shiftId: null,
      startsAt: null,
      endsAt: null,
      status: "FOLGA",
      source: "day-off-request",
      observation: `Folga aprovada pela solicitação ${request.code}`
    }
  });

  await tx.scheduleChangeHistory.create({
    data: {
      scheduleId: after.id,
      employeeId: employee.id,
      changedById: actorId,
      date: targetDate,
      before,
      after: serialize(after),
      previousValue: before,
      newValue: serialize(after),
      reason: `Dia de folga aprovado pela solicitação ${request.code}`
    }
  });
  return { updated: true, message: "Dia de folga aplicado no cronograma." };
}

function parseDateOnly(value: unknown) {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function areaForRequest(type: string) {
  if (/equipamento|acesso|suporte/i.test(type)) return /equipamento/i.test(type) ? "TI" : "Operações";
  if (/rh/i.test(type)) return "RH";
  if (/qualidade/i.test(type)) return "Qualidade";
  if (/wfm|escala|folga|correção|correcao|ajuste/i.test(type)) return "WFM";
  return "Operações";
}

function actionForStatus(status: UiRequestStatus) {
  const map: Record<UiRequestStatus, string> = {
    Aberto: "Criação",
    "Em análise": "Análise iniciada",
    Aprovado: "Aprovação",
    Recusado: "Recusa",
    Concluído: "Conclusão",
    Cancelado: "Cancelamento"
  };
  return map[status];
}

function auditActionForStatus(status: UiRequestStatus) {
  if (status === "Aprovado") return "APROVACAO";
  if (status === "Recusado") return "RECUSA";
  return "EDICAO";
}

function notificationTitleForStatus(status: UiRequestStatus, type: string) {
  if (isDayOffRequest(type) && status === "Aprovado") return `${type} aprovada`;
  if (isDayOffRequest(type) && status === "Recusado") return "Sua solicitação de folga foi recusada";
  return `Solicitação ${status.toLowerCase()}`;
}

function notificationBodyForStatus(status: UiRequestStatus, type: string, reason?: string, scheduleMessage?: string) {
  if (isDayOffRequest(type) && status === "Aprovado") {
    if (/venda/i.test(type)) return "Sua venda de folga foi aprovada e seu cronograma foi atualizado.";
    if (/dia de folga/i.test(type)) return "Sua solicitação de folga foi aprovada e seu cronograma foi atualizado.";
    return "Sua troca de folga foi aprovada e seu cronograma foi atualizado.";
  }
  if (isDayOffRequest(type) && status === "Recusado") return reason ? `Sua solicitação de folga foi recusada. Motivo: ${reason}` : "Sua solicitação de folga foi recusada.";
  return reason ?? scheduleMessage ?? `${type} atualizada para ${status}.`;
}

function finalApprovalTitle(type: string) {
  if (/venda/i.test(type)) return "Sua venda de folga foi aprovada";
  if (/dia de folga/i.test(type)) return "Sua solicitação de folga foi aprovada";
  if (/folga/i.test(type)) return "Sua troca de folga foi aprovada";
  return "Solicitação aprovada";
}

function finalApprovalBody(type: string) {
  if (/venda/i.test(type)) return "Sua venda de folga foi aprovada e seu cronograma foi atualizado.";
  if (/dia de folga/i.test(type)) return "Sua solicitação de folga foi aprovada e seu cronograma foi atualizado.";
  if (/folga/i.test(type)) return "Sua troca de folga foi aprovada e seu cronograma foi atualizado.";
  return "Sua solicitação foi aprovada.";
}

async function notifyApprovers(
  tx: Prisma.TransactionClient,
  requestId: string,
  code: string,
  type: string,
  requesterName: string,
  area: string,
  supervisorId?: string | null
) {
  const roleNames = isDayOffRequest(type) ? ["ADMIN", "GESTOR"] : area === "WFM" ? ["ADMIN", "GESTOR", "WFM"] : area === "RH" ? ["ADMIN", "GESTOR", "RH"] : area === "TI" ? ["ADMIN", "GESTOR", "TI"] : ["ADMIN", "GESTOR", "WFM"];
  const users = await tx.user.findMany({ where: { status: "ACTIVE", role: { name: { in: roleNames } } } });
  const supervisor = supervisorId ? await tx.employeeProfile.findUnique({ where: { id: supervisorId }, include: { user: true } }) : null;
  const recipients = new Map(users.map((user) => [user.id, user]));
  if (supervisor?.user) recipients.set(supervisor.user.id, supervisor.user);

  for (const user of recipients.values()) {
    await tx.notification.create({
      data: {
        userId: user.id,
        title: isDayOffRequest(type) ? "Nova solicitação de folga" : "Nova solicitação",
        body: isDayOffRequest(type) ? `${dayOffApproverMessage(type)} aguardando análise.` : `${type} aberta por ${requesterName}.`,
        category: "Solicitações",
        type: "APPROVAL",
        entity: "Request",
        entityId: requestId,
        href: `/esteiras?request=${code}`
      }
    });
  }
}

async function notifyWfmApprovers(tx: Prisma.TransactionClient, requestId: string, code: string, type: string, requesterName: string) {
  const users = await tx.user.findMany({
    where: { status: "ACTIVE", role: { name: { in: ["ADMIN", "GESTOR", "WFM"] } } }
  });

  for (const user of users) {
    await tx.notification.create({
      data: {
        userId: user.id,
        title: "Solicitação aguardando WFM",
        body: `${dayOffApproverMessage(type)} de ${requesterName} foi aprovada pelo supervisor e aguarda análise final.`,
        category: "Solicitações",
        type: "APPROVAL",
        entity: "Request",
        entityId: requestId,
        href: `/esteiras?request=${code}`
      }
    });
  }
}

async function notifyRequestSupervisor(tx: Prisma.TransactionClient, request: PrismaRequest, title?: string, body?: string) {
  if (!title || !body || !request.employee?.supervisorId) return;
  const supervisor = await tx.employeeProfile.findUnique({
    where: { id: request.employee.supervisorId },
    include: { user: true }
  });
  if (!supervisor?.userId || supervisor.userId === request.requesterId) return;

  await tx.notification.create({
    data: {
      userId: supervisor.userId,
      title,
      body,
      category: "Solicitações",
      type: "REQUEST",
      entity: "Request",
      entityId: request.id,
      href: `/esteiras?request=${request.code}`
    }
  });
}

function dayOffApproverMessage(type: string) {
  if (/venda/i.test(type)) return "Nova solicitação de venda de folga";
  if (/dia de folga/i.test(type)) return "Nova solicitação de dia de folga";
  return "Nova solicitação de troca de folga";
}

function serialize(value: unknown) {
  return value ? JSON.parse(JSON.stringify(value)) : {};
}

async function nextRequestCode(tx: Prisma.TransactionClient) {
  const count = await tx.request.count();
  return `REQ-${String(1001 + count).padStart(4, "0")}`;
}

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}
