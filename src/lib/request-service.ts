import { AuditAction, Prisma, type ScheduleStatus } from "@prisma/client";

import type { Actor, Priority as UiPriority, RequestRecord, RequestStatus as UiRequestStatus } from "@/lib/mock-db";
import {
  addRequestComment as addMockRequestComment,
  createRequest as createMockRequest,
  listRequests as listMockRequests,
  recordErrorLog,
  updateRequestStatus as updateMockRequestStatus
} from "@/lib/mock-db";
import { applyApprovedMonthlyAdvanceChange, isMonthlyAdvanceRequestPayload } from "@/lib/monthly-advance-service";
import { roleHasCapability } from "@/lib/access-control";
import { isAgentJobTitle } from "@/lib/job-title-normalization";
import { prisma } from "@/lib/prisma";
import { nextRequestCode } from "@/lib/request-code";
import { canApproveRequest, normalizeRole } from "@/lib/permissions";
import { baseTimesForShift } from "@/lib/shift-base-times";
import { isProjectExcludedFromAdsCoverage } from "@/lib/coverage-lob-rules";
import { cleanShiftName, shiftCategoryName } from "@/lib/shift-display";
import { isShiftChangeEffective } from "@/lib/shift-change-effective-service";

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
const wfmFinalRoles = ["ADMIN", "WFM"];
const supervisorStepRoles = ["ADMIN", "GESTOR", "SUPERVISOR"];
const terminalFlowStatuses = ["APROVADO", "CONCLUIDO", "RECUSADO", "CANCELADO"] as const;
const allowDemoDataFallback = process.env.ALLOW_DEMO_LOGIN === "true" || process.env.ALLOW_DEMO_DATA === "true";
const productiveShiftCategories = ["Manhã", "Tarde", "Noite"] as const;
const coverageStatuses = new Set<ScheduleStatus>(["ESCALADO", "PRESENTE", "ATRASO", "SAIDA_ANTECIPADA", "VENDA_FOLGA_APROVADA"]);
const dayOffScheduleStatuses = new Set<ScheduleStatus>(["FOLGA", "FOLGA_APROVADA"]);
const sellableDayOffScheduleStatuses = new Set<ScheduleStatus>(["FOLGA", "FOLGA_APROVADA", "TROCA_APROVADA"]);
const inactiveCoverageEmployeeStatuses = new Set([
  "inativo",
  "inativa",
  "inactive",
  "desativado",
  "desativada",
  "disabled",
  "desligado",
  "desligada",
  "terminated",
  "suspenso",
  "suspensa",
  "suspended",
  "em treinamento",
  "treinamento",
  "training",
  "nesting"
]);

class DomainError extends Error {}

type RequestServiceError = {
  error: string;
  message?: string;
  type?: string;
  fieldErrors?: Record<string, string>;
  details?: Record<string, unknown>;
  status?: number;
};

type CoverageImpactResult = "IMPROVES" | "WORSENS" | "NEUTRAL" | "NO_REQUIREMENT" | "NO_SCHEDULE";
type CoverageImpactStatus = "IMPACTA" | "NAO_IMPACTA" | "SEM_REQUERIDO";
type CoverageImpactDirection = "MELHORA" | "PIORA" | "NEUTRO";

type CoverageImpactRow = {
  date: string;
  label: string;
  lob: string;
  lobId?: string;
  shift: string;
  shiftId?: string;
  required: number | null;
  currentAvailable: number;
  currentGap: number | null;
  impactDelta: number;
  projectedAvailable: number;
  projectedGap: number | null;
  impactStatus: CoverageImpactStatus;
  impactDirection: CoverageImpactDirection;
  result: CoverageImpactResult;
  message?: string;
};

type CoverageImpactSummary = {
  requestId: string;
  requestType: string;
  impactStatus: CoverageImpactStatus;
  impactDirection: CoverageImpactDirection;
  impacts: CoverageImpactRow[];
  hasCriticalWarning: boolean;
  badgeLabel: string;
  badgeTone: "red" | "green" | "blue" | "slate" | "orange";
  summary: string;
};

type RequestNotificationClient = Pick<Prisma.TransactionClient, "user" | "employeeProfile" | "notification">;

export type RequestFilters = {
  type?: string;
  status?: string;
  priority?: string;
  requester?: string;
  assignee?: string;
  assignedTo?: string;
  date?: string;
  startDate?: string;
  endDate?: string;
  lob?: string;
  supervisor?: string;
  supervisorId?: string;
  collaborator?: string;
  employeeId?: string;
  wbLogin?: string;
  search?: string;
  pendingAction?: string | boolean;
  scope?: "mine" | "all";
  page?: string | number;
  limit?: string | number;
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
  monthlyAdvanceReferenceMonth?: string;
  currentAdvanceOptIn?: boolean;
  requestedAdvanceOptIn?: boolean;
  currentAdvanceAmount?: number;
  requestedAdvanceAmount?: number;
  monthlyAdvanceReason?: string;
  shiftChangeType?: string;
  shiftChangeDate?: string;
  shiftChangeStartDate?: string;
  shiftChangeEndDate?: string;
  currentShift?: string;
  desiredShift?: string;
  shiftChangeReason?: string;
  shiftChangeObservation?: string;
};

export type RequestStatusActionInput = {
  finalApprovedShift?: string;
  finalApprovedStartTime?: string;
  finalApprovedEndTime?: string;
  confirmCoverageWarning?: boolean | string;
};

export async function listOperationalRequests(actor: Actor, filters: RequestFilters = {}) {
  try {
    const user = await findActiveUser(actor.email);
    if (!user) {
      const fallback = allowDemoDataFallback ? listMockRequests(actor) : [];
      return paginatedRequestResult(fallback, filters);
    }

    const where: Prisma.RequestWhereInput = buildRequestWhere(actor, user, filters);
    const page = parsePositiveInteger(filters.page, 1);
    const limit = parseRequestLimit(filters.limit);
    const skip = (page - 1) * limit;
    const summaryWhere = buildRequestWhere(actor, user, { ...filters, status: "Todos", page: 1 });

    const [total, requests, summary, supervisors] = await Promise.all([
      prisma.request.count({ where }),
      prisma.request.findMany({
        where,
        include: requestListInclude,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit
      }),
      summarizeRequests(summaryWhere),
      listRequestSupervisors()
    ]);
    const totalPages = Math.max(1, Math.ceil(total / limit));

    return {
      data: await Promise.all(requests.map((request) => mapPrismaRequestWithImpact(request, user, actor))),
      total,
      page,
      limit,
      totalPages,
      summary,
      supervisors
    };
  } catch (error) {
    recordErrorLog({
      userEmail: actor.email,
      code: "REQUEST_LIST_DB_FALLBACK",
      message: error instanceof Error ? error.message : "Falha ao listar solicitações no banco",
      route: "/api/requests",
      action: "REQUEST_LIST",
      severity: "WARNING"
    });
    const fallback = allowDemoDataFallback ? listMockRequests(actor) : [];
    return paginatedRequestResult(fallback, filters);
  }
}

export async function getOperationalRequest(actor: Actor, id: string) {
  try {
    const user = await findActiveUser(actor.email);
    if (!user && allowDemoDataFallback) {
      return listMockRequests(actor).find((request) => request.id === id) ?? null;
    }
    if (!user) return null;

    const request = await prisma.request.findFirst({
      where: { deletedAt: null, OR: [{ id }, { code: id }] },
      include: requestInclude
    });
    if (!request || !canViewRequest(actor, user, request)) return null;
    return mapPrismaRequestWithImpact(request, user, actor);
  } catch (error) {
    recordErrorLog({
      userEmail: actor.email,
      code: "REQUEST_DETAIL_DB_ERROR",
      message: error instanceof Error ? error.message : "Falha ao carregar detalhe da solicitação",
      route: "/api/requests",
      action: "REQUEST_DETAIL",
      severity: "WARNING"
    });
    return null;
  }
}

export async function createOperationalRequest(actor: Actor, input: CreateRequestInput) {
  const validationError = validateCreateInput(input);
  if (validationError) return validationFailure(validationError);

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
    const requesterProfile = await resolveRequesterEmployeeProfile(user);
    if (isDayOffRequest(input) && !requesterProfile) {
      return validationFailure("Seu usuário não está vinculado a um cadastro de parceiro. Contate o administrador.", {
        employeeId: "Parceiro não vinculado ao usuário logado."
      });
    }
    if (isDayOffRequest(input) && requesterProfile?.id) {
      const dayOffError = await validateDayOffRequestInDatabase(requesterProfile.id, input);
      if (dayOffError) return { error: dayOffError };
    }
    if (isMonthlyAdvanceRequest(input) && !requesterProfile) {
      return validationFailure("Seu usuário não está vinculado a um cadastro de parceiro. Contate o administrador.", {
        employeeId: "Parceiro não vinculado ao usuário logado."
      });
    }
    if (isShiftChangeRequest(input) && !requesterProfile) {
      return validationFailure("Seu usuário não está vinculado a um cadastro de parceiro. Contate o administrador.", {
        employeeId: "Parceiro não vinculado ao usuário logado."
      });
    }
    if (isShiftChangeRequest(input) && requesterProfile?.id) {
      const shiftChangeError = await validateShiftChangeRequestInDatabase(requesterProfile.id, input);
      if (shiftChangeError) return { error: shiftChangeError };
    }

    const type = await prisma.requestType.findUnique({
      where: { name: input.type },
      select: { id: true }
    });
    if (!type) {
      return validationFailure(`Tipo de solicitação "${input.type}" não está configurado. Rode o seed de produção antes de usar este fluxo.`, {
        type: "Tipo de solicitação não encontrado."
      }, {
        seedCommand: "npm run db:seed:prod"
      });
    }

    const request = await prisma.$transaction(async (tx) => {
      const created = await tx.request.create({
        data: {
          code: await nextRequestCode(tx),
          title: input.title,
          description: input.description,
          requesterId: user.id,
          employeeId: requesterProfile?.id,
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

      return created;
    });

    await notifyRequestCreationSafely(request.id, request.code, input.type, user.id, user.name, area, requesterProfile?.supervisorId, actor.email);

    return { data: await mapPrismaRequestWithImpact(request, user, actor), persisted: true };
  } catch (error) {
    const mapped = mapRequestCreateError(error);
    recordErrorLog({
      userEmail: actor.email,
      code: "REQUEST_CREATE_DB_FALLBACK",
      message: error instanceof Error ? error.message : mapped.error,
      route: "/api/requests",
      action: "REQUEST_CREATE",
      severity: "ERROR"
    });
    if (!allowDemoDataFallback) return mapped;
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

  const diagnostics: Record<string, unknown> = {
    requestId: id,
    targetStatus: status,
    actorRole: actor.role
  };

  try {
    const user = await findActiveUser(actor.email);
    if (!user && allowDemoDataFallback) {
      const result = updateMockRequestStatus(actor, id, status, reason, actionInput);
      if (!result || result === "FORBIDDEN") return result;
      if ("record" in result) return { data: result.record, scheduleUpdated: result.scheduleUpdated, persisted: false };
      return { error: result.error };
    }
    if (!user) return "FORBIDDEN" as const;
    diagnostics.userId = user.id;
    diagnostics.normalizedRole = normalizeRole(actor.role);

    const existing = await prisma.request.findFirst({
      where: { OR: [{ id }, { code: id }] },
      include: requestInclude
    });

    if (!existing) return null;
    diagnostics.currentStatus = existing.status;
    diagnostics.type = existing.type.name;
    diagnostics.employeeId = existing.employeeId;
    diagnostics.requesterId = existing.requesterId;
    const initialTransition = resolveRequestTransition(actor, user, existing, status);
    if (initialTransition === "FORBIDDEN") return "FORBIDDEN" as const;
    if ("error" in initialTransition) return initialTransition;

    const coverageImpact =
      shouldCheckCoverageWarning(existing, initialTransition)
        ? await calculateCoverageImpactForRequestData(existing, actionInput)
        : null;
    if (coverageImpact?.hasCriticalWarning && !isCoverageWarningConfirmed(actionInput)) {
      return coverageWarningFailure(coverageImpact);
    }

    if (isSupervisorSendToWfm(actor, existing, initialTransition)) {
      return sendSupervisorRequestToWfmAnalysis(actor, user, existing, initialTransition, reason, diagnostics, coverageImpact);
    }

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
      const advanceResult =
        transition.applyMonthlyAdvance && isMonthlyAdvanceRequest(current)
          ? await applyApprovedMonthlyAdvanceChange(tx, current, user.id)
          : { updated: false, message: "" };
      const shiftChangeResult =
        transition.applyShiftChange && isShiftChangeRequest(current)
          ? await applyShiftChangeRequestToSchedule(tx, current, user.id)
          : {
              updated: false,
              message: "",
              applicationStatus: "NOT_APPLIED",
              appliedAt: null,
              scheduledFor: null,
              profileUpdated: false
            } satisfies ShiftChangeApplicationResult;

      const shouldUpdatePayload = transition.applySchedule && isDayOffRequest(current);
      const shouldUpdateAdvancePayload = transition.applyMonthlyAdvance && isMonthlyAdvanceRequest(current);
      const shouldUpdateShiftPayload = transition.applyShiftChange && isShiftChangeRequest(current);
      const saved = await tx.request.update({
        where: { id: current.id },
        data: {
          status: transition.nextStatus,
          updatedAt: new Date(),
          ...(shouldUpdatePayload
            ? { payload: {
                ...((current.payload ?? {}) as Prisma.InputJsonObject),
                scheduleAppliedAt: new Date().toISOString(),
                scheduleAppliedById: user.id,
                scheduleApplicationStatus: scheduleResult.updated ? "APPLIED" : "NOT_APPLIED",
                scheduleApplicationError: scheduleResult.updated ? null : scheduleResult.message,
                finalApprovedShift: actionInput.finalApprovedShift ?? null,
                finalApprovedStartTime: actionInput.finalApprovedStartTime ?? null,
                finalApprovedEndTime: actionInput.finalApprovedEndTime ?? null
              } }
            : shouldUpdateAdvancePayload
              ? { payload: {
                  ...((current.payload ?? {}) as Prisma.InputJsonObject),
                  monthlyAdvanceAppliedAt: new Date().toISOString(),
                  monthlyAdvanceAppliedById: user.id,
                  monthlyAdvanceApplicationStatus: advanceResult.updated ? "APPLIED" : "NOT_APPLIED",
                  monthlyAdvanceApplicationMessage: advanceResult.message || null
                } }
              : shouldUpdateShiftPayload
                ? { payload: {
                    ...((current.payload ?? {}) as Prisma.InputJsonObject),
                    shiftChangeApprovedAt: new Date().toISOString(),
                    shiftChangeApprovedById: user.id,
                    shiftChangeAppliedAt: shiftChangeResult.appliedAt,
                    shiftChangeAppliedById: shiftChangeResult.profileUpdated ? user.id : null,
                    shiftChangeApplicationStatus: shiftChangeResult.applicationStatus,
                    shiftChangeApplicationMessage: shiftChangeResult.message || null,
                    shiftChangeScheduledFor: shiftChangeResult.scheduledFor
                  } }
            : {}),
          history: {
            create: {
              actorId: user.id,
              action: transition.historyAction,
              from: current.status,
              to: transition.nextStatus,
              reason,
              metadata:
                transition.applySchedule && isDayOffRequest(current)
                  ? { scheduleUpdated: scheduleResult.updated, scheduleMessage: scheduleResult.message }
                  : shouldUpdateAdvancePayload
                    ? { monthlyAdvanceUpdated: advanceResult.updated, monthlyAdvanceMessage: advanceResult.message }
                    : shouldUpdateShiftPayload
                      ? {
                          shiftChangeUpdated: shiftChangeResult.profileUpdated,
                          shiftChangeScheduled: shiftChangeResult.applicationStatus === "SCHEDULED",
                          shiftChangeStatus: shiftChangeResult.applicationStatus,
                          shiftChangeMessage: shiftChangeResult.message
                        }
                    : undefined
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
      if (transition.applyMonthlyAdvance && isMonthlyAdvanceRequest(current) && advanceResult.updated) {
        await tx.requestHistory.create({
          data: {
            requestId: saved.id,
            actorId: user.id,
            action: "Adiantamento atualizado",
            from: transition.nextStatus,
            to: transition.nextStatus,
            reason: advanceResult.message,
            metadata: { monthlyAdvanceUpdated: true }
          }
        });
      }
      if (transition.applyShiftChange && isShiftChangeRequest(current) && shiftChangeResult.updated) {
        await tx.requestHistory.create({
          data: {
            requestId: saved.id,
            actorId: user.id,
            action: shiftChangeResult.applicationStatus === "SCHEDULED" ? "Turno agendado" : "Turno atualizado",
            from: transition.nextStatus,
            to: transition.nextStatus,
            reason: shiftChangeResult.message,
            metadata: {
              shiftChangeUpdated: shiftChangeResult.profileUpdated,
              shiftChangeScheduled: shiftChangeResult.applicationStatus === "SCHEDULED",
              shiftChangeStatus: shiftChangeResult.applicationStatus,
              shiftChangeScheduledFor: shiftChangeResult.scheduledFor
            }
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

      if (coverageImpact?.hasCriticalWarning && isCoverageWarningConfirmed(actionInput)) {
        await tx.auditLog.create({
          data: coverageWarningAuditData(user.id, current, coverageImpact)
        });
      }

      return saved;
    }, { maxWait: 10000, timeout: 15000 });

    await notifyRequestStatusChangeSafely(updated, user.id, reason, actor.email);

    const historyMetadata = updated.history[0]?.metadata as { scheduleUpdated?: boolean; shiftChangeUpdated?: boolean } | null;
    return { data: await mapPrismaRequestWithImpact(updated, user, actor), scheduleUpdated: Boolean(historyMetadata?.scheduleUpdated || historyMetadata?.shiftChangeUpdated), persisted: true };
  } catch (error) {
    if (error instanceof DomainError) {
      return validationFailure(error.message);
    }
    recordErrorLog({
      userEmail: actor.email,
      code: "REQUEST_STATUS_DB_FALLBACK",
      message: error instanceof Error ? error.message : "Falha ao atualizar solicitação no banco",
      route: "/api/requests/status",
      action: "REQUEST_STATUS",
      severity: "ERROR",
      metadata: diagnostics
    });
    if (!allowDemoDataFallback) return mapRequestStatusError(error, diagnostics);
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
            href: `/esteiras?request=${existing.code}`
          }
        });
      }

      return tx.request.findUniqueOrThrow({ where: { id: existing.id }, include: requestInclude });
    });

    return { data: await mapPrismaRequestWithImpact(updated, user, actor), persisted: true };
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

const requestListInclude = {
  type: true,
  requester: true,
  assignee: true,
  employee: {
    include: {
      lob: true,
      supervisor: true
    }
  }
};

const requestInclude = {
  ...requestListInclude,
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
type PrismaRequestSummary = Prisma.RequestGetPayload<{ include: typeof requestListInclude }>;
type PrismaRequestForDisplay = PrismaRequest | PrismaRequestSummary;
type CoverageImpactEmployee = Prisma.EmployeeProfileGetPayload<{
  include: {
    lob: { select: { id: true; name: true } };
    shift: { select: { id: true; name: true } };
  };
}>;
type ActiveUser = NonNullable<Awaited<ReturnType<typeof findActiveUser>>>;
type DbRequestStatus = (typeof uiToDbStatus)[keyof typeof uiToDbStatus];
type NotificationKind = "INFO" | "SUCCESS" | "WARNING" | "ERROR" | "REQUEST" | "APPROVAL";
type RequestTransition =
  | "FORBIDDEN"
  | { error: string }
  | {
      nextStatus: DbRequestStatus;
      applySchedule: boolean;
      applyMonthlyAdvance?: boolean;
      applyShiftChange?: boolean;
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
type ShiftChangeApplicationResult = {
  updated: boolean;
  message: string;
  applicationStatus: "APPLIED" | "SCHEDULED" | "NOT_APPLIED";
  appliedAt: string | null;
  scheduledFor: string | null;
  profileUpdated: boolean;
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

async function resolveRequesterEmployeeProfile(user: ActiveUser) {
  if (user.employeeProfile && !user.employeeProfile.deletedAt) return user.employeeProfile;

  const byUserId = await prisma.employeeProfile.findFirst({
    where: { userId: user.id, deletedAt: null }
  });
  if (byUserId) return byUserId;

  const byUserEmail = await prisma.employeeProfile.findFirst({
    where: { user: { email: { equals: user.email, mode: "insensitive" } }, deletedAt: null }
  });
  if (byUserEmail) return byUserEmail;

  const registration = await prisma.employeeRegistrationRequest.findFirst({
    where: {
      email: { equals: user.email, mode: "insensitive" },
      createdEmployeeProfileId: { not: null },
      deletedAt: null
    },
    orderBy: { updatedAt: "desc" },
    select: { createdEmployeeProfileId: true }
  });
  if (!registration?.createdEmployeeProfileId) return null;

  const byRegistration = await prisma.employeeProfile.findFirst({
    where: { id: registration.createdEmployeeProfileId, deletedAt: null }
  });
  if (byRegistration) return byRegistration;

  const wbLoginCandidate = user.email.split("@")[0]?.trim();
  if (!wbLoginCandidate) return null;

  return prisma.employeeProfile.findFirst({
    where: { wbLogin: { equals: wbLoginCandidate, mode: "insensitive" }, deletedAt: null }
  });
}

function validationFailure(error: string, fieldErrors: Record<string, string> = {}, details: Record<string, unknown> = {}): RequestServiceError {
  return {
    error,
    message: error,
    type: "VALIDATION_ERROR",
    fieldErrors,
    details,
    status: 400
  };
}

function mapRequestCreateError(error: unknown): RequestServiceError {
  if (error instanceof DomainError) {
    return validationFailure(error.message);
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      return {
        error: "Não foi possível criar a solicitação porque já existe um registro com identificador duplicado. Tente novamente.",
        message: "Não foi possível criar a solicitação porque já existe um registro com identificador duplicado. Tente novamente.",
        type: "DUPLICATE_ERROR",
        fieldErrors: { code: "Identificador da solicitação duplicado." },
        status: 409
      };
    }
    if (error.code === "P2003") {
      return {
        error: "Não foi possível criar a solicitação porque há um vínculo obrigatório ausente ou inválido.",
        message: "Não foi possível criar a solicitação porque há um vínculo obrigatório ausente ou inválido.",
        type: "RELATION_ERROR",
        fieldErrors: { request: "Revise usuário, parceiro e tipo da solicitação." },
        status: 400
      };
    }
    if (error.code === "P2025") {
      return {
        error: "Não foi possível criar a solicitação porque um registro relacionado não foi encontrado.",
        message: "Não foi possível criar a solicitação porque um registro relacionado não foi encontrado.",
        type: "NOT_FOUND",
        fieldErrors: { request: "Registro relacionado não encontrado." },
        status: 404
      };
    }
  }
  return {
    error: "Não foi possível criar a solicitação. Tente novamente ou contate o administrador.",
    message: "Não foi possível criar a solicitação. Tente novamente ou contate o administrador.",
    type: "REQUEST_CREATE_ERROR",
    fieldErrors: {},
    status: 500
  };
}

function mapRequestStatusError(error: unknown, diagnostics: Record<string, unknown> = {}): RequestServiceError {
  const message = error instanceof Error ? error.message : "";
  if (/Unable to start a transaction|Transaction API error|transaction.*time/i.test(message)) {
    return {
      error: "Não foi possível enviar para análise do WFM por instabilidade temporária no banco. Tente novamente.",
      message: "Não foi possível enviar para análise do WFM por instabilidade temporária no banco. Tente novamente.",
      type: "TRANSACTION_TIMEOUT",
      fieldErrors: {},
      details: diagnostics,
      status: 503
    };
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2003") {
      return {
        error: "Não foi possível atualizar a solicitação porque há um vínculo obrigatório ausente ou inválido.",
        message: "Não foi possível atualizar a solicitação porque há um vínculo obrigatório ausente ou inválido.",
        type: "RELATION_ERROR",
        fieldErrors: { request: "Revise usuário, histórico, auditoria e solicitação." },
        details: { code: error.code, ...diagnostics },
        status: 400
      };
    }
    if (error.code === "P2025") {
      return {
        error: "Solicitação não encontrada.",
        message: "Solicitação não encontrada.",
        type: "NOT_FOUND",
        fieldErrors: {},
        details: { code: error.code, ...diagnostics },
        status: 404
      };
    }
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    return {
      error: "Dados inválidos para atualizar a solicitação. Verifique status, histórico e payload.",
      message: "Dados inválidos para atualizar a solicitação. Verifique status, histórico e payload.",
      type: "PRISMA_VALIDATION_ERROR",
      fieldErrors: { request: "Payload ou status inválido para o schema atual." },
      details: diagnostics,
      status: 400
    };
  }

  return {
    error: "Não foi possível atualizar a solicitação. Tente novamente ou contate o administrador.",
    message: "Não foi possível atualizar a solicitação. Tente novamente ou contate o administrador.",
    type: "REQUEST_STATUS_UPDATE_ERROR",
    fieldErrors: {},
    details: diagnostics,
    status: 500
  };
}

function buildRequestWhere(actor: Actor, user: ActiveUser, filters: RequestFilters) {
  const role = normalizeRole(actor.role);
  const where: Prisma.RequestWhereInput = { deletedAt: null };
  const andFilters: Prisma.RequestWhereInput[] = [];

  if (filters.scope === "mine" || !roleHasCapability(actor.role, "PIPELINES")) {
    where.requesterId = user.id;
  }

  if (isPendingActionFilter(filters.pendingAction)) {
    if (role === "SUPERVISOR") {
      andFilters.push({ status: "ABERTO", ...supervisorStepRequestTypeWhere() });
    } else if (role === "WFM") {
      andFilters.push({ status: { in: ["EM_ANALISE", "AGUARDANDO_APROVACAO", "AJUSTE_SOLICITADO"] } });
    } else if (roleHasCapability(actor.role, "PIPELINES")) {
      andFilters.push({ status: { in: [...pendingStatuses] } });
    }
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
  if (filters.employeeId) andFilters.push({ employeeId: filters.employeeId });
  if (filters.wbLogin) {
    andFilters.push({ employee: { wbLogin: { contains: filters.wbLogin, mode: "insensitive" } } });
  }
  if (filters.requester) {
    andFilters.push({
      OR: [
        { requester: { name: { contains: filters.requester, mode: "insensitive" } } },
        { requester: { email: { contains: filters.requester, mode: "insensitive" } } }
      ]
    });
  }
  if (filters.assignee) where.assignee = { name: { contains: filters.assignee, mode: "insensitive" } };
  if (filters.assignedTo && filters.assignedTo !== "Todos") {
    const assignedTo = filters.assignedTo.toLowerCase();
    if (assignedTo === "supervisor") {
      andFilters.push({ status: "ABERTO" });
    } else if (assignedTo === "wfm") {
      andFilters.push({ status: { in: ["EM_ANALISE", "AGUARDANDO_APROVACAO", "AJUSTE_SOLICITADO"] } });
    } else if (assignedTo === "wfm/admin") {
      andFilters.push({ status: "APROVADO" });
    } else if (assignedTo === "nenhum") {
      andFilters.push({ status: { in: ["RECUSADO", "CONCLUIDO", "CANCELADO"] } });
    } else {
      andFilters.push({ assignee: { name: { contains: filters.assignedTo, mode: "insensitive" } } });
    }
  }
  if (filters.lob && filters.lob !== "Todos") {
    andFilters.push({ employee: { lob: { name: { equals: filters.lob, mode: "insensitive" } } } });
  }
  const supervisorFilter = filters.supervisorId ?? filters.supervisor;
  if (supervisorFilter && supervisorFilter !== "Todos") {
    if (["SEM_SUPERVISOR", "NONE", "Sem supervisor"].includes(supervisorFilter)) {
      andFilters.push({
        OR: [
          { employeeId: null },
          { employee: { supervisorId: null } }
        ]
      });
    } else {
      andFilters.push({
        OR: [
          { employee: { supervisorId: supervisorFilter } },
          { employee: { supervisor: { fullName: { contains: supervisorFilter, mode: "insensitive" } } } },
          { employee: { supervisor: { wbLogin: { contains: supervisorFilter, mode: "insensitive" } } } }
        ]
      });
    }
  }
  if (filters.collaborator) {
    andFilters.push({
      OR: [
        { employee: { fullName: { contains: filters.collaborator, mode: "insensitive" } } },
        { employee: { wbLogin: { contains: filters.collaborator, mode: "insensitive" } } },
        { requester: { name: { contains: filters.collaborator, mode: "insensitive" } } },
        { requester: { email: { contains: filters.collaborator, mode: "insensitive" } } }
      ]
    });
  }
  if (filters.search?.trim()) {
    const search = filters.search.trim();
    andFilters.push({
      OR: [
        { code: { contains: search, mode: "insensitive" } },
        { title: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
        { assignedArea: { contains: search, mode: "insensitive" } },
        { type: { name: { contains: search, mode: "insensitive" } } },
        { requester: { name: { contains: search, mode: "insensitive" } } },
        { requester: { email: { contains: search, mode: "insensitive" } } },
        { employee: { fullName: { contains: search, mode: "insensitive" } } },
        { employee: { wbLogin: { contains: search, mode: "insensitive" } } }
      ]
    });
  }
  if (filters.date) {
    const start = new Date(`${filters.date}T00:00:00`);
    const end = new Date(`${filters.date}T23:59:59`);
    if (!Number.isNaN(start.getTime())) where.createdAt = { gte: start, lte: end };
  } else if (filters.startDate || filters.endDate) {
    const range: Prisma.DateTimeFilter = {};
    if (filters.startDate) {
      const start = new Date(`${filters.startDate}T00:00:00`);
      if (!Number.isNaN(start.getTime())) range.gte = start;
    }
    if (filters.endDate) {
      const end = new Date(`${filters.endDate}T23:59:59`);
      if (!Number.isNaN(end.getTime())) range.lte = end;
    }
    if (Object.keys(range).length) where.createdAt = range;
  }

  if (andFilters.length) where.AND = andFilters;

  return where;
}

function dayOffRequestTypeWhere(): Prisma.RequestWhereInput {
  return {
    OR: [
      { type: { name: { contains: "folga", mode: "insensitive" } } },
      { type: { name: { contains: "day off", mode: "insensitive" } } }
    ]
  };
}

function supervisorStepRequestTypeWhere(): Prisma.RequestWhereInput {
  return {
    OR: [
      { type: { name: { contains: "folga", mode: "insensitive" } } },
      { type: { name: { contains: "day off", mode: "insensitive" } } },
      { type: { name: { contains: "turno", mode: "insensitive" } } },
      { type: { name: { contains: "shift", mode: "insensitive" } } }
    ]
  };
}

function isPendingActionFilter(value: RequestFilters["pendingAction"]) {
  return value === true || value === "true" || value === "1" || value === "sim";
}

const requestStatusLabels = ["Aberto", "Em análise", "Aprovado", "Recusado", "Concluído", "Cancelado"] as const;

function parsePositiveInteger(value: RequestFilters["page"], fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseRequestLimit(value: RequestFilters["limit"]) {
  const parsed = parsePositiveInteger(value, 50);
  return Math.min(100, [25, 50, 100].includes(parsed) ? parsed : 50);
}

function emptyRequestSummary() {
  return {
    total: 0,
    byStatus: requestStatusLabels.reduce((acc, status) => ({ ...acc, [status]: 0 }), {} as Record<UiRequestStatus, number>)
  };
}

async function summarizeRequests(where: Prisma.RequestWhereInput) {
  const [total, groups] = await Promise.all([
    prisma.request.count({ where }),
    prisma.request.groupBy({
      by: ["status"],
      where,
      _count: { _all: true }
    })
  ]);
  const summary = emptyRequestSummary();
  summary.total = total;
  groups.forEach((group) => {
    const status = dbToUiStatus[group.status] ?? "Aberto";
    summary.byStatus[status] = (summary.byStatus[status] ?? 0) + group._count._all;
  });
  return summary;
}

function summarizeUiRequests(requests: RequestRecord[]) {
  const summary = emptyRequestSummary();
  summary.total = requests.length;
  requests.forEach((request) => {
    summary.byStatus[request.status] = (summary.byStatus[request.status] ?? 0) + 1;
  });
  return summary;
}

function paginatedRequestResult(requests: RequestRecord[], filters: RequestFilters) {
  const page = parsePositiveInteger(filters.page, 1);
  const limit = parseRequestLimit(filters.limit);
  const total = requests.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * limit;
  return {
    data: requests.slice(start, start + limit),
    total,
    page: safePage,
    limit,
    totalPages,
    summary: summarizeUiRequests(requests),
    supervisors: [] as Array<{ id: string; name: string; wbLogin: string; email?: string }>
  };
}

async function listRequestSupervisors() {
  const supervisors = await prisma.employeeProfile.findMany({
    where: {
      deletedAt: null,
      supervisees: { some: { deletedAt: null } }
    },
    select: {
      id: true,
      fullName: true,
      wbLogin: true,
      user: { select: { email: true } }
    },
    orderBy: { fullName: "asc" },
    take: 500
  });

  return supervisors.map((supervisor) => ({
    id: supervisor.id,
    name: supervisor.fullName,
    wbLogin: supervisor.wbLogin,
    email: supervisor.user?.email
  }));
}

function isResolvedRequestTransition(transition: RequestTransition): transition is Exclude<RequestTransition, "FORBIDDEN" | { error: string }> {
  return typeof transition === "object" && "nextStatus" in transition;
}

function isSupervisorSendToWfm(actor: Actor, request: PrismaRequest, transition: RequestTransition) {
  return (
    normalizeRole(actor.role) === "SUPERVISOR" &&
    normalizeDbRequestStatus(request.status) === "ABERTO" &&
    isResolvedRequestTransition(transition) &&
    transition.nextStatus === "EM_ANALISE" &&
    !transition.applySchedule
  );
}

async function sendSupervisorRequestToWfmAnalysis(
  actor: Actor,
  user: ActiveUser,
  request: PrismaRequest,
  transition: Exclude<RequestTransition, "FORBIDDEN" | { error: string }>,
  reason: string | undefined,
  diagnostics: Record<string, unknown>,
  coverageImpact?: CoverageImpactSummary | null
) {
  const startedAt = Date.now();
  diagnostics.fastPath = "SUPERVISOR_SEND_TO_WFM";

  const guard = await prisma.request.updateMany({
    where: { id: request.id, status: request.status, deletedAt: null },
    data: { status: transition.nextStatus, updatedAt: new Date() }
  });

  if (guard.count !== 1) {
    const latest = await prisma.request.findUnique({ where: { id: request.id }, select: { status: true } });
    const latestStatus = latest?.status ? normalizeDbRequestStatus(latest.status) : null;
    return validationFailure(
      latestStatus === "EM_ANALISE"
        ? "Esta solicitação já foi enviada para análise."
        : "A solicitação já foi movimentada por outro usuário.",
      {},
      { ...diagnostics, currentStatus: latest?.status ?? null, elapsedMs: Date.now() - startedAt }
    );
  }

  const sideEffects = await Promise.allSettled([
    prisma.requestHistory.create({
      data: {
        requestId: request.id,
        actorId: user.id,
        action: transition.historyAction,
        from: request.status,
        to: transition.nextStatus,
        reason
      }
    }),
    prisma.auditLog.create({
      data: {
        actorId: user.id,
        action: transition.auditAction,
        entity: "Request",
        entityId: request.id,
        reason: reason ?? transition.historyAction,
        previousValue: { status: request.status },
        newValue: { status: transition.nextStatus }
      }
    }),
    ...(coverageImpact?.hasCriticalWarning
      ? [
          prisma.auditLog.create({
            data: coverageWarningAuditData(user.id, request, coverageImpact)
          })
        ]
      : [])
  ]);

  const rejectedSideEffects = sideEffects
    .map((result, index) => ({ result, name: index === 0 ? "history" : "auditLog" }))
    .filter((item): item is { result: PromiseRejectedResult; name: string } => item.result.status === "rejected");

  if (rejectedSideEffects.length) {
    recordErrorLog({
      userEmail: actor.email,
      code: "REQUEST_STATUS_SIDE_EFFECT_WARNING",
      message: rejectedSideEffects.map((item) => `${item.name}: ${item.result.reason instanceof Error ? item.result.reason.message : String(item.result.reason)}`).join(" | "),
      route: "/api/requests/status",
      action: "REQUEST_STATUS_SIDE_EFFECT",
      severity: "WARNING",
      metadata: { ...diagnostics, requestId: request.id, elapsedMs: Date.now() - startedAt }
    });
  }

  const updated = await prisma.request.findUniqueOrThrow({
    where: { id: request.id },
    include: requestInclude
  });

  await notifyRequestStatusChangeSafely(updated, user.id, reason, actor.email);
  recordErrorLog({
    userEmail: actor.email,
    code: "REQUEST_STATUS_FAST_PATH_OK",
    message: "Solicitação enviada para análise do WFM.",
    route: "/api/requests/status",
    action: "REQUEST_STATUS_FAST_PATH",
    severity: "INFO",
    metadata: { ...diagnostics, requestId: request.id, elapsedMs: Date.now() - startedAt }
  });

  return { data: await mapPrismaRequestWithImpact(updated, user, actor), scheduleUpdated: false, persisted: true };
}

function canViewRequest(actor: Actor, user: ActiveUser, request: PrismaRequest) {
  return request.requesterId === user.id || roleHasCapability(actor.role, "PIPELINES");
}

function canMutateRequest(actor: Actor, userId: string, request: PrismaRequest, status: UiRequestStatus) {
  const role = normalizeRole(actor.role);
  if (status === "Cancelado") {
    return ["ADMIN", "GESTOR"].includes(role) || (request.requesterId === userId && ["ABERTO", "AGUARDANDO_APROVACAO"].includes(request.status));
  }
  if (!roleHasCapability(actor.role, "PIPELINES")) return false;
  if (["ADMIN", "GESTOR", "WFM"].includes(role)) return true;
  if (role === "SUPERVISOR") return isDayOffRequest(request.type.name) || isShiftChangeRequest(request.type.name);
  return canApproveRequest(actor, { area: request.assignedArea, type: request.type.name });
}

function resolveRequestTransition(actor: Actor, user: ActiveUser, request: PrismaRequest, targetStatus: UiRequestStatus): RequestTransition {
  if (!(targetStatus in uiToDbStatus)) return { error: "Status inválido para a esteira atual." };

  const role = normalizeRole(actor.role);
  const current = normalizeDbRequestStatus(request.status);
  const isRequester = request.requesterId === user.id;
  const isShiftChange = isShiftChangeRequest(request);
  const isSupervisorStep = supervisorStepRoles.includes(role) && (role !== "SUPERVISOR" || isDayOffRequest(request) || isShiftChange);
  const isFinalApprover = wfmFinalRoles.includes(role);
  const isAdminLike = ["ADMIN", "GESTOR"].includes(role);
  const isAdvanceChange = isMonthlyAdvanceRequest(request);
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
      if (isAdvanceChange && isFinalApprover) {
        return {
          nextStatus: "APROVADO",
          applySchedule: false,
          applyMonthlyAdvance: true,
          historyAction: "Aprovação de alteração de adiantamento",
          auditAction: "APROVACAO",
          requesterTitle: "Alteração de adiantamento aprovada",
          requesterBody: "Sua solicitação de alteração de adiantamento foi aprovada.",
          requesterNotificationType: "SUCCESS"
        };
      }
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
      if (role === "SUPERVISOR") return { error: "Supervisor pode aprovar apenas a primeira etapa da solicitação." };
      if (!isFinalApprover) return "FORBIDDEN";
      return {
        nextStatus: "APROVADO",
        applySchedule: isDayOffRequest(request),
        applyMonthlyAdvance: isAdvanceChange,
        applyShiftChange: isShiftChange,
        historyAction: "Aprovação final WFM",
        auditAction: "APROVACAO",
        requesterTitle: isAdvanceChange ? "Alteração de adiantamento aprovada" : isShiftChange ? "Troca de turno aprovada" : finalApprovalTitle(request.type.name),
        requesterBody: isAdvanceChange ? "Sua solicitação de alteração de adiantamento foi aprovada." : isShiftChange ? "Sua troca de turno foi aprovada e aplicada ao Cronograma." : finalApprovalBody(request.type.name),
        requesterNotificationType: "SUCCESS",
        notifySupervisor: true,
        supervisorTitle: "Solicitação aprovada pelo WFM",
        supervisorBody: `${request.code} foi aprovada pelo WFM e o cronograma foi atualizado.`
      };
    }

    return { error: "Esta solicitação não pode ser aprovada neste status." };
  }

  if (target === "RECUSADO") {
    if (current === "ABERTO") {
      if (role === "WFM" && !isAdvanceChange) return { error: "A solicitação precisa da primeira aprovação do supervisor antes da decisão final do WFM." };
      if (!isSupervisorStep && !isAdminLike && !(isAdvanceChange && isFinalApprover)) return "FORBIDDEN";
    }
    if (current === "EM_ANALISE") {
      if (role === "SUPERVISOR") return { error: "Supervisor pode aprovar apenas a primeira etapa da solicitação." };
      if (!isFinalApprover) return "FORBIDDEN";
    }
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
    if (role === "SUPERVISOR") return { error: "Supervisor pode aprovar apenas a primeira etapa da solicitação." };
    if (current !== "APROVADO" || !isFinalApprover) return "FORBIDDEN";
    const payload = (request.payload ?? {}) as Record<string, unknown>;
    return {
      nextStatus: "CONCLUIDO",
      applySchedule: isDayOffRequest(request) && !payload.scheduleAppliedAt && payload.scheduleApplicationStatus !== "APPLIED",
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

function mapPrismaRequest(request: PrismaRequestForDisplay, user?: ActiveUser, actor?: Actor): RequestRecord {
  const payload = (request.payload ?? {}) as Record<string, unknown>;
  const role = normalizeRole(actor?.role);
  const isAdminLike = ["ADMIN", "GESTOR"].includes(role);
  const canSupervisorStep = isAdminLike || (role === "SUPERVISOR" && (isDayOffRequest(request) || isShiftChangeRequest(request)));
  const canWfmFinal = wfmFinalRoles.includes(role);
  const history = "history" in request ? request.history : [];
  const comments = "comments" in request ? request.comments : [];
  return {
    id: request.code,
    type: request.type.name,
    title: request.title,
    requester: request.requester.name,
    requesterEmail: request.requester.email,
    requesterWbLogin: request.employee?.wbLogin,
    lob: request.employee?.lob?.name,
    supervisor: request.employee?.supervisor?.fullName,
    priority: dbToUiPriority[request.priority] ?? "Média",
    status: dbToUiStatus[request.status] ?? "Aberto",
    area: request.assignedArea,
    assignee: request.assignee?.name,
    nextStep: nextStepForRequest(request.status),
    nextOwner: nextOwnerForRequest(request),
    canSupervisorStep,
    canWfmFinal,
    time: formatDateTime(request.createdAt),
    description: request.description,
    payload,
    history: history.map((item) => ({
      at: formatDateTime(item.createdAt),
      actor: item.actor.name,
      action: item.action ?? actionForStatus(dbToUiStatus[item.to] ?? "Aberto"),
      reason: item.reason ?? undefined
    })),
    comments: comments.map((comment) => ({
      at: formatDateTime(comment.createdAt),
      author: comment.author.name,
      body: comment.message
    })),
    createdAt: formatDateTime(request.createdAt),
    updatedAt: formatDateTime(request.updatedAt)
  };
}

async function mapPrismaRequestWithImpact(request: PrismaRequestForDisplay, user?: ActiveUser, actor?: Actor) {
  const record = mapPrismaRequest(request, user, actor);
  if (!isDayOffRequest(request)) return record;
  try {
    return {
      ...record,
      coverageImpact: await calculateCoverageImpactForRequestData(request)
    };
  } catch (error) {
    recordErrorLog({
      userEmail: actor?.email,
      code: "REQUEST_COVERAGE_IMPACT_MAP_WARNING",
      message: error instanceof Error ? error.message : "Falha ao calcular impacto no Requerido",
      route: "/api/requests",
      action: "REQUEST_COVERAGE_IMPACT",
      severity: "WARNING",
      metadata: { requestId: request.id, code: request.code }
    });
    return {
      ...record,
      coverageImpact: null
    };
  }
}

function shouldCheckCoverageWarning(request: PrismaRequestForDisplay, transition: RequestTransition) {
  if (!isResolvedRequestTransition(transition)) return false;
  if (!isDayOffRequest(request)) return false;
  if (transition.auditAction !== "APROVACAO") return false;
  return transition.nextStatus === "EM_ANALISE" || transition.nextStatus === "APROVADO" || transition.applySchedule;
}

function isCoverageWarningConfirmed(actionInput: RequestStatusActionInput) {
  return actionInput.confirmCoverageWarning === true || String(actionInput.confirmCoverageWarning ?? "").toLowerCase() === "true";
}

function coverageWarningFailure(coverageImpact: CoverageImpactSummary): RequestServiceError {
  const message = coverageWarningMessage(coverageImpact);
  return {
    error: message,
    message,
    type: "COVERAGE_WARNING",
    status: 409,
    fieldErrors: {},
    details: { coverageImpact }
  };
}

function coverageWarningMessage(coverageImpact: CoverageImpactSummary) {
  const worst = coverageImpact.impacts.find((impact) => impact.impactStatus === "IMPACTA");
  if (!worst) return "Atenção: a cobertura prevista ficará abaixo do requerido.";
  const required = worst.required === null ? "sem requerido cadastrado" : `requerido ${worst.required}`;
  const currentGap = worst.currentGap === null ? "sem gap atual" : `gap atual ${formatSignedNumber(worst.currentGap)}`;
  const projectedGap = worst.projectedGap === null ? "sem gap previsto" : `gap previsto ${formatSignedNumber(worst.projectedGap)}`;
  return `Atenção: a cobertura prevista ficará abaixo do requerido para ${worst.date} (${worst.lob} / ${worst.shift}). Cenário: ${required}, disponível atual ${worst.currentAvailable}, ${currentGap}. Se aprovada, disponível previsto ${worst.projectedAvailable} e ${projectedGap}.`;
}

function coverageWarningAuditData(actorId: string, request: PrismaRequestForDisplay, coverageImpact: CoverageImpactSummary) {
  return {
    actorId,
    action: AuditAction.APROVACAO,
    entity: "Request",
    entityId: request.id,
    reason: "REQUEST_APPROVED_WITH_COVERAGE_WARNING",
    previousValue: {
      requestId: request.id,
      requestCode: request.code,
      requestType: request.type.name
    },
    newValue: {
      confirmedCoverageWarning: true,
      coverageImpact
    }
  };
}

async function calculateCoverageImpactForRequestData(request: PrismaRequestForDisplay, actionInput: RequestStatusActionInput = {}): Promise<CoverageImpactSummary | null> {
  const kind = normalizeDayOffKind(request);
  if (!kind) return null;
  const payload = (request.payload ?? {}) as Record<string, unknown>;
  if (!request.employeeId) {
    return summarizeCoverageImpact(request, [{
      date: "-",
      label: "Solicitação sem parceiro",
      lob: "-",
      shift: "-",
      required: null,
      currentAvailable: 0,
      currentGap: null,
      impactDelta: 0,
      projectedAvailable: 0,
      projectedGap: null,
      impactStatus: "SEM_REQUERIDO",
      impactDirection: "NEUTRO",
      result: "NO_SCHEDULE",
      message: "Não foi possível calcular impacto porque a solicitação não possui parceiro vinculado."
    }]);
  }

  const employee = await prisma.employeeProfile.findUnique({
    where: { id: request.employeeId },
    include: {
      lob: { select: { id: true, name: true } },
      shift: { select: { id: true, name: true } }
    }
  });
  if (!employee) {
    return summarizeCoverageImpact(request, [{
      date: "-",
      label: "Parceiro não encontrado",
      lob: "-",
      shift: "-",
      required: null,
      currentAvailable: 0,
      currentGap: null,
      impactDelta: 0,
      projectedAvailable: 0,
      projectedGap: null,
      impactStatus: "SEM_REQUERIDO",
      impactDirection: "NEUTRO",
      result: "NO_SCHEDULE",
      message: "Não foi possível calcular impacto porque o parceiro não foi encontrado."
    }]);
  }

  const impacts: CoverageImpactRow[] = [];
  const addImpact = async (input: {
    label: string;
    date: Date | null;
    schedule: Awaited<ReturnType<typeof findScheduleForImpact>> | null;
    targetShiftName?: string | null;
    impactDelta: number;
    message?: string;
  }) => {
    impacts.push(await buildCoverageImpactRow({ ...input, request, employee }));
  };

  if (kind === "DAY_OFF_SWAP") {
    const currentDate = parseDateOnly(payload.currentDayOffDate ?? payload.dataAtual);
    const desiredDate = parseDateOnly(payload.desiredDayOffDate ?? payload.dataDesejada);
    const [currentSchedule, desiredSchedule] = await Promise.all([
      currentDate ? findScheduleForImpact(request.employeeId, currentDate) : Promise.resolve(null),
      desiredDate ? findScheduleForImpact(request.employeeId, desiredDate) : Promise.resolve(null)
    ]);
    const desiredShift = desiredSchedule ? scheduleShiftCategoryForImpact(desiredSchedule, employee.shift?.name) : employee.shift?.name;
    const desiredLosesCoverage = desiredSchedule ? scheduleCountsAsCoverageForImpact(desiredSchedule, desiredShift) : false;

    await addImpact({
      label: "Dia que passará a trabalhar",
      date: currentDate,
      schedule: currentSchedule,
      targetShiftName: desiredShift,
      impactDelta: 1
    });
    await addImpact({
      label: "Dia que deixará de trabalhar",
      date: desiredDate,
      schedule: desiredSchedule,
      targetShiftName: desiredShift,
      impactDelta: desiredLosesCoverage ? -1 : 0,
      message: desiredLosesCoverage ? undefined : "Este slot atualmente não conta como cobertura disponível."
    });
  } else if (kind === "DAY_OFF_SELL") {
    const targetDate = parseDateOnly(payload.dayOffToSellDate);
    const schedule = targetDate ? await findScheduleForImpact(request.employeeId, targetDate) : null;
    await addImpact({
      label: "Venda de folga aprovada",
      date: targetDate,
      schedule,
      targetShiftName: actionInput.finalApprovedShift || String(payload.availabilityShift ?? employee.shift?.name ?? ""),
      impactDelta: 1
    });
  } else {
    const targetDate = parseDateOnly(payload.desiredDayOffRequestDate ?? payload.desiredDayOffDate ?? payload.requestedDate);
    const schedule = targetDate ? await findScheduleForImpact(request.employeeId, targetDate) : null;
    const shift = schedule ? scheduleShiftCategoryForImpact(schedule, employee.shift?.name) : employee.shift?.name;
    const losesCoverage = schedule ? scheduleCountsAsCoverageForImpact(schedule, shift) : false;
    await addImpact({
      label: "Folga aprovada",
      date: targetDate,
      schedule,
      targetShiftName: shift,
      impactDelta: losesCoverage ? -1 : 0,
      message: losesCoverage ? undefined : "Este slot atualmente não conta como cobertura disponível."
    });
  }

  return summarizeCoverageImpact(request, impacts);
}

async function buildCoverageImpactRow(input: {
  request: PrismaRequestForDisplay;
  employee: CoverageImpactEmployee;
  label: string;
  date: Date | null;
  schedule: Awaited<ReturnType<typeof findScheduleForImpact>> | null;
  targetShiftName?: string | null;
  impactDelta: number;
  message?: string;
}): Promise<CoverageImpactRow> {
  const dateKey = input.date ? formatDateKey(input.date) : "-";
  const employee = input.employee;
  if (!input.date || !input.schedule) {
    return {
      date: dateKey,
      label: input.label,
      lob: employee.lob?.name ?? "-",
      lobId: employee.lobId,
      shift: normalizeProductiveShiftForImpact(input.targetShiftName ?? employee.shift?.name) || shiftCategoryName(input.targetShiftName ?? employee.shift?.name) || "-",
      shiftId: employee.shiftId,
      required: null,
      currentAvailable: 0,
      currentGap: null,
      impactDelta: 0,
      projectedAvailable: 0,
      projectedGap: null,
      impactStatus: "SEM_REQUERIDO",
      impactDirection: "NEUTRO",
      result: "NO_SCHEDULE",
      message: input.date
        ? "Não foi possível calcular impacto porque não existe cronograma para o dia solicitado."
        : "Data da solicitação inválida."
    };
  }

  const lobId = input.schedule.lobId ?? employee.lobId;
  const lob = await resolveImpactLob(lobId, employee.lob);
  const shift = normalizeProductiveShiftForImpact(input.targetShiftName ?? scheduleShiftCategoryForImpact(input.schedule, employee.shift?.name));
  if (!shift) {
    return {
      date: dateKey,
      label: input.label,
      lob: lob.name,
      lobId,
      shift: shiftCategoryName(input.targetShiftName ?? input.schedule.shift?.name ?? employee.shift?.name) || "-",
      shiftId: input.schedule.shiftId ?? employee.shiftId,
      required: null,
      currentAvailable: 0,
      currentGap: null,
      impactDelta: 0,
      projectedAvailable: 0,
      projectedGap: null,
      impactStatus: "SEM_REQUERIDO",
      impactDirection: "NEUTRO",
      result: "NO_REQUIREMENT",
      message: input.message ?? "Não foi possível identificar turno produtivo para calcular impacto."
    };
  }

  const [requirement, currentAvailable] = await Promise.all([
    findRequirementForImpact(input.date, lobId, shift),
    countAvailableCoverageForImpact(input.date, lobId, lob.name, shift)
  ]);
  const required = requirement?.requiredStaff ?? null;
  const impactDelta = input.impactDelta;
  const projectedAvailable = currentAvailable + impactDelta;
  const currentGap = required === null ? null : currentAvailable - required;
  const projectedGap = required === null ? null : projectedAvailable - required;
  const status = impactStatusForGap(required, projectedGap);
  const direction = impactDirectionForGap(currentGap, projectedGap);

  return {
    date: dateKey,
    label: input.label,
    lob: lob.name,
    lobId,
    shift,
    shiftId: requirement?.shiftId ?? input.schedule.shiftId ?? employee.shiftId,
    required,
    currentAvailable,
    currentGap,
    impactDelta,
    projectedAvailable,
    projectedGap,
    impactStatus: status,
    impactDirection: direction,
    result: legacyImpactResult(status, direction),
    message: input.message ?? (required === null ? "Não há requerido cadastrado para esta data, LOB e turno." : undefined)
  };
}

function summarizeCoverageImpact(request: PrismaRequestForDisplay, impacts: CoverageImpactRow[]): CoverageImpactSummary {
  const impactStatus = summaryImpactStatus(impacts);
  const impactDirection = summaryImpactDirection(impacts);
  const hasCriticalWarning = impactStatus === "IMPACTA";
  const hasNoSchedule = impacts.some((impact) => impact.result === "NO_SCHEDULE");
  const badgeLabel = impactStatus === "IMPACTA" ? "Impacta" : impactStatus === "SEM_REQUERIDO" ? "Sem requerido" : "Não impacta";
  const badgeTone: CoverageImpactSummary["badgeTone"] = impactStatus === "IMPACTA" ? "red" : impactStatus === "SEM_REQUERIDO" || hasNoSchedule ? "orange" : "green";
  return {
    requestId: request.id,
    requestType: request.type.name,
    impactStatus,
    impactDirection,
    impacts,
    hasCriticalWarning,
    badgeLabel,
    badgeTone,
    summary: impactSummaryText(badgeLabel, impacts)
  };
}

function impactStatusForGap(required: number | null, projectedGap: number | null): CoverageImpactStatus {
  if (required === null || projectedGap === null) return "SEM_REQUERIDO";
  return projectedGap < 0 ? "IMPACTA" : "NAO_IMPACTA";
}

function impactDirectionForGap(currentGap: number | null, projectedGap: number | null): CoverageImpactDirection {
  if (currentGap === null || projectedGap === null) return "NEUTRO";
  if (projectedGap > currentGap) return "MELHORA";
  if (projectedGap < currentGap) return "PIORA";
  return "NEUTRO";
}

function legacyImpactResult(status: CoverageImpactStatus, direction: CoverageImpactDirection): CoverageImpactResult {
  if (status === "SEM_REQUERIDO") return "NO_REQUIREMENT";
  if (direction === "MELHORA") return "IMPROVES";
  if (direction === "PIORA") return "WORSENS";
  return "NEUTRAL";
}

function summaryImpactStatus(impacts: CoverageImpactRow[]): CoverageImpactStatus {
  if (impacts.some((impact) => impact.impactStatus === "IMPACTA")) return "IMPACTA";
  if (impacts.some((impact) => impact.impactStatus === "SEM_REQUERIDO")) return "SEM_REQUERIDO";
  return "NAO_IMPACTA";
}

function summaryImpactDirection(impacts: CoverageImpactRow[]): CoverageImpactDirection {
  if (impacts.some((impact) => impact.impactDirection === "PIORA")) return "PIORA";
  if (impacts.some((impact) => impact.impactDirection === "MELHORA")) return "MELHORA";
  return "NEUTRO";
}

function impactSummaryText(label: string, impacts: CoverageImpactRow[]) {
  const first = impacts[0];
  if (!first) return label;
  if (impacts.length === 1) {
    const gap = first.projectedGap === null ? "sem gap previsto" : `gap previsto ${formatSignedNumber(first.projectedGap)}`;
    return `${label}: ${first.date} • ${first.lob} • ${first.shift} • ${gap}`;
  }
  return `${label}: ${impacts.length} cenários avaliados.`;
}

async function findScheduleForImpact(employeeId: string, date: Date) {
  return prisma.schedule.findFirst({
    where: { employeeId, date, deletedAt: null },
    include: {
      shift: { select: { id: true, name: true } },
      employee: {
        select: {
          id: true,
          fullName: true,
          roleTitle: true,
          operationalStatus: true,
          lob: { select: { id: true, name: true } },
          shift: { select: { id: true, name: true } }
        }
      }
    }
  });
}

async function findRequirementForImpact(date: Date, lobId: string, shift: string) {
  return prisma.staffCoverage.findFirst({
    where: {
      date,
      lobId,
      shift: { OR: [{ name: { equals: shift, mode: "insensitive" } }, { name: { startsWith: shift, mode: "insensitive" } }] }
    },
    include: { shift: { select: { id: true, name: true } } }
  });
}

async function countAvailableCoverageForImpact(date: Date, lobId: string, lobName: string, shift: string) {
  const schedules = await prisma.schedule.findMany({
    where: {
      date,
      deletedAt: null,
      OR: [{ lobId }, { lobId: null, employee: { lobId } }],
      employee: { deletedAt: null }
    },
    include: {
      shift: { select: { id: true, name: true } },
      employee: {
        select: {
          roleTitle: true,
          skill: true,
          operationalStatus: true,
          lob: { select: { id: true, name: true } },
          shift: { select: { id: true, name: true } }
        }
      }
    }
  });
  return schedules.filter((schedule) => {
    const scheduleLobId = schedule.lobId ?? schedule.employee.lob.id;
    if (scheduleLobId !== lobId) return false;
    if (isProjectExcludedFromAdsCoverage(schedule.employee.lob.name, lobName)) return false;
    if (!isAgentJobTitle(schedule.employee.roleTitle)) return false;
    if (!scheduleEmployeeCountsAsActiveForImpact(schedule)) return false;
    if (scheduleShiftCategoryForImpact(schedule, schedule.employee.shift?.name) !== shift) return false;
    return scheduleCountsAsCoverageForImpact(schedule, shift);
  }).length;
}

async function resolveImpactLob(lobId: string, employeeLob: { id: string; name: string }) {
  if (employeeLob.id === lobId) return employeeLob;
  return (await prisma.lob.findUnique({ where: { id: lobId }, select: { id: true, name: true } })) ?? employeeLob;
}

function scheduleShiftCategoryForImpact(schedule: { shift?: { name: string } | null; employee?: { shift?: { name: string } | null } }, fallback?: string | null) {
  return normalizeProductiveShiftForImpact(schedule.shift?.name ?? schedule.employee?.shift?.name ?? fallback) || shiftCategoryName(schedule.shift?.name ?? schedule.employee?.shift?.name ?? fallback);
}

function normalizeProductiveShiftForImpact(value?: string | null) {
  const shift = shiftCategoryName(value);
  return (productiveShiftCategories as readonly string[]).includes(shift) ? shift : "";
}

function scheduleCountsAsCoverageForImpact(schedule: { status: ScheduleStatus; shift?: { name: string } | null; employee?: { skill?: string | null; lob?: { name: string } | null; shift?: { name: string } | null } }, shiftOverride?: string | null) {
  const shift = normalizeProductiveShiftForImpact(shiftOverride ?? schedule.shift?.name ?? schedule.employee?.shift?.name);
  if (!shift) return false;
  if (coverageStatuses.has(schedule.status)) return true;
  if (schedule.status === "NESTING") return true;
  return schedule.status === "TROCA_APROVADA";
}

function scheduleEmployeeCountsAsActiveForImpact(schedule: { status: ScheduleStatus; employee: { skill?: string | null; operationalStatus?: string | null; lob?: { name: string } | null } }) {
  if (isCoverageEmployeeActiveForImpact(schedule.employee.operationalStatus)) return true;
  return isOperationalNestingForImpact(schedule.employee.operationalStatus) && scheduleCountsAsCoverageForImpact(schedule);
}

function isOperationalNestingForImpact(value?: string | null) {
  const normalized = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  return normalized === "nesting";
}

function isScheduleDayOffStatus(status?: ScheduleStatus | null) {
  return Boolean(status && dayOffScheduleStatuses.has(status));
}

function isSellableDayOffStatus(status?: ScheduleStatus | null) {
  return Boolean(status && sellableDayOffScheduleStatuses.has(status));
}

function isCoverageEmployeeActiveForImpact(value?: string | null) {
  const normalized = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  return !inactiveCoverageEmployeeStatuses.has(normalized);
}

function formatSignedNumber(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

function nextStepForRequest(status: string) {
  const normalized = normalizeDbRequestStatus(status);
  if (normalized === "ABERTO") return "Aprovação do supervisor";
  if (normalized === "EM_ANALISE") return "Análise final WFM";
  if (normalized === "APROVADO") return "Conclusão administrativa";
  if (normalized === "RECUSADO") return "Encerrada por recusa";
  if (normalized === "CANCELADO") return "Cancelada";
  if (normalized === "CONCLUIDO") return "Concluída";
  return "Acompanhar";
}

function nextOwnerForRequest(request: PrismaRequestForDisplay) {
  const normalized = normalizeDbRequestStatus(request.status);
  if (normalized === "ABERTO") return request.employee?.supervisor?.fullName ?? "Supervisor responsável";
  if (normalized === "EM_ANALISE") return "WFM";
  if (normalized === "APROVADO") return "WFM/Admin";
  return "Sem próxima ação";
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

  if (isMonthlyAdvanceRequest(input)) {
    if (!input.monthlyAdvanceReferenceMonth?.trim()) return "Mês de referência é obrigatório.";
    if (typeof input.requestedAdvanceOptIn !== "boolean") return "Novo status solicitado do adiantamento é obrigatório.";
    if (!input.description.trim()) return "Motivo é obrigatório.";
  }

  if (isShiftChangeRequest(input)) {
    const changeType = normalizeShiftChangeType(input.shiftChangeType);
    const startDate = input.shiftChangeStartDate || input.shiftChangeDate || input.requestedDate;
    const endDate = input.shiftChangeEndDate;
    if (!startDate) return changeType === "Fixa" ? "Data de início da vigência é obrigatória." : "Data inicial da troca de turno é obrigatória.";
    if (changeType === "Temporária" && !endDate) return "Data final da troca de turno temporária é obrigatória.";
    if (changeType === "Temporária" && startDate && endDate && endDate < startDate) return "Data final não pode ser anterior à data inicial.";
    if (!input.desiredShift?.trim()) return "Novo turno solicitado é obrigatório.";
    if (!input.shiftChangeReason?.trim() && !input.justification?.trim() && !input.description.trim()) return "Motivo da troca de turno é obrigatório.";
    if (input.currentShift && cleanShiftName(input.currentShift) === cleanShiftName(input.desiredShift)) return "O novo turno precisa ser diferente do turno atual.";
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
    scaleIntegrationPending: Boolean(dayOffKind),
    monthlyAdvanceChange: isMonthlyAdvanceRequest(input),
    referenceMonth: input.monthlyAdvanceReferenceMonth || null,
    currentOptIn: input.currentAdvanceOptIn ?? null,
    requestedOptIn: input.requestedAdvanceOptIn ?? null,
    currentAmount: input.currentAdvanceAmount ?? null,
    requestedAmount: input.requestedAdvanceAmount ?? null,
    reason: input.monthlyAdvanceReason || input.shiftChangeReason || input.description || null,
    shiftChange: isShiftChangeRequest(input),
    shiftChangeType: normalizeShiftChangeType(input.shiftChangeType),
    shiftChangeDate: input.shiftChangeStartDate || input.shiftChangeDate || input.requestedDate || null,
    shiftChangeStartDate: input.shiftChangeStartDate || input.shiftChangeDate || input.requestedDate || null,
    shiftChangeEndDate: input.shiftChangeEndDate || null,
    currentShift: input.currentShift || null,
    desiredShift: input.desiredShift || null,
    shiftChangeReason: input.shiftChangeReason || input.justification || input.description || null,
    shiftChangeObservation: input.shiftChangeObservation || null,
    shiftChangeApplicationStatus: isShiftChangeRequest(input) ? "PENDING" : null
  };
}

function isMonthlyAdvanceRequest(value: CreateRequestInput | PrismaRequestForDisplay | string) {
  if (!value) return false;
  const payload = typeof value === "string" ? null : ((value as PrismaRequestForDisplay).payload ?? null);
  const typeName =
    typeof value === "string"
      ? value
      : "type" in value && typeof (value as PrismaRequestForDisplay).type === "object"
        ? (value as PrismaRequestForDisplay).type.name
        : (value as CreateRequestInput).type;
  return /adiantamento/i.test(typeName) || isMonthlyAdvanceRequestPayload(payload);
}

function isDayOffRequest(value: CreateRequestInput | PrismaRequestForDisplay | string) {
  return Boolean(normalizeDayOffKind(value));
}

function isShiftChangeRequest(value: CreateRequestInput | PrismaRequestForDisplay | string) {
  const payload = typeof value === "string" ? {} : ((value as PrismaRequestForDisplay).payload ?? {}) as Record<string, unknown>;
  const typeName =
    typeof value === "string"
      ? value
      : "type" in value && typeof (value as PrismaRequestForDisplay).type === "object"
        ? (value as PrismaRequestForDisplay).type.name
        : (value as CreateRequestInput).type;
  return /troca de turno|shift change/i.test(typeName) || payload.shiftChange === true || String(payload.internalType ?? "").toUpperCase() === "SHIFT_CHANGE";
}

function normalizeShiftChangeType(value: unknown): "Fixa" | "Temporária" {
  const normalized = String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  return normalized === "FIXA" || normalized === "FIXO" || normalized === "PERMANENTE" ? "Fixa" : "Temporária";
}

function normalizeDayOffKind(value: CreateRequestInput | PrismaRequestForDisplay | string | null | undefined): DayOffKind | null {
  if (!value) return null;
  const payload = typeof value === "string" ? {} : ((value as PrismaRequestForDisplay).payload ?? {}) as Record<string, unknown>;
  const typeName =
    typeof value === "string"
      ? value
      : "type" in value && typeof (value as PrismaRequestForDisplay).type === "object"
        ? (value as PrismaRequestForDisplay).type.name
        : (value as CreateRequestInput).type;
  const raw = String(payload.dayOffKind ?? payload.internalType ?? (value as CreateRequestInput).dayOffKind ?? "");
  if ((dayOffKinds as readonly string[]).includes(raw)) return raw as DayOffKind;
  if (/venda de folga|vender folga/i.test(typeName)) return "DAY_OFF_SELL";
  if (/solicita(ç|c)[aã]o de (dia de )?folga|dia de folga|folga solicitada|pedido de folga/i.test(typeName)) return "DAY_OFF_REQUEST";
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
    if (current.schedule && !isScheduleDayOffStatus(current.schedule.status)) return "A data atual informada não está registrada como folga para este parceiro.";
    if (desired.schedule && isScheduleDayOffStatus(desired.schedule.status)) return "A nova data desejada já está registrada como folga.";
    return duplicateDayOffRequest(employeeId, kind, { currentDayOffDate: input.currentDayOffDate, desiredDayOffDate: input.desiredDayOffDate });
  }

  if (kind === "DAY_OFF_SELL") {
    const target = await findSchedule(input.dayOffToSellDate);
    if (!target.date) return "Data da folga que deseja vender inválida.";
    if (employeeScheduleCount && !target.schedule) return "Data da folga fora do período de cronograma carregado.";
    if (target.schedule && !isSellableDayOffStatus(target.schedule.status)) return "A data selecionada não está registrada como Folga, Folga aprovada ou Troca aprovada.";
    return duplicateDayOffRequest(employeeId, kind, { dayOffToSellDate: input.dayOffToSellDate });
  }

  const targetDate = input.desiredDayOffRequestDate || input.desiredDayOffDate || input.requestedDate;
  const target = await findSchedule(targetDate);
  if (!target.date) return "Data desejada para folga inválida.";
  if (employeeScheduleCount && !target.schedule) return "Data desejada fora do período de cronograma carregado.";
  if (target.schedule && isScheduleDayOffStatus(target.schedule.status)) return "A data desejada já está registrada como folga.";
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

async function validateShiftChangeRequestInDatabase(employeeId: string, input: CreateRequestInput) {
  const changeType = normalizeShiftChangeType(input.shiftChangeType);
  const startDate = parseDateOnly(input.shiftChangeStartDate || input.shiftChangeDate || input.requestedDate);
  const endDate = parseDateOnly(input.shiftChangeEndDate);
  if (!startDate) return "Data da troca de turno inválida.";
  if (changeType === "Temporária" && !endDate) return "Data final da troca de turno temporária inválida.";
  if (changeType === "Temporária" && endDate && endDate < startDate) return "Data final não pode ser anterior à data inicial.";

  const desiredShift = cleanShiftName(input.desiredShift);
  if (!desiredShift) return "Novo turno solicitado é obrigatório.";
  const targetShift = await prisma.shift.findFirst({
    where: {
      OR: [
        { name: desiredShift },
        { name: { startsWith: `${desiredShift} (` } }
      ]
    }
  });
  if (!targetShift) return "Turno solicitado não encontrado.";

  const firstSchedule = await prisma.schedule.findUnique({
    where: { employeeId_date: { employeeId, date: startDate } },
    include: { shift: true }
  });
  if (changeType === "Temporária") {
    const scheduleCount = await prisma.schedule.count({
      where: {
        employeeId,
        deletedAt: null,
        date: { gte: startDate, lte: endDate ?? startDate }
      }
    });
    if (!scheduleCount) return "Não existe cronograma para este período. A troca de turno não pode ser solicitada.";
  }

  const currentShift = cleanShiftName(firstSchedule?.shift?.name ?? input.currentShift);
  if (currentShift && currentShift === desiredShift) return "O novo turno precisa ser diferente do turno atual.";
  const targetDateKey = startDate.toISOString().slice(0, 10);

  const candidates = await prisma.request.findMany({
    where: {
      employeeId,
      status: { in: [...pendingStatuses] },
      type: { name: { contains: "turno", mode: "insensitive" } }
    },
    take: 20
  });
  const duplicate = candidates.some((request) => {
    const payload = (request.payload ?? {}) as Record<string, unknown>;
    return String(payload.shiftChangeStartDate ?? payload.shiftChangeDate ?? payload.requestedDate ?? "").slice(0, 10) === targetDateKey;
  });
  return duplicate ? "Já existe uma solicitação de troca de turno pendente para esta data." : "";
}

async function applyDayOffRequestToSchedule(tx: Prisma.TransactionClient, request: PrismaRequest, actorId: string, actionInput: RequestStatusActionInput) {
  const kind = normalizeDayOffKind(request);
  if (!kind) return { updated: false, message: "" };
  const payload = (request.payload ?? {}) as Record<string, unknown>;
  if (payload.scheduleAppliedAt || payload.scheduleApplicationStatus === "APPLIED") throw new DomainError("Esta solicitação já foi aplicada ao Cronograma.");
  if (!request.employeeId) throw new DomainError("Solicitação sem parceiro vinculado para aplicar cronograma.");

  const employee = await tx.employeeProfile.findUnique({ where: { id: request.employeeId }, include: { shift: true } });
  if (!employee) throw new DomainError("Parceiro não encontrado para aplicar cronograma.");

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
  if (!current) throw new DomainError("Não foi possível aplicar a troca: data atual da folga sem cronograma.");
  if (!desired) throw new DomainError("Não foi possível aplicar a troca: nova data desejada sem cronograma.");
  if (!isScheduleDayOffStatus(current.status)) throw new DomainError("A data atual não está como folga no cronograma.");
  if (isScheduleDayOffStatus(desired.status)) throw new DomainError("A nova data desejada já está como folga.");

  const before = { current: serialize(current), desired: serialize(desired) };

  const currentAfter = await tx.schedule.update({
    where: { id: current.id },
    data: {
      shiftId: desired.shiftId,
      startsAt: desired.startsAt,
      endsAt: desired.endsAt,
      status: "TROCA_APROVADA",
      source: "day-off-swap",
      observation: `Troca de folga aprovada pela solicitação ${request.code}`
    }
  });

  const desiredAfter = await tx.schedule.update({
    where: { id: desired.id },
    data: {
      shiftId: null,
      startsAt: null,
      endsAt: null,
      status: "FOLGA_APROVADA",
      source: "day-off-swap",
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
  await auditScheduleApplication(tx, {
    actorId,
    request,
    scheduleId: currentAfter.id,
    employeeId: employee.id,
    date: currentDate,
    before: before.current,
    after: serialize(currentAfter),
    reason: `Troca de folga aplicada ao Cronograma pela solicitação ${request.code}`
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
  await auditScheduleApplication(tx, {
    actorId,
    request,
    scheduleId: desiredAfter.id,
    employeeId: employee.id,
    date: desiredDate,
    before: before.desired,
    after: serialize(desiredAfter),
    reason: `Folga aprovada aplicada ao Cronograma pela troca ${request.code}`
  });

  return { updated: true, message: "Troca de folga aplicada no Cronograma: data atual marcada como Troca aprovada e nova data marcada como Folga aprovada." };
}

async function applySellSchedule(tx: Prisma.TransactionClient, request: PrismaRequest, employee: { id: string; shiftId: string; lobId: string; supervisorId: string | null; shift: { id: string; name: string; startsAt: string; endsAt: string } }, actorId: string, payload: Record<string, unknown>, actionInput: RequestStatusActionInput) {
  const targetDate = parseDateOnly(payload.dayOffToSellDate);
  if (!targetDate) throw new DomainError("Data da venda de folga inválida.");
  const schedule = await tx.schedule.findUnique({ where: { employeeId_date: { employeeId: employee.id, date: targetDate } }, include: { shift: true } });
  if (!schedule) throw new DomainError("Não existe cronograma para esta data. Não foi possível aplicar a venda de folga.");
  if (!isSellableDayOffStatus(schedule.status)) throw new DomainError("A data selecionada não está como Folga, Folga aprovada ou Troca aprovada.");

  const shiftName = cleanShiftName(actionInput.finalApprovedShift || String(payload.availabilityShift ?? employee.shift.name)) || employee.shift.name;
  const finalShift = (await tx.shift.findFirst({ where: { OR: [{ name: shiftName }, { name: { startsWith: `${shiftName} (` } }] } })) ?? employee.shift;
  const before = serialize(schedule);
  const after = await tx.schedule.update({
    where: { id: schedule.id },
    data: {
      shiftId: finalShift.id,
      startsAt: actionInput.finalApprovedStartTime || String(payload.preferredStartTime ?? "") || finalShift.startsAt,
      endsAt: actionInput.finalApprovedEndTime || String(payload.preferredEndTime ?? "") || finalShift.endsAt,
      status: "VENDA_FOLGA_APROVADA",
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
  await auditScheduleApplication(tx, {
    actorId,
    request,
    scheduleId: after.id,
    employeeId: employee.id,
    date: targetDate,
    before,
    after: serialize(after),
    reason: `Venda de folga aplicada ao Cronograma pela solicitação ${request.code}`
  });
  return { updated: true, message: "Venda de folga aprovada aplicada no Cronograma." };
}

async function applyRequestedDayOffSchedule(tx: Prisma.TransactionClient, request: PrismaRequest, employee: { id: string }, actorId: string, payload: Record<string, unknown>) {
  const targetDate = parseDateOnly(payload.desiredDayOffRequestDate ?? payload.desiredDayOffDate ?? payload.requestedDate);
  if (!targetDate) throw new DomainError("Data desejada para folga inválida.");
  const schedule = await tx.schedule.findUnique({ where: { employeeId_date: { employeeId: employee.id, date: targetDate } }, include: { shift: true } });
  if (!schedule) throw new DomainError("Não existe cronograma para esta data. Não foi possível aplicar a folga.");
  if (isScheduleDayOffStatus(schedule.status)) throw new DomainError("A data desejada já está como folga.");

  const before = serialize(schedule);
  const after = await tx.schedule.update({
    where: { id: schedule.id },
    data: {
      shiftId: null,
      startsAt: null,
      endsAt: null,
      status: "FOLGA_APROVADA",
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
  await auditScheduleApplication(tx, {
    actorId,
    request,
    scheduleId: after.id,
    employeeId: employee.id,
    date: targetDate,
    before,
    after: serialize(after),
    reason: `Solicitação de folga aplicada ao Cronograma pela solicitação ${request.code}`
  });
  return { updated: true, message: "Folga aprovada aplicada no Cronograma." };
}

async function auditScheduleApplication(
  tx: Prisma.TransactionClient,
  input: {
    actorId: string;
    request: PrismaRequest;
    scheduleId: string;
    employeeId: string;
    date: Date;
    before: Prisma.JsonValue;
    after: Prisma.JsonValue;
    reason: string;
  }
) {
  await tx.auditLog.create({
    data: {
      actorId: input.actorId,
      action: "ALTERACAO_ESCALA",
      entity: "Schedule",
      entityId: input.scheduleId,
      reason: input.reason,
      previousValue: {
        requestId: input.request.id,
        requestCode: input.request.code,
        requestType: input.request.type.name,
        employeeId: input.employeeId,
        date: input.date.toISOString().slice(0, 10),
        schedule: input.before
      },
      newValue: {
        requestId: input.request.id,
        requestCode: input.request.code,
        requestType: input.request.type.name,
        employeeId: input.employeeId,
        date: input.date.toISOString().slice(0, 10),
        schedule: input.after
      }
    }
  });
}

async function applyShiftChangeRequestToSchedule(
  tx: Prisma.TransactionClient,
  request: PrismaRequest,
  actorId: string
): Promise<ShiftChangeApplicationResult> {
  const payload = (request.payload ?? {}) as Record<string, unknown>;
  if (payload.shiftChangeAppliedAt) throw new DomainError("Esta solicitação já teve a troca de turno aplicada.");
  if (!request.employeeId) throw new DomainError("Solicitação sem parceiro vinculado para aplicar troca de turno.");

  const changeType = normalizeShiftChangeType(payload.shiftChangeType);
  const startDate = parseDateOnly(payload.shiftChangeStartDate ?? payload.shiftChangeDate ?? payload.requestedDate);
  const endDate = parseDateOnly(payload.shiftChangeEndDate);
  if (!startDate) throw new DomainError("Data da troca de turno inválida.");
  if (changeType === "Temporária" && !endDate) throw new DomainError("Data final da troca de turno temporária inválida.");
  if (changeType === "Temporária" && endDate && endDate < startDate) throw new DomainError("Data final não pode ser anterior à data inicial.");

  const desiredShift = cleanShiftName(String(payload.desiredShift ?? ""));
  if (!desiredShift) throw new DomainError("Novo turno solicitado é obrigatório.");
  const baseTimes = baseTimesForShift(desiredShift);
  if (!baseTimes?.startsAt || !baseTimes.endsAt) {
    throw new DomainError("A troca de turno deve selecionar Manhã, Tarde ou Noite.");
  }

  const shift = await tx.shift.findFirst({
    where: {
      OR: [
        { name: desiredShift },
        { name: { startsWith: `${desiredShift} (` } }
      ]
    }
  });
  if (!shift) throw new DomainError("Turno solicitado não encontrado.");

  if (changeType === "Fixa") {
    const effectiveNow = isShiftChangeEffective(startDate);
    const employee = await tx.employeeProfile.findUnique({
      where: { id: request.employeeId },
      include: { shift: true }
    });
    if (!employee) throw new DomainError("Parceiro não encontrado para aplicar troca de turno.");

    if (effectiveNow) {
      const employeeBefore = serialize({
        id: employee.id,
        shiftId: employee.shiftId,
        shift: employee.shift?.name ?? null,
        workStartTime: employee.workStartTime,
        workEndTime: employee.workEndTime
      });
      const updatedEmployee = await tx.employeeProfile.update({
        where: { id: request.employeeId },
        data: {
          shiftId: shift.id,
          workStartTime: baseTimes.startsAt,
          workEndTime: baseTimes.endsAt
        },
        include: { shift: true }
      });
      const employeeAfter = serialize({
        id: updatedEmployee.id,
        shiftId: updatedEmployee.shiftId,
        shift: updatedEmployee.shift?.name ?? null,
        workStartTime: updatedEmployee.workStartTime,
        workEndTime: updatedEmployee.workEndTime
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: "EDICAO",
          entity: "EmployeeProfile",
          entityId: request.employeeId,
          reason: `Troca de turno fixa vigente pela solicitação ${request.code}`,
          previousValue: employeeBefore,
          newValue: employeeAfter
        }
      });
    }

    const schedules = await tx.schedule.findMany({
      where: {
        employeeId: request.employeeId,
        deletedAt: null,
        date: { gte: startDate }
      },
      include: { shift: true },
      orderBy: { date: "asc" }
    });
    for (const schedule of schedules) {
      const before = serialize(schedule);
      const after = await tx.schedule.update({
        where: { id: schedule.id },
        data: {
          shiftId: shift.id,
          startsAt: baseTimes.startsAt,
          endsAt: baseTimes.endsAt,
          observation: `Troca de turno fixa aprovada pela solicitação ${request.code}`
        },
        include: { shift: true }
      });
      await tx.scheduleChangeHistory.create({
        data: {
          scheduleId: after.id,
          employeeId: request.employeeId,
          changedById: actorId,
          date: schedule.date,
          before,
          after: serialize(after),
          previousValue: before,
          newValue: serialize(after),
          reason: `Troca de turno fixa aprovada pela solicitação ${request.code}`
        }
      });
    }
    await tx.auditLog.create({
      data: {
        actorId,
        action: "ALTERACAO_ESCALA",
        entity: "Schedule",
        entityId: request.id,
        reason: effectiveNow
          ? `Troca de turno fixa aplicada em ${schedules.length} cronograma(s).`
          : `Troca de turno fixa agendada para ${startDate.toISOString().slice(0, 10)} em ${schedules.length} cronograma(s).`,
        newValue: {
          requestId: request.id,
          startDate: startDate.toISOString().slice(0, 10),
          desiredShift,
          baseTimes,
          schedulesUpdated: schedules.length,
          profileUpdated: effectiveNow
        }
      }
    });
    const scheduledFor = startDate.toISOString().slice(0, 10);
    const appliedAt = effectiveNow ? new Date().toISOString() : null;
    return {
      updated: true,
      message: effectiveNow
        ? `Troca de turno fixa aprovada e vigente. Turno cadastral atualizado e ${schedules.length} cronograma(s) ajustado(s).`
        : `Troca de turno fixa aprovada e agendada para ${formatDatePtBr(startDate)}. O turno atual será mantido até o início da vigência; ${schedules.length} cronograma(s) futuro(s) foram preparados.`,
      applicationStatus: effectiveNow ? "APPLIED" : "SCHEDULED",
      appliedAt,
      scheduledFor,
      profileUpdated: effectiveNow
    };
  }

  const schedules = await tx.schedule.findMany({
    where: {
      employeeId: request.employeeId,
      deletedAt: null,
      date: { gte: startDate, lte: endDate ?? startDate }
    },
    include: { shift: true },
    orderBy: { date: "asc" }
  });
  if (!schedules.length) throw new DomainError("Não existe cronograma para este período. A troca de turno não pode ser aplicada.");

  for (const schedule of schedules) {
    const before = serialize(schedule);
    const after = await tx.schedule.update({
      where: { id: schedule.id },
      data: {
        shiftId: shift.id,
        startsAt: baseTimes.startsAt,
        endsAt: baseTimes.endsAt,
        observation: `Troca de turno temporária aprovada pela solicitação ${request.code}`
      },
      include: { shift: true }
    });
    await tx.scheduleChangeHistory.create({
      data: {
        scheduleId: after.id,
        employeeId: request.employeeId,
        changedById: actorId,
        date: schedule.date,
        before,
        after: serialize(after),
        previousValue: before,
        newValue: serialize(after),
        reason: `Troca de turno temporária aprovada pela solicitação ${request.code}`
      }
    });
  }

  await tx.auditLog.create({
    data: {
      actorId,
      action: "ALTERACAO_ESCALA",
      entity: "Schedule",
      entityId: request.id,
      reason: `Troca de turno temporária aplicada em ${schedules.length} cronograma(s).`,
      newValue: {
        requestId: request.id,
        startDate: startDate.toISOString().slice(0, 10),
        endDate: (endDate ?? startDate).toISOString().slice(0, 10),
        desiredShift,
        baseTimes,
        schedulesUpdated: schedules.length
      }
    }
  });

  return {
    updated: true,
    message: `Troca de turno temporária aprovada e aplicada em ${schedules.length} cronograma(s).`,
    applicationStatus: "APPLIED",
    appliedAt: new Date().toISOString(),
    scheduledFor: startDate.toISOString().slice(0, 10),
    profileUpdated: false
  };
}

function parseDateOnly(value: unknown) {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDatePtBr(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(date);
}

function areaForRequest(type: string) {
  if (/equipamento|acesso|suporte/i.test(type)) return /equipamento/i.test(type) ? "TI" : "Operações";
  if (/rh/i.test(type)) return "RH";
  if (/qualidade/i.test(type)) return "Qualidade";
  if (/adiantamento/i.test(type)) return "WFM";
  if (/turno|shift/i.test(type)) return "WFM";
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
  if (/turno/i.test(type)) return "Troca de turno aprovada";
  if (/venda/i.test(type)) return "Sua venda de folga foi aprovada";
  if (/dia de folga/i.test(type)) return "Sua solicitação de folga foi aprovada";
  if (/folga/i.test(type)) return "Sua troca de folga foi aprovada";
  return "Solicitação aprovada";
}

function finalApprovalBody(type: string) {
  if (/turno/i.test(type)) return "Sua troca de turno foi aprovada e seu cronograma foi atualizado.";
  if (/venda/i.test(type)) return "Sua venda de folga foi aprovada e seu cronograma foi atualizado.";
  if (/dia de folga/i.test(type)) return "Sua solicitação de folga foi aprovada e seu cronograma foi atualizado.";
  if (/folga/i.test(type)) return "Sua troca de folga foi aprovada e seu cronograma foi atualizado.";
  return "Sua solicitação foi aprovada.";
}

async function notifyRequestCreationSafely(
  requestId: string,
  code: string,
  type: string,
  userId: string,
  requesterName: string,
  area: string,
  supervisorId: string | null | undefined,
  userEmail: string
) {
  try {
    await notifyApprovers(prisma, requestId, code, type, requesterName, area, supervisorId);
    await prisma.notification.create({
      data: {
        userId,
        title: isDayOffRequest(type) ? "Solicitação de folga criada" : "Solicitação criada",
        body: isDayOffRequest(type) ? "Sua solicitação foi enviada para aprovação." : `${code} foi registrada com status Aberto.`,
        category: "Solicitações",
        type: "REQUEST",
        entity: "Request",
        entityId: requestId,
        href: `/esteiras?request=${code}`
      }
    });
  } catch (error) {
    recordErrorLog({
      userEmail,
      code: "REQUEST_NOTIFICATION_WARNING",
      message: error instanceof Error ? error.message : "Falha ao notificar criação de solicitação",
      route: "/api/requests",
      action: "REQUEST_NOTIFY",
      severity: "WARNING"
    });
  }
}

async function notifyApprovers(
  tx: RequestNotificationClient,
  requestId: string,
  code: string,
  type: string,
  requesterName: string,
  area: string,
  supervisorId?: string | null
) {
  const roleNames = isDayOffRequest(type)
    ? ["ADMIN", "GESTOR"]
    : area === "WFM"
      ? ["ADMIN", "WFM"]
      : area === "RH"
        ? ["ADMIN", "RH", "FINANCEIRO"]
        : ["ADMIN", "GESTOR", "WFM"];
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

async function notifyRequestStatusChangeSafely(request: PrismaRequest, actorId: string, reason: string | undefined, actorEmail: string) {
  try {
    const latestHistory = request.history[0];
    const previousStatus = latestHistory?.from ? normalizeDbRequestStatus(latestHistory.from) : "ABERTO";
    const currentStatus = normalizeDbRequestStatus(request.status);
    const currentUiStatus = dbToUiStatus[currentStatus] ?? "Aberto";
    const payload = (request.payload ?? {}) as Record<string, unknown>;
    const scheduledShiftChange =
      isShiftChangeRequest(request) &&
      String(payload.shiftChangeApplicationStatus ?? "").toUpperCase() === "SCHEDULED";
    const scheduledFor = parseDateOnly(payload.shiftChangeScheduledFor ?? payload.shiftChangeStartDate ?? payload.shiftChangeDate);
    const requesterNotification =
      previousStatus === "ABERTO" && currentStatus === "EM_ANALISE"
        ? {
            title: "Solicitação encaminhada ao WFM",
            body: "Seu supervisor aprovou a primeira etapa. A solicitação está em análise pelo WFM.",
            type: "REQUEST" as NotificationKind
          }
        : scheduledShiftChange && currentStatus === "APROVADO"
          ? {
              title: "Troca de turno agendada",
              body: scheduledFor
                ? `Sua troca de turno foi aprovada e entrará em vigência em ${formatDatePtBr(scheduledFor)}. Seu horário atual será mantido até essa data.`
                : "Sua troca de turno foi aprovada e será aplicada no início da vigência.",
              type: "SUCCESS" as NotificationKind
            }
        : {
            title: notificationTitleForStatus(currentUiStatus, request.type.name),
            body: notificationBodyForStatus(currentUiStatus, request.type.name, reason),
            type: currentStatus === "RECUSADO" ? "ERROR" as NotificationKind : currentStatus === "APROVADO" ? "SUCCESS" as NotificationKind : "INFO" as NotificationKind
          };

    await prisma.notification.create({
      data: {
        userId: request.requesterId,
        title: requesterNotification.title,
        body: requesterNotification.body,
        category: "Solicitações",
        type: requesterNotification.type,
        entity: "Request",
        entityId: request.id,
        href: `/esteiras?request=${request.code}`
      }
    });

    if (previousStatus === "ABERTO" && currentStatus === "EM_ANALISE") {
      await notifyWfmApprovers(prisma, request.id, request.code, request.type.name, request.requester.name);
    }

    if (previousStatus === "EM_ANALISE" && ["APROVADO", "RECUSADO"].includes(currentStatus)) {
      await notifyRequestSupervisor(
        prisma,
        request,
        currentStatus === "APROVADO" ? "Solicitação aprovada pelo WFM" : "Solicitação recusada pelo WFM",
        scheduledShiftChange && currentStatus === "APROVADO" && scheduledFor
          ? `${request.code} foi aprovada pelo WFM e entrará em vigência em ${formatDatePtBr(scheduledFor)}.`
          : `${request.code} foi ${currentStatus === "APROVADO" ? "aprovada" : "recusada"} pelo WFM.`
      );
    }
  } catch (error) {
    recordErrorLog({
      userEmail: actorEmail,
      code: "REQUEST_STATUS_NOTIFICATION_WARNING",
      message: error instanceof Error ? error.message : "Falha ao notificar atualização de solicitação",
      route: "/api/requests/status",
      action: "REQUEST_STATUS_NOTIFICATION",
      severity: "WARNING",
      metadata: { requestId: request.id, code: request.code, actorId }
    });
  }
}

async function notifyWfmApprovers(tx: RequestNotificationClient, requestId: string, code: string, type: string, requesterName: string) {
  const users = await tx.user.findMany({
    where: { status: "ACTIVE", role: { name: { in: wfmFinalRoles } } }
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

async function notifyRequestSupervisor(tx: RequestNotificationClient, request: PrismaRequest, title?: string, body?: string) {
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
  if (/turno/i.test(type)) return "Nova solicitação de troca de turno";
  if (/venda/i.test(type)) return "Nova solicitação de venda de folga";
  if (/dia de folga/i.test(type)) return "Nova solicitação de dia de folga";
  return "Nova solicitação de troca de folga";
}

function serialize(value: unknown) {
  return value ? JSON.parse(JSON.stringify(value)) : {};
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

function formatDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}
