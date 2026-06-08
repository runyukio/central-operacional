import { AuditAction, Prisma, RequestStatus, ScheduleStatus, WorkHourRecordStatus } from "@prisma/client";

import type { Actor } from "@/lib/mock-db";
import { canAccessBilling } from "@/lib/billing-permissions";
import { isAgentJobTitle, normalizeComparableJobTitle } from "@/lib/job-title-normalization";
import { MONTHLY_ADVANCE_FIXED_AMOUNT } from "@/lib/monthly-advance-constants";
import { currentReferenceMonth, formatReferenceMonth, normalizeReferenceMonth } from "@/lib/monthly-advance-service";
import { prisma } from "@/lib/prisma";
import { normalizeRole } from "@/lib/permissions";
import { cleanShiftName } from "@/lib/shift-display";
import type { XlsxExportPayload } from "@/lib/xlsx-export";

export const BILLING_START_MONTH = "2026-06";

const BILLING_REQUEST_TYPE_NAME = "Ajuste de Invoice";
const OPEN_ADJUSTMENT_STATUSES = ["AGUARDANDO_SUPERVISOR", "AGUARDANDO_ADMIN"] as const;
const BILLABLE_WORK_HOUR_STATUSES: WorkHourRecordStatus[] = [
  "IMPORTED",
  "OK",
  "DIVERGENT",
  "ADJUSTMENT_APPROVED",
  "ADJUSTMENT_REJECTED",
  "MANUALLY_CORRECTED"
];
const PROJECTABLE_SCHEDULE_STATUSES = new Set<ScheduleStatus>(["ESCALADO", "PRESENTE", "VENDA_FOLGA_APROVADA", "TROCA_APROVADA"]);

const DEFAULT_RATE_CONFIGS = [
  { key: "MORNING_HOURLY_RATE", label: "Valor hora Manhã", value: 11.36 },
  { key: "AFTERNOON_HOURLY_RATE", label: "Valor hora Tarde", value: 11.36 },
  { key: "NIGHT_HOURLY_RATE", label: "Valor hora Noite", value: 13.1 },
  { key: "BILINGUAL_HOURLY_RATE", label: "Valor hora Bilingual", value: 62.5 },
  { key: "RA_HOURLY_RATE", label: "Valor hora RA", value: 14.2 }
] as const;

type ActiveUser = NonNullable<Awaited<ReturnType<typeof findActiveUser>>>;
type BillingEmployee = Prisma.EmployeeProfileGetPayload<{
  include: {
    user: true;
    lob: true;
    supervisor: true;
    shift: true;
  };
}>;

export type BillingDashboardFilters = {
  referenceMonth?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  lob?: string | null;
  supervisorId?: string | null;
  skill?: string | null;
  shiftId?: string | null;
  employeeId?: string | null;
  employeeStatus?: string | null;
  invoiceStatus?: string | null;
  cycleStatus?: string | null;
  search?: string | null;
  section?: string | null;
};

type BillingDashboardSection = "lob" | "employees" | "hours" | "adjustments" | "rates" | "all";
type BillingRates = Record<(typeof DEFAULT_RATE_CONFIGS)[number]["key"], number>;
type InvoiceExtra = {
  status?: string;
  approvedByEmployeeAt?: Date;
  approvedByEmployeeUserId?: string;
};
type InvoiceCalculation = Awaited<ReturnType<typeof calculateEmployeeInvoice>>;

const PERFORMANCE_DEBUG = process.env.PERFORMANCE_DEBUG === "true";

export async function getBillingDashboard(actor: Actor, filters: BillingDashboardFilters = {}) {
  const user = await findActiveUser(actor.email);
  const denied = requireBillingAccess(user);
  if (denied) return denied;

  const referenceMonth = normalizeBillingMonth(filters.referenceMonth);
  if (!isBillingMonthAvailable(referenceMonth)) return billingUnavailable();

  const startedAt = Date.now();
  const section = normalizeBillingSection(filters.section);
  const [cycle, rates] = await Promise.all([
    prisma.billingCycle.findUnique({ where: { referenceMonth } }),
    getBillingRates()
  ]);
  const invoices = await buildBillingInvoicesReadModel(referenceMonth, rates, cycle, filters, {
    includeHourDetails: section === "hours" || section === "all"
  });
  const filteredInvoices = filterInvoices(invoices, filters);
  const cycleStatus = cycle?.status ?? "ABERTO";
  const summary = buildDashboardSummary(filteredInvoices, cycleStatus);
  const byLob = buildLobSummary(filteredInvoices);
  const [adjustments, adjustmentRequests, rateConfigs] = await Promise.all([
    cycle && (section === "adjustments" || section === "all") ? listCycleAdjustments(cycle.id) : Promise.resolve([]),
    cycle && (section === "adjustments" || section === "all") ? listInvoiceAdjustmentRequests(cycle.id) : Promise.resolve([]),
    section === "rates" || section === "all" ? listBillingRateConfigs() : Promise.resolve([])
  ]);

  logPerformance("billing.dashboard", startedAt, {
    referenceMonth,
    section,
    employees: filteredInvoices.length,
    hasCycle: Boolean(cycle)
  });

  return {
    data: {
      referenceMonth,
      monthLabel: formatReferenceMonth(referenceMonth),
      startDate: filters.startDate || monthPeriod(referenceMonth).startInput,
      endDate: filters.endDate || monthPeriod(referenceMonth).endInput,
      startMonth: BILLING_START_MONTH,
      cycle: mapCycle(cycle ?? virtualBillingCycle(referenceMonth)),
      summary,
      byLob,
      invoices: filteredInvoices,
      adjustments,
      adjustmentRequests,
      rateConfigs
    }
  };
}

export async function getMyBillingInvoice(actor: Actor, referenceMonthInput?: string | null) {
  const user = await findActiveUser(actor.email);
  if (!user) return { error: "Usuário ativo não encontrado.", status: 401 };
  if (!user.employeeProfile) return { error: "Seu usuário não está vinculado a um cadastro de colaborador.", status: 400 };

  const referenceMonth = normalizeBillingMonth(referenceMonthInput);
  if (!isBillingMonthAvailable(referenceMonth)) return billingUnavailable();

  const rates = await getBillingRates();
  const cycle = await prisma.billingCycle.findUnique({ where: { referenceMonth } });
  const invoice = await calculateEmployeeInvoice(user.employeeProfile as BillingEmployee, referenceMonth, rates, cycle?.id ?? null, cycle?.status);
  const persisted = cycle
    ? await prisma.billingEmployeeInvoice.findUnique({
      where: { billingCycleId_employeeId: { billingCycleId: cycle.id, employeeId: user.employeeProfile.id } }
    })
    : null;
  const adjustmentRequests = persisted
    ? await prisma.invoiceAdjustmentRequest.findMany({
      where: { employeeInvoiceId: persisted.id },
      orderBy: { createdAt: "desc" },
      take: 5
    })
    : [];
  const history = await buildInvoiceHistory(user.employeeProfile.id);

  return {
    data: {
      referenceMonth,
      monthLabel: formatReferenceMonth(referenceMonth),
      startMonth: BILLING_START_MONTH,
      cycle: cycle ? mapCycle(cycle) : null,
      invoice: {
        ...invoice,
        id: persisted?.id ?? "",
        status: persisted?.status ?? invoice.status,
        canApprove: canEmployeeApproveInvoice(cycle?.status, persisted?.status ?? invoice.status),
        canRequestAdjustment: canEmployeeRequestAdjustment(cycle?.status, persisted?.status ?? invoice.status, adjustmentRequests)
      },
      weeklyApprovedHours: buildWeeklyApprovedHours(invoice.hourDetails),
      composition: buildInvoiceComposition(invoice),
      adjustmentRequests: adjustmentRequests.map(mapAdjustmentRequest),
      history
    }
  };
}

export async function getEmployeeBillingPreview(employeeId: string) {
  const referenceMonth = normalizeBillingMonth(currentReferenceMonth());
  if (!isBillingMonthAvailable(referenceMonth)) return null;
  const employee = await prisma.employeeProfile.findFirst({
    where: { id: employeeId, deletedAt: null },
    include: { user: true, lob: true, supervisor: true, shift: true }
  });
  if (!employee || !isAgentJobTitle(employee.roleTitle)) return null;
  const cycle = await prisma.billingCycle.findUnique({ where: { referenceMonth } });
  const invoice = await calculateEmployeeInvoice(employee, referenceMonth, await getBillingRates(), cycle?.id ?? null, cycle?.status);
  const persisted = cycle
    ? await prisma.billingEmployeeInvoice.findUnique({
      where: { billingCycleId_employeeId: { billingCycleId: cycle.id, employeeId } },
      select: { status: true, approvedByEmployeeAt: true }
    })
    : null;

  return {
    referenceMonth,
    monthLabel: formatReferenceMonth(referenceMonth),
    status: persisted?.status ?? invoice.status,
    cycleStatus: cycle?.status ?? "SEM_CICLO",
    approvedHours: minutesToHoursLabel(invoice.approvedMinutes),
    projectedHours: minutesToHoursLabel(invoice.projectedMinutes),
    projectedDays: invoice.projectedDays,
    totalHours: minutesToHoursLabel(invoice.totalConsideredMinutes),
    hourlyRate: invoice.hourlyRate,
    grossAmount: invoice.grossAmount,
    advanceAmount: invoice.advanceAmount,
    campaignAmount: invoice.campaignAmount,
    adjustmentAmount: invoice.adjustmentAmount,
    finalAmount: invoice.finalAmount,
    message: cycle?.status === "FINALIZADO_CONFERENCIA"
      ? "Invoice disponível para conferência."
      : "Este valor ainda é uma previsão e pode mudar até o fechamento do Billing."
  };
}

export async function approveMyBillingInvoice(actor: Actor, input: { referenceMonth?: string | null }) {
  const user = await findActiveUser(actor.email);
  if (!user) return { error: "Usuário ativo não encontrado.", status: 401 };
  if (!user.employeeProfile) return { error: "Seu usuário não está vinculado a um cadastro de colaborador.", status: 400 };

  const referenceMonth = normalizeBillingMonth(input.referenceMonth);
  if (!isBillingMonthAvailable(referenceMonth)) return billingUnavailable();
  const cycle = await prisma.billingCycle.findUnique({ where: { referenceMonth } });
  if (!cycle || cycle.status !== "FINALIZADO_CONFERENCIA") return { error: "Invoice ainda não está disponível para aprovação.", status: 403 };

  const rates = await getBillingRates();
  const calculated = await calculateEmployeeInvoice(user.employeeProfile as BillingEmployee, referenceMonth, rates, cycle.id, cycle.status);
  const invoice = await upsertEmployeeInvoice(cycle.id, calculated, {
    status: "APROVADO_COLABORADOR",
    approvedByEmployeeAt: new Date(),
    approvedByEmployeeUserId: user.id
  });

  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      action: AuditAction.APROVACAO,
      entity: "BillingEmployeeInvoice",
      entityId: invoice.id,
      reason: "Invoice aprovado pelo colaborador",
      newValue: {
        referenceMonth,
        employeeId: user.employeeProfile.id,
        finalAmount: calculated.finalAmount,
        totalMinutes: calculated.totalConsideredMinutes
      }
    }
  });

  return { data: { id: invoice.id, status: "Aprovado pelo colaborador" } };
}

export async function submitInvoiceAdjustmentRequest(actor: Actor, input: {
  referenceMonth?: string | null;
  type: string;
  questionedItem: string;
  description: string;
}) {
  const user = await findActiveUser(actor.email);
  if (!user) return { error: "Usuário ativo não encontrado.", status: 401 };
  if (!user.employeeProfile) return { error: "Seu usuário não está vinculado a um cadastro de colaborador.", status: 400 };

  const referenceMonth = normalizeBillingMonth(input.referenceMonth);
  if (!isBillingMonthAvailable(referenceMonth)) return billingUnavailable();
  if (!input.type?.trim()) return { error: "Tipo do ajuste é obrigatório.", status: 400 };
  if (!input.questionedItem?.trim()) return { error: "Item questionado é obrigatório.", status: 400 };
  if (!input.description?.trim()) return { error: "Descrição do ajuste é obrigatória.", status: 400 };

  const cycle = await prisma.billingCycle.findUnique({ where: { referenceMonth } });
  if (!cycle || cycle.status !== "FINALIZADO_CONFERENCIA") return { error: "Invoice ainda não está disponível para solicitação de ajuste.", status: 403 };

  const rates = await getBillingRates();
  const calculated = await calculateEmployeeInvoice(user.employeeProfile as BillingEmployee, referenceMonth, rates, cycle.id, cycle.status);
  const invoice = await upsertEmployeeInvoice(cycle.id, calculated);
  if (invoice.status === "APROVADO_COLABORADOR") return { error: "Este invoice já foi aprovado. Apenas o Admin Central pode reabrir.", status: 409 };

  const duplicate = await prisma.invoiceAdjustmentRequest.findFirst({
    where: { employeeInvoiceId: invoice.id, status: { in: [...OPEN_ADJUSTMENT_STATUSES] } },
    select: { id: true }
  });
  if (duplicate) return { error: "Já existe uma solicitação de ajuste aberta para este ciclo.", status: 409 };
  const requestType = await prisma.requestType.findUnique({
    where: { name: BILLING_REQUEST_TYPE_NAME },
    select: { id: true }
  });
  if (!requestType) {
    return {
      error: "Tipo de solicitação Ajuste de Invoice não está configurado. Rode as migrations/seeds antes de usar este fluxo.",
      status: 500
    };
  }

  const created = await prisma.$transaction(async (tx) => {
    const request = await tx.request.create({
      data: {
        code: await nextRequestCode(tx),
        title: `Ajuste de Invoice - ${formatReferenceMonth(referenceMonth)}`,
        description: input.description.trim(),
        requesterId: user.id,
        employeeId: user.employeeProfile!.id,
        typeId: requestType.id,
        assignedArea: "Supervisor",
        priority: "MEDIA",
        status: RequestStatus.ABERTO,
        payload: {
          invoiceAdjustment: true,
          referenceMonth,
          type: input.type.trim(),
          questionedItem: input.questionedItem.trim(),
          currentFinalAmount: calculated.finalAmount,
          currentApprovedMinutes: calculated.approvedMinutes
        },
        history: {
          create: {
            actorId: user.id,
            action: "Criação",
            to: RequestStatus.ABERTO,
            reason: "Solicitação de ajuste de invoice"
          }
        },
        comments: {
          create: { authorId: user.id, message: input.description.trim() }
        }
      }
    });
    const adjustmentRequest = await tx.invoiceAdjustmentRequest.create({
      data: {
        billingCycleId: cycle.id,
        employeeInvoiceId: invoice.id,
        employeeId: user.employeeProfile!.id,
        requestId: request.id,
        type: input.type.trim(),
        questionedItem: input.questionedItem.trim(),
        description: input.description.trim(),
        status: "AGUARDANDO_SUPERVISOR"
      }
    });
    await tx.billingEmployeeInvoice.update({
      where: { id: invoice.id },
      data: { status: "AGUARDANDO_SUPERVISOR" }
    });
    await tx.auditLog.create({
      data: {
        actorId: user.id,
        action: AuditAction.CRIACAO,
        entity: "InvoiceAdjustmentRequest",
        entityId: adjustmentRequest.id,
        reason: "Solicitação de ajuste de invoice criada",
        newValue: { requestId: request.id, referenceMonth, employeeId: user.employeeProfile!.id }
      }
    });
    return { request, adjustmentRequest };
  });

  return { data: { id: created.adjustmentRequest.id, requestCode: created.request.code, status: "Aguardando supervisor" } };
}

export async function supervisorReviewInvoiceAdjustment(actor: Actor, input: { id: string; observation: string }) {
  const user = await findActiveUser(actor.email);
  if (!user) return { error: "Usuário ativo não encontrado.", status: 401 };
  const role = normalizeRole(user.role.name);
  if (!["SUPERVISOR", "GESTOR", "COORDENADOR", "GERENTE", "ADMIN", "WFM", "RH"].includes(role)) {
    return { error: "Apenas perfis de aprovação podem validar ajuste de invoice.", status: 403 };
  }
  if (!input.observation?.trim()) return { error: "Observação do supervisor é obrigatória.", status: 400 };

  const existing = await prisma.invoiceAdjustmentRequest.findUnique({ where: { id: input.id }, include: { request: true, employeeInvoice: true } });
  if (!existing) return { error: "Solicitação de ajuste não encontrada.", status: 404 };
  if (existing.status !== "AGUARDANDO_SUPERVISOR") return { error: "Esta solicitação não está aguardando validação do supervisor.", status: 409 };

  const updated = await prisma.$transaction(async (tx) => {
    const item = await tx.invoiceAdjustmentRequest.update({
      where: { id: input.id },
      data: {
        supervisorChecked: true,
        supervisorObservation: input.observation.trim(),
        supervisorCheckedById: user.id,
        supervisorCheckedAt: new Date(),
        status: "AGUARDANDO_ADMIN"
      }
    });
    await tx.billingEmployeeInvoice.update({
      where: { id: existing.employeeInvoiceId },
      data: { status: "AGUARDANDO_ADMIN" }
    });
    if (existing.requestId) {
      await tx.request.update({
        where: { id: existing.requestId },
        data: { status: RequestStatus.EM_ANALISE, assignedArea: "Billing Admin" }
      });
      await tx.requestHistory.create({
        data: {
          requestId: existing.requestId,
          actorId: user.id,
          action: "Validação do supervisor",
          from: existing.request?.status ?? RequestStatus.ABERTO,
          to: RequestStatus.EM_ANALISE,
          reason: input.observation.trim()
        }
      });
      await tx.requestComment.create({ data: { requestId: existing.requestId, authorId: user.id, message: input.observation.trim() } });
    }
    await tx.auditLog.create({
      data: {
        actorId: user.id,
        action: AuditAction.APROVACAO,
        entity: "InvoiceAdjustmentRequest",
        entityId: input.id,
        reason: "Supervisor validou ajuste de invoice",
        newValue: { status: "AGUARDANDO_ADMIN", observation: input.observation.trim() }
      }
    });
    return item;
  });

  return { data: mapAdjustmentRequest(updated) };
}

export async function adminDecideInvoiceAdjustment(actor: Actor, input: {
  id: string;
  decision: "APROVADO" | "RECUSADO";
  finalResponse: string;
  adjustmentAmount?: number | null;
  finalMinutes?: number | null;
}) {
  const user = await findActiveUser(actor.email);
  const denied = requireBillingAccess(user);
  if (denied) return denied;
  if (!input.finalResponse?.trim()) return { error: "Resposta final do Admin é obrigatória.", status: 400 };

  const existing = await prisma.invoiceAdjustmentRequest.findUnique({
    where: { id: input.id },
    include: { request: true, employeeInvoice: true, billingCycle: true }
  });
  if (!existing) return { error: "Solicitação de ajuste não encontrada.", status: 404 };
  if (existing.status !== "AGUARDANDO_ADMIN") return { error: "Esta solicitação não está aguardando análise do Admin.", status: 409 };

  const amount = numberOrZero(input.adjustmentAmount);
  const completed = await prisma.$transaction(async (tx) => {
    let manualAdjustmentId: string | null = null;
    if (input.decision === "APROVADO" && amount !== 0) {
      const adjustment = await tx.billingAdjustment.create({
        data: {
          billingCycleId: existing.billingCycleId,
          employeeInvoiceId: existing.employeeInvoiceId,
          referenceMonth: existing.billingCycle.referenceMonth,
          type: "Correção",
          description: input.finalResponse.trim(),
          amount: decimal(amount),
          employeeId: existing.employeeId,
          createdById: user!.id
        }
      });
      manualAdjustmentId = adjustment.id;
    }
    const newStatus = input.decision === "APROVADO" ? "AJUSTE_CONCLUIDO" : "RECUSADO";
    const item = await tx.invoiceAdjustmentRequest.update({
      where: { id: input.id },
      data: {
        adminDecision: input.decision,
        adminFinalResponse: input.finalResponse.trim(),
        adminAdjustmentAmount: decimalOrNull(input.adjustmentAmount),
        adminFinalMinutes: input.finalMinutes ?? null,
        adminDecidedById: user!.id,
        adminDecidedAt: new Date(),
        status: newStatus,
        completedAt: new Date()
      }
    });
    await tx.billingEmployeeInvoice.update({
      where: { id: existing.employeeInvoiceId },
      data: { status: "AJUSTE_CONCLUIDO" }
    });
    if (existing.requestId) {
      const requestStatus = input.decision === "APROVADO" ? RequestStatus.CONCLUIDO : RequestStatus.RECUSADO;
      await tx.request.update({
        where: { id: existing.requestId },
        data: { status: requestStatus }
      });
      await tx.requestHistory.create({
        data: {
          requestId: existing.requestId,
          actorId: user!.id,
          action: input.decision === "APROVADO" ? "Ajuste concluído" : "Ajuste recusado",
          from: existing.request?.status ?? RequestStatus.EM_ANALISE,
          to: requestStatus,
          reason: input.finalResponse.trim()
        }
      });
      await tx.requestComment.create({ data: { requestId: existing.requestId, authorId: user!.id, message: input.finalResponse.trim() } });
    }
    await tx.auditLog.create({
      data: {
        actorId: user!.id,
        action: input.decision === "APROVADO" ? AuditAction.APROVACAO : AuditAction.RECUSA,
        entity: "InvoiceAdjustmentRequest",
        entityId: input.id,
        reason: "Admin decidiu ajuste de invoice",
        newValue: { decision: input.decision, amount, manualAdjustmentId }
      }
    });
    return item;
  });

  return { data: mapAdjustmentRequest(completed) };
}

export async function updateBillingCycleStatus(actor: Actor, input: { referenceMonth?: string | null; status: string }) {
  const user = await findActiveUser(actor.email);
  const denied = requireBillingAccess(user);
  if (denied) return denied;
  const referenceMonth = normalizeBillingMonth(input.referenceMonth);
  if (!isBillingMonthAvailable(referenceMonth)) return billingUnavailable();
  const nextStatus = input.status?.trim();
  if (!nextStatus) return { error: "Status do ciclo é obrigatório.", status: 400 };
  const cycle = await ensureBillingCycle(referenceMonth);
  const data: Prisma.BillingCycleUpdateInput = { status: nextStatus };
  if (nextStatus === "FINALIZADO_CONFERENCIA") {
    data.finalizedAt = new Date();
    data.finalizedBy = { connect: { id: user!.id } };
  }
  if (nextStatus === "FECHADO") {
    data.closedAt = new Date();
    data.closedBy = { connect: { id: user!.id } };
  }
  const updated = await prisma.billingCycle.update({ where: { id: cycle.id }, data });
  await prisma.auditLog.create({
    data: {
      actorId: user!.id,
      action: AuditAction.EDICAO,
      entity: "BillingCycle",
      entityId: cycle.id,
      reason: "Status do ciclo de Billing atualizado",
      previousValue: { status: cycle.status },
      newValue: { status: updated.status, referenceMonth }
    }
  });
  return { data: mapCycle(updated) };
}

export async function saveBillingRates(actor: Actor, input: Record<string, number>) {
  const user = await findActiveUser(actor.email);
  const denied = requireBillingAccess(user);
  if (denied) return denied;
  const validKeys = new Set(DEFAULT_RATE_CONFIGS.map((item) => item.key));
  const updates = Object.entries(input).filter(([key]) => validKeys.has(key as keyof BillingRates));
  if (!updates.length) return { error: "Nenhuma configuração de valor/hora enviada.", status: 400 };
  for (const [, value] of updates) {
    if (!Number.isFinite(Number(value)) || Number(value) < 0) return { error: "Valor/hora inválido. Não use valores negativos.", status: 400 };
  }

  const records = await prisma.$transaction(async (tx) => {
    const saved = [];
    for (const [key, value] of updates) {
      const config = DEFAULT_RATE_CONFIGS.find((item) => item.key === key)!;
      const before = await tx.billingRateConfig.findUnique({ where: { key } });
      const record = await tx.billingRateConfig.upsert({
        where: { key },
        update: { value: decimal(value), active: true, updatedById: user!.id },
        create: { key, label: config.label, value: decimal(value), active: true, updatedById: user!.id }
      });
      await tx.auditLog.create({
        data: {
          actorId: user!.id,
          action: AuditAction.EDICAO,
          entity: "BillingRateConfig",
          entityId: record.id,
          reason: "Valor/hora do Billing atualizado",
          previousValue: before ? { key, value: Number(before.value) } : undefined,
          newValue: { key, value: Number(record.value) }
        }
      });
      saved.push(record);
    }
    return saved;
  });

  return { data: records.map(mapRateConfig) };
}

export async function createBillingAdjustment(actor: Actor, input: {
  referenceMonth?: string | null;
  employeeInvoiceId?: string | null;
  employeeId?: string | null;
  lobId?: string | null;
  type: string;
  description: string;
  amount: number;
  observation?: string | null;
}) {
  const user = await findActiveUser(actor.email);
  const denied = requireBillingAccess(user);
  if (denied) return denied;
  const referenceMonth = normalizeBillingMonth(input.referenceMonth);
  if (!isBillingMonthAvailable(referenceMonth)) return billingUnavailable();
  if (!input.type?.trim()) return { error: "Tipo de ajuste é obrigatório.", status: 400 };
  if (!input.description?.trim()) return { error: "Descrição do ajuste é obrigatória.", status: 400 };
  if (!Number.isFinite(Number(input.amount))) return { error: "Valor do ajuste inválido.", status: 400 };
  const cycle = await ensureBillingCycle(referenceMonth);
  const adjustment = await prisma.billingAdjustment.create({
    data: {
      billingCycleId: cycle.id,
      employeeInvoiceId: input.employeeInvoiceId || null,
      referenceMonth,
      type: input.type.trim(),
      description: input.description.trim(),
      amount: decimal(input.amount),
      employeeId: input.employeeId || null,
      lobId: input.lobId || null,
      observation: input.observation?.trim() || null,
      createdById: user!.id
    }
  });
  await prisma.auditLog.create({
    data: {
      actorId: user!.id,
      action: AuditAction.CRIACAO,
      entity: "BillingAdjustment",
      entityId: adjustment.id,
      reason: "Ajuste manual de Billing criado",
      newValue: { referenceMonth, type: adjustment.type, amount: Number(adjustment.amount), employeeId: adjustment.employeeId, lobId: adjustment.lobId }
    }
  });
  return { data: mapAdjustment(adjustment) };
}

export async function exportBilling(actor: Actor, filters: BillingDashboardFilters = {}): Promise<XlsxExportPayload | { error: string; status?: number }> {
  const result = await getBillingDashboard(actor, { ...filters, section: "all" });
  if ("error" in result) return result;
  const data = result.data;

  return {
    fileName: `billing_${data.referenceMonth}.xlsx`,
    sheetName: "Consolidado",
    headers: ["mes", "valor_bruto", "adiantamento", "ajustes", "valor_final", "horas_aprovadas", "agentes_com_horas", "status_ciclo"],
    rows: [[
      data.referenceMonth,
      moneyText(data.summary.grossAmount),
      moneyText(data.summary.advanceAmount),
      moneyText(data.summary.adjustmentAmount),
      moneyText(data.summary.finalAmount),
      minutesToHoursLabel(data.summary.approvedMinutes),
      data.summary.agentsWithHours,
      data.cycle.statusLabel
    ]],
    sheets: [
      {
        sheetName: "Por LOB",
        headers: ["lob", "agentes", "horas_aprovadas", "valor_bruto", "adiantamento", "ajustes", "valor_final"],
        rows: data.byLob.map((row) => [row.lob, row.agents, minutesToHoursLabel(row.approvedMinutes), moneyText(row.grossAmount), moneyText(row.advanceAmount), moneyText(row.adjustmentAmount), moneyText(row.finalAmount)])
      },
      {
        sheetName: "Por Colaborador",
        headers: ["nome", "wb_login", "status_colaborador", "lob", "supervisor", "skill", "turno_oficial", "regra_billing", "valor_hora", "horas_aprovadas", "horas_projetadas", "total_horas", "valor_bruto", "adiantamento", "campanha", "ajustes", "valor_final", "status_invoice", "aprovado_em"],
        rows: data.invoices.map((row) => [row.employeeName, row.wbLogin, row.employeeStatus, row.lob, row.supervisor, row.skill, row.officialShift, row.billingRule, moneyText(row.hourlyRate), minutesToHoursLabel(row.approvedMinutes), minutesToHoursLabel(row.projectedMinutes), minutesToHoursLabel(row.totalConsideredMinutes), moneyText(row.grossAmount), moneyText(row.advanceAmount), moneyText(row.campaignAmount), moneyText(row.adjustmentAmount), moneyText(row.finalAmount), row.statusLabel, row.approvedByEmployeeAt || ""])
      },
      {
        sheetName: "Detalhamento de Horas",
        headers: ["data", "nome", "wb_login", "status_colaborador", "lob", "supervisor", "skill", "turno_oficial", "turno_slot", "horas_aprovadas", "valor_hora", "valor_calculado"],
        rows: data.invoices.flatMap((row) => row.hourDetails.map((detail) => [detail.date, row.employeeName, row.wbLogin, row.employeeStatus, row.lob, row.supervisor, row.skill, row.officialShift, detail.shift, minutesToHoursLabel(detail.minutes), moneyText(row.hourlyRate), moneyText(detail.amount)]))
      },
      {
        sheetName: "Ajustes",
        headers: ["tipo_ajuste", "descricao", "mes", "colaborador", "lob", "valor", "criado_por", "criado_em"],
        rows: data.adjustments.map((row) => [row.type, row.description, row.referenceMonth, row.employeeName || "", row.lob || "", moneyText(row.amount), row.createdBy, row.createdAt])
      },
      {
        sheetName: "Aprovações",
        headers: ["colaborador", "wb_login", "status_invoice", "aprovado_em", "ajuste_aberto", "valor_final"],
        rows: data.invoices.map((row) => [row.employeeName, row.wbLogin, row.statusLabel, row.approvedByEmployeeAt || "", row.hasOpenAdjustment ? "Sim" : "Não", moneyText(row.finalAmount)])
      },
      {
        sheetName: "Configurações",
        headers: ["regra", "valor", "vigente_desde", "atualizado_por", "atualizado_em"],
        rows: data.rateConfigs.map((row) => [row.label, moneyText(row.value), row.effectiveFrom, row.updatedBy || "", row.updatedAt])
      }
    ]
  };
}

async function buildBillingInvoicesReadModel(
  referenceMonth: string,
  rates: BillingRates,
  cycle: { id: string; status: string } | null,
  filters: BillingDashboardFilters,
  options: { includeHourDetails: boolean }
) {
  const startedAt = Date.now();
  const employees = await listBillingEmployees(filters);
  const employeeIds = employees.map((employee) => employee.id);
  if (!employeeIds.length) return [] as InvoiceCalculation[];

  const period = monthPeriod(referenceMonth);
  const today = startOfUtcDay(new Date());
  const projectionStart = new Date(Math.max(period.start.getTime(), today.getTime() + 24 * 60 * 60 * 1000));
  const lobIds = Array.from(new Set(employees.map((employee) => employee.lobId).filter(Boolean))) as string[];

  const [workHours, schedules, advances, persistedInvoices] = await Promise.all([
    prisma.workHourRecord.findMany({
      where: {
        employeeId: { in: employeeIds },
        date: { gte: period.start, lte: period.end },
        status: { in: BILLABLE_WORK_HOUR_STATUSES }
      },
      select: { employeeId: true, date: true, effectiveHours: true, status: true },
      orderBy: { date: "asc" }
    }),
    projectionStart.getTime() <= period.end.getTime()
      ? prisma.schedule.findMany({
        where: {
          employeeId: { in: employeeIds },
          deletedAt: null,
          date: { gte: projectionStart, lte: period.end },
          status: { in: Array.from(PROJECTABLE_SCHEDULE_STATUSES) }
        },
        select: { employeeId: true, date: true, status: true, shift: { select: { name: true } } },
        orderBy: { date: "asc" }
      })
      : Promise.resolve([]),
    prisma.monthlyAdvanceRecord.findMany({
      where: { employeeId: { in: employeeIds }, referenceMonth },
      select: { employeeId: true, optIn: true, amount: true, finalAmount: true }
    }),
    cycle
      ? prisma.billingEmployeeInvoice.findMany({
        where: { billingCycleId: cycle.id, employeeId: { in: employeeIds } },
        select: { id: true, employeeId: true, status: true, approvedByEmployeeAt: true, approvedByEmployeeUserId: true }
      })
      : Promise.resolve([])
  ]);

  const persistedByEmployee = new Map(persistedInvoices.map((invoice) => [invoice.employeeId, invoice]));
  const invoiceEmployeeById = new Map(persistedInvoices.map((invoice) => [invoice.id, invoice.employeeId]));
  const invoiceIds = persistedInvoices.map((invoice) => invoice.id);

  const [adjustmentRows, openRequests] = cycle
    ? await Promise.all([
      prisma.billingAdjustment.findMany({
        where: {
          billingCycleId: cycle.id,
          deletedAt: null,
          OR: [
            { employeeId: { in: employeeIds } },
            ...(lobIds.length ? [{ lobId: { in: lobIds } }] : []),
            ...(invoiceIds.length ? [{ employeeInvoiceId: { in: invoiceIds } }] : [])
          ]
        },
        select: { id: true, type: true, amount: true, employeeId: true, lobId: true, employeeInvoiceId: true }
      }),
      invoiceIds.length
        ? prisma.invoiceAdjustmentRequest.findMany({
          where: { employeeInvoiceId: { in: invoiceIds }, status: { in: [...OPEN_ADJUSTMENT_STATUSES] } },
          select: { employeeInvoiceId: true }
        })
        : Promise.resolve([])
    ])
    : [[], []];

  const workHoursByEmployee = groupBy(workHours, (record) => record.employeeId);
  const schedulesByEmployee = groupBy(schedules, (schedule) => schedule.employeeId);
  const advanceByEmployee = new Map(advances.map((advance) => [advance.employeeId, advance]));
  const openAdjustmentInvoiceIds = new Set(openRequests.map((request) => request.employeeInvoiceId));
  const employeesByLob = new Map<string, string[]>();
  for (const employee of employees) {
    if (!employee.lobId) continue;
    employeesByLob.set(employee.lobId, [...(employeesByLob.get(employee.lobId) ?? []), employee.id]);
  }
  const adjustmentsByEmployee = new Map<string, typeof adjustmentRows>();
  for (const row of adjustmentRows) {
    const targetEmployeeIds = row.employeeId
      ? [row.employeeId]
      : row.employeeInvoiceId
        ? [invoiceEmployeeById.get(row.employeeInvoiceId)].filter(Boolean) as string[]
        : row.lobId
          ? (employeesByLob.get(row.lobId) ?? [])
          : [];
    for (const employeeId of targetEmployeeIds) {
      adjustmentsByEmployee.set(employeeId, [...(adjustmentsByEmployee.get(employeeId) ?? []), row]);
    }
  }

  const invoices: InvoiceCalculation[] = [];
  for (const employee of employees) {
    const rate = resolveHourlyRate(employee, rates);
    const employeeWorkHours = workHoursByEmployee.get(employee.id) ?? [];
    const approvedByDate = new Map(employeeWorkHours.map((record) => [dateKey(record.date), Math.max(0, Math.round(Number(record.effectiveHours ?? 0) * 60))]));
    const approvedMinutes = Array.from(approvedByDate.values()).reduce((sum, minutes) => sum + minutes, 0);
    const approvedDetails = options.includeHourDetails
      ? employeeWorkHours.map((record) => ({
        kind: "APPROVED" as const,
        date: dateInput(record.date),
        shift: employee.shift ? cleanShiftName(employee.shift.name) : "",
        minutes: Math.max(0, Math.round(Number(record.effectiveHours ?? 0) * 60)),
        amount: roundMoney(Math.max(0, Number(record.effectiveHours ?? 0)) * rate.hourlyRate)
      }))
      : [];
    const projectedSchedules = (schedulesByEmployee.get(employee.id) ?? []).filter((schedule) => !approvedByDate.has(dateKey(schedule.date)));
    const projectedMinutes = projectedSchedules.length * 480;
    const projectedDetails = options.includeHourDetails
      ? projectedSchedules.map((schedule) => ({
        kind: "PROJECTED" as const,
        date: dateInput(schedule.date),
        shift: schedule.shift ? cleanShiftName(schedule.shift.name) : "",
        minutes: 480,
        amount: roundMoney(8 * rate.hourlyRate)
      }))
      : [];
    const totalConsideredMinutes = approvedMinutes + projectedMinutes;
    const grossAmount = roundMoney((totalConsideredMinutes / 60) * rate.hourlyRate);
    const advance = advanceByEmployee.get(employee.id);
    const adjustmentRowsForEmployee = adjustmentsByEmployee.get(employee.id) ?? [];
    const persisted = persistedByEmployee.get(employee.id);
    const status = persisted?.status ?? defaultInvoiceStatusForCycle(cycle?.status);
    const advanceAmount = advance?.optIn ? roundMoney(Number(advance.finalAmount ?? advance.amount ?? MONTHLY_ADVANCE_FIXED_AMOUNT)) : 0;
    const campaignAmount = roundMoney(adjustmentRowsForEmployee.filter((row) => normalizeComparableJobTitle(row.type) === "campanha").reduce((sum, row) => sum + Number(row.amount), 0));
    const adjustmentAmount = roundMoney(adjustmentRowsForEmployee.filter((row) => normalizeComparableJobTitle(row.type) !== "campanha").reduce((sum, row) => sum + Number(row.amount), 0));
    const finalAmount = roundMoney(grossAmount - advanceAmount + campaignAmount + adjustmentAmount);

    invoices.push({
      id: persisted?.id ?? "",
      referenceMonth,
      employeeId: employee.id,
      employeeName: employee.fullName,
      wbLogin: employee.wbLogin,
      email: employee.user?.email ?? "",
      employeeStatus: employee.operationalStatus ?? "",
      lob: employee.lob?.name ?? "Sem LOB",
      lobId: employee.lobId,
      supervisor: employee.supervisor?.fullName ?? "Sem supervisor",
      supervisorId: employee.supervisorId ?? "",
      skill: employee.skill ?? "",
      officialShift: employee.shift ? cleanShiftName(employee.shift.name) : "Sem turno",
      officialShiftId: employee.shiftId,
      status,
      statusLabel: invoiceStatusLabel(status),
      approvedByEmployeeAt: persisted?.approvedByEmployeeAt ? formatDateTime(persisted.approvedByEmployeeAt) : "",
      approvedMinutes,
      projectedMinutes,
      projectedDays: projectedSchedules.length,
      totalConsideredMinutes,
      hourlyRate: rate.hourlyRate,
      billingRule: rate.billingRule,
      grossAmount,
      advanceAmount,
      campaignAmount,
      adjustmentAmount,
      finalAmount,
      hasOpenAdjustment: persisted ? openAdjustmentInvoiceIds.has(persisted.id) : false,
      hourDetails: [...approvedDetails, ...projectedDetails]
    });
  }

  logPerformance("billing.invoices.read_model", startedAt, {
    employees: employees.length,
    workHourRows: workHours.length,
    scheduleRows: schedules.length,
    adjustmentRows: adjustmentRows.length,
    includeHourDetails: options.includeHourDetails
  });

  return invoices;
}

async function calculateEmployeeInvoice(employee: BillingEmployee, referenceMonth: string, rates: BillingRates, billingCycleId: string | null, cycleStatus?: string | null) {
  const period = monthPeriod(referenceMonth);
  const today = startOfUtcDay(new Date());
  const [workHours, schedules, advance, adjustmentRows, persisted] = await Promise.all([
    prisma.workHourRecord.findMany({
      where: {
        employeeId: employee.id,
        date: { gte: period.start, lte: period.end },
        status: { in: BILLABLE_WORK_HOUR_STATUSES }
      },
      select: { date: true, effectiveHours: true, status: true },
      orderBy: { date: "asc" }
    }),
    prisma.schedule.findMany({
      where: { employeeId: employee.id, deletedAt: null, date: { gte: period.start, lte: period.end } },
      include: { shift: true },
      orderBy: { date: "asc" }
    }),
    prisma.monthlyAdvanceRecord.findUnique({ where: { employeeId_referenceMonth: { employeeId: employee.id, referenceMonth } } }),
    billingCycleId
      ? prisma.billingAdjustment.findMany({ where: { billingCycleId, deletedAt: null, OR: [{ employeeId: employee.id }, { employeeId: null, lobId: employee.lobId }, { employeeInvoice: { employeeId: employee.id } }] } })
      : Promise.resolve([]),
    billingCycleId
      ? prisma.billingEmployeeInvoice.findUnique({ where: { billingCycleId_employeeId: { billingCycleId, employeeId: employee.id } } })
      : Promise.resolve(null)
  ]);

  const rate = resolveHourlyRate(employee, rates);
  const approvedByDate = new Map(workHours.map((record) => [dateKey(record.date), Math.max(0, Math.round(Number(record.effectiveHours ?? 0) * 60))]));
  const approvedMinutes = Array.from(approvedByDate.values()).reduce((sum, minutes) => sum + minutes, 0);
  const approvedDetails = workHours.map((record) => ({
    kind: "APPROVED" as const,
    date: dateInput(record.date),
    shift: employee.shift ? cleanShiftName(employee.shift.name) : "",
    minutes: Math.max(0, Math.round(Number(record.effectiveHours ?? 0) * 60)),
    amount: roundMoney((Math.max(0, Number(record.effectiveHours ?? 0)) * rate.hourlyRate))
  }));
  const projectedSchedules = schedules.filter((schedule) => {
    if (!PROJECTABLE_SCHEDULE_STATUSES.has(schedule.status)) return false;
    if (approvedByDate.has(dateKey(schedule.date))) return false;
    return startOfUtcDay(schedule.date).getTime() > today.getTime();
  });
  const projectedMinutes = projectedSchedules.length * 480;
  const projectedDetails = projectedSchedules.map((schedule) => ({
    kind: "PROJECTED" as const,
    date: dateInput(schedule.date),
    shift: schedule.shift ? cleanShiftName(schedule.shift.name) : "",
    minutes: 480,
    amount: roundMoney(8 * rate.hourlyRate)
  }));
  const totalConsideredMinutes = approvedMinutes + projectedMinutes;
  const grossAmount = roundMoney((totalConsideredMinutes / 60) * rate.hourlyRate);
  const advanceAmount = advance?.optIn ? roundMoney(Number(advance.finalAmount ?? advance.amount ?? MONTHLY_ADVANCE_FIXED_AMOUNT)) : 0;
  const campaignAmount = roundMoney(adjustmentRows.filter((row) => normalizeComparableJobTitle(row.type) === "campanha").reduce((sum, row) => sum + Number(row.amount), 0));
  const adjustmentAmount = roundMoney(adjustmentRows.filter((row) => normalizeComparableJobTitle(row.type) !== "campanha").reduce((sum, row) => sum + Number(row.amount), 0));
  const finalAmount = roundMoney(grossAmount - advanceAmount + campaignAmount + adjustmentAmount);

  return {
    id: persisted?.id ?? "",
    referenceMonth,
    employeeId: employee.id,
    employeeName: employee.fullName,
    wbLogin: employee.wbLogin,
    email: employee.user?.email ?? "",
    employeeStatus: employee.operationalStatus ?? "",
    lob: employee.lob?.name ?? "Sem LOB",
    lobId: employee.lobId,
    supervisor: employee.supervisor?.fullName ?? "Sem supervisor",
    supervisorId: employee.supervisorId ?? "",
    skill: employee.skill ?? "",
    officialShift: employee.shift ? cleanShiftName(employee.shift.name) : "Sem turno",
    officialShiftId: employee.shiftId,
    status: persisted?.status ?? defaultInvoiceStatusForCycle(cycleStatus),
    statusLabel: invoiceStatusLabel(persisted?.status ?? defaultInvoiceStatusForCycle(cycleStatus)),
    approvedByEmployeeAt: persisted?.approvedByEmployeeAt ? formatDateTime(persisted.approvedByEmployeeAt) : "",
    approvedMinutes,
    projectedMinutes,
    projectedDays: projectedSchedules.length,
    totalConsideredMinutes,
    hourlyRate: rate.hourlyRate,
    billingRule: rate.billingRule,
    grossAmount,
    advanceAmount,
    campaignAmount,
    adjustmentAmount,
    finalAmount,
    hasOpenAdjustment: false,
    hourDetails: [...approvedDetails, ...projectedDetails]
  };
}

async function listBillingEmployees(filters: BillingDashboardFilters) {
  const where: Prisma.EmployeeProfileWhereInput = {
    deletedAt: null,
    roleTitle: { contains: "agente", mode: "insensitive" }
  };
  const and: Prisma.EmployeeProfileWhereInput[] = [];
  if (filters.lob && filters.lob !== "Todos") and.push({ lobId: filters.lob });
  if (filters.supervisorId && filters.supervisorId !== "Todos") and.push({ supervisorId: filters.supervisorId });
  if (filters.skill && filters.skill !== "Todos") and.push({ skill: { equals: filters.skill, mode: "insensitive" } });
  if (filters.shiftId && filters.shiftId !== "Todos") and.push({ shiftId: filters.shiftId });
  if (filters.employeeId) and.push({ id: filters.employeeId });
  if (filters.employeeStatus === "Ativo") and.push({ operationalStatus: { equals: "Ativo", mode: "insensitive" } });
  if (filters.employeeStatus === "Desligado") and.push({ operationalStatus: { equals: "Desligado", mode: "insensitive" } });
  const search = filters.search?.trim();
  if (search) {
    and.push({
      OR: [
        { fullName: { contains: search, mode: "insensitive" } },
        { wbLogin: { contains: search, mode: "insensitive" } },
        { user: { email: { contains: search, mode: "insensitive" } } }
      ]
    });
  }
  if (and.length) where.AND = and;

  const employees = await prisma.employeeProfile.findMany({
    where,
    include: { user: true, lob: true, supervisor: true, shift: true },
    orderBy: [{ lob: { name: "asc" } }, { fullName: "asc" }]
  });
  return employees.filter((employee) => isAgentJobTitle(employee.roleTitle));
}

function filterInvoices<T extends { status: string }>(invoices: T[], filters: BillingDashboardFilters) {
  if (!filters.invoiceStatus || filters.invoiceStatus === "Todos") return invoices;
  return invoices.filter((invoice) => invoice.status === filters.invoiceStatus);
}

async function upsertEmployeeInvoice(cycleId: string, calculated: Awaited<ReturnType<typeof calculateEmployeeInvoice>>, extra: InvoiceExtra = {}) {
  const status = String(extra.status ?? calculated.status ?? defaultInvoiceStatusForCycle(null));
  const approvalRelation = extra.approvedByEmployeeUserId ? { approvedByEmployeeUser: { connect: { id: extra.approvedByEmployeeUserId } } } : {};
  return prisma.billingEmployeeInvoice.upsert({
    where: { billingCycleId_employeeId: { billingCycleId: cycleId, employeeId: calculated.employeeId } },
    update: {
      status,
      approvedMinutes: calculated.approvedMinutes,
      projectedMinutes: calculated.projectedMinutes,
      totalConsideredMinutes: calculated.totalConsideredMinutes,
      hourlyRate: decimal(calculated.hourlyRate),
      billingRule: calculated.billingRule,
      grossAmount: decimal(calculated.grossAmount),
      advanceAmount: decimal(calculated.advanceAmount),
      campaignAmount: decimal(calculated.campaignAmount),
      adjustmentAmount: decimal(calculated.adjustmentAmount),
      finalAmount: decimal(calculated.finalAmount),
      ...(extra.approvedByEmployeeAt ? { approvedByEmployeeAt: extra.approvedByEmployeeAt } : {}),
      ...approvalRelation
    },
    create: {
      billingCycle: { connect: { id: cycleId } },
      employee: { connect: { id: calculated.employeeId } },
      referenceMonth: calculated.referenceMonth,
      status,
      approvedMinutes: calculated.approvedMinutes,
      projectedMinutes: calculated.projectedMinutes,
      totalConsideredMinutes: calculated.totalConsideredMinutes,
      hourlyRate: decimal(calculated.hourlyRate),
      billingRule: calculated.billingRule,
      grossAmount: decimal(calculated.grossAmount),
      advanceAmount: decimal(calculated.advanceAmount),
      campaignAmount: decimal(calculated.campaignAmount),
      adjustmentAmount: decimal(calculated.adjustmentAmount),
      finalAmount: decimal(calculated.finalAmount),
      ...(extra.approvedByEmployeeAt ? { approvedByEmployeeAt: extra.approvedByEmployeeAt } : {}),
      ...approvalRelation
    }
  });
}

async function ensureBillingCycle(referenceMonth: string) {
  if (!isBillingMonthAvailable(referenceMonth)) throw new Error("Billing disponível a partir de Junho/2026.");
  return prisma.billingCycle.upsert({
    where: { referenceMonth },
    update: {},
    create: { referenceMonth, status: "ABERTO" }
  });
}

async function updateCycleTotals(cycleId: string, invoices: Array<{ grossAmount: number; adjustmentAmount: number; campaignAmount: number; finalAmount: number; approvedMinutes: number }>) {
  await prisma.billingCycle.update({
    where: { id: cycleId },
    data: {
      grossAmount: decimal(invoices.reduce((sum, row) => sum + row.grossAmount, 0)),
      adjustmentsAmount: decimal(invoices.reduce((sum, row) => sum + row.adjustmentAmount + row.campaignAmount, 0)),
      finalAmount: decimal(invoices.reduce((sum, row) => sum + row.finalAmount, 0)),
      totalApprovedMinutes: invoices.reduce((sum, row) => sum + row.approvedMinutes, 0)
    }
  });
}

async function getBillingRates(): Promise<BillingRates> {
  const records = await prisma.billingRateConfig.findMany({ where: { active: true } });
  const map = Object.fromEntries(DEFAULT_RATE_CONFIGS.map((item) => [item.key, item.value])) as BillingRates;
  for (const record of records) {
    if (record.key in map) map[record.key as keyof BillingRates] = Number(record.value);
  }
  return map;
}

async function listBillingRateConfigs() {
  const records = await prisma.billingRateConfig.findMany({ include: { updatedBy: true }, orderBy: { key: "asc" } });
  const byKey = new Map(records.map((record) => [record.key, record]));
  return DEFAULT_RATE_CONFIGS.map((config) => {
    const record = byKey.get(config.key);
    return record ? mapRateConfig(record) : {
      id: "",
      key: config.key,
      label: config.label,
      value: config.value,
      active: true,
      effectiveFrom: "",
      updatedBy: "",
      updatedAt: ""
    };
  });
}

function resolveHourlyRate(employee: BillingEmployee, rates: BillingRates) {
  const skill = normalizeComparableJobTitle(employee.skill);
  if (skill.includes("bilingual") || skill.includes("bilingue")) return { hourlyRate: rates.BILINGUAL_HOURLY_RATE, billingRule: "BILINGUAL" };
  if (skill === "ra") return { hourlyRate: rates.RA_HOURLY_RATE, billingRule: "RA" };
  const shift = normalizeComparableJobTitle(cleanShiftName(employee.shift?.name ?? ""));
  if (shift.includes("noite")) return { hourlyRate: rates.NIGHT_HOURLY_RATE, billingRule: "TURNO_NOITE" };
  if (shift.includes("tarde")) return { hourlyRate: rates.AFTERNOON_HOURLY_RATE, billingRule: "TURNO_TARDE" };
  return { hourlyRate: rates.MORNING_HOURLY_RATE, billingRule: "TURNO_MANHA" };
}

function buildDashboardSummary(invoices: Array<{ grossAmount: number; advanceAmount: number; campaignAmount: number; adjustmentAmount: number; finalAmount: number; approvedMinutes: number; totalConsideredMinutes: number; employeeId: string }>, cycleStatus: string) {
  const agentsWithHours = new Set(invoices.filter((row) => row.approvedMinutes > 0 || row.totalConsideredMinutes > 0).map((row) => row.employeeId)).size;
  return {
    grossAmount: roundMoney(invoices.reduce((sum, row) => sum + row.grossAmount, 0)),
    advanceAmount: roundMoney(invoices.reduce((sum, row) => sum + row.advanceAmount, 0)),
    campaignAmount: roundMoney(invoices.reduce((sum, row) => sum + row.campaignAmount, 0)),
    adjustmentAmount: roundMoney(invoices.reduce((sum, row) => sum + row.adjustmentAmount + row.campaignAmount, 0)),
    finalAmount: roundMoney(invoices.reduce((sum, row) => sum + row.finalAmount, 0)),
    approvedMinutes: invoices.reduce((sum, row) => sum + row.approvedMinutes, 0),
    totalMinutes: invoices.reduce((sum, row) => sum + row.totalConsideredMinutes, 0),
    agentsWithHours,
    cycleStatus,
    cycleStatusLabel: cycleStatusLabel(cycleStatus)
  };
}

function buildLobSummary(invoices: Array<{ lob: string; employeeId: string; approvedMinutes: number; grossAmount: number; advanceAmount: number; campaignAmount: number; adjustmentAmount: number; finalAmount: number }>) {
  const byLob = new Map<string, typeof invoices>();
  for (const invoice of invoices) byLob.set(invoice.lob, [...(byLob.get(invoice.lob) ?? []), invoice]);
  return Array.from(byLob.entries()).map(([lob, rows]) => ({
    lob,
    agents: new Set(rows.map((row) => row.employeeId)).size,
    approvedMinutes: rows.reduce((sum, row) => sum + row.approvedMinutes, 0),
    grossAmount: roundMoney(rows.reduce((sum, row) => sum + row.grossAmount, 0)),
    advanceAmount: roundMoney(rows.reduce((sum, row) => sum + row.advanceAmount, 0)),
    adjustmentAmount: roundMoney(rows.reduce((sum, row) => sum + row.adjustmentAmount + row.campaignAmount, 0)),
    finalAmount: roundMoney(rows.reduce((sum, row) => sum + row.finalAmount, 0))
  })).sort((a, b) => a.lob.localeCompare(b.lob, "pt-BR"));
}

async function listCycleAdjustments(billingCycleId: string) {
  const rows = await prisma.billingAdjustment.findMany({
    where: { billingCycleId, deletedAt: null },
    include: { employee: true, lob: true, createdBy: true },
    orderBy: { createdAt: "desc" }
  });
  return rows.map(mapAdjustment);
}

async function listInvoiceAdjustmentRequests(billingCycleId: string) {
  const rows = await prisma.invoiceAdjustmentRequest.findMany({
    where: { billingCycleId },
    include: { employee: true, employeeInvoice: true, request: true, supervisorCheckedBy: true, adminDecidedBy: true },
    orderBy: { createdAt: "desc" }
  });
  return rows.map(mapAdjustmentRequest);
}

async function buildInvoiceHistory(employeeId: string) {
  const invoices = await prisma.billingEmployeeInvoice.findMany({
    where: { employeeId, referenceMonth: { gte: BILLING_START_MONTH } },
    include: { billingCycle: true },
    orderBy: { referenceMonth: "desc" },
    take: 12
  });
  return invoices.map((invoice) => ({
    id: invoice.id,
    referenceMonth: invoice.referenceMonth,
    monthLabel: formatReferenceMonth(invoice.referenceMonth),
    status: invoiceStatusLabel(invoice.status),
    finalAmount: Number(invoice.finalAmount),
    approvedAt: invoice.approvedByEmployeeAt ? formatDateTime(invoice.approvedByEmployeeAt) : ""
  }));
}

function buildWeeklyApprovedHours(details: Array<{ kind: "APPROVED" | "PROJECTED"; date: string; minutes: number; amount: number; shift: string }>) {
  const byWeek = new Map<string, { start: Date; end: Date; minutes: number }>();
  for (const detail of details.filter((item) => item.kind === "APPROVED")) {
    const date = parseInputDate(detail.date);
    const start = startOfWeekMonday(date);
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 6);
    const key = dateInput(start);
    const current = byWeek.get(key) ?? { start, end, minutes: 0 };
    current.minutes += detail.minutes;
    byWeek.set(key, current);
  }
  return Array.from(byWeek.values()).map((week, index) => ({
    week: `Semana ${index + 1}`,
    period: `${formatDate(week.start)} a ${formatDate(week.end)}`,
    minutes: week.minutes,
    hours: minutesToHoursLabel(week.minutes)
  }));
}

function buildInvoiceComposition(invoice: Awaited<ReturnType<typeof calculateEmployeeInvoice>>) {
  return [
    { label: "Horas aprovadas", hours: minutesToHoursLabel(invoice.approvedMinutes), value: roundMoney((invoice.approvedMinutes / 60) * invoice.hourlyRate), tone: "green" },
    { label: "Projeção de dias futuros", hours: minutesToHoursLabel(invoice.projectedMinutes), value: roundMoney((invoice.projectedMinutes / 60) * invoice.hourlyRate), tone: "blue" },
    { label: "Adiantamento", hours: "-", value: -invoice.advanceAmount, tone: "orange" },
    { label: "Campanha", hours: "-", value: invoice.campaignAmount, tone: "green" },
    { label: "Ajustes", hours: "-", value: invoice.adjustmentAmount, tone: invoice.adjustmentAmount < 0 ? "red" : "green" }
  ];
}

function canEmployeeApproveInvoice(cycleStatus?: string | null, invoiceStatus?: string | null) {
  return cycleStatus === "FINALIZADO_CONFERENCIA" && invoiceStatus !== "APROVADO_COLABORADOR";
}

function canEmployeeRequestAdjustment(cycleStatus: string | null | undefined, invoiceStatus: string | null | undefined, requests: Array<{ status: string }>) {
  return cycleStatus === "FINALIZADO_CONFERENCIA"
    && invoiceStatus !== "APROVADO_COLABORADOR"
    && !requests.some((request) => OPEN_ADJUSTMENT_STATUSES.includes(request.status as (typeof OPEN_ADJUSTMENT_STATUSES)[number]));
}

function defaultInvoiceStatusForCycle(cycleStatus?: string | null) {
  return cycleStatus === "FINALIZADO_CONFERENCIA" ? "DISPONIVEL_APROVACAO" : "EM_PREVISAO";
}

function normalizeBillingSection(section?: string | null): BillingDashboardSection {
  if (section === "employees" || section === "hours" || section === "adjustments" || section === "rates" || section === "all") return section;
  return "lob";
}

function virtualBillingCycle(referenceMonth: string) {
  return {
    id: "",
    referenceMonth,
    status: "ABERTO",
    grossAmount: 0,
    adjustmentsAmount: 0,
    finalAmount: 0,
    totalApprovedMinutes: 0,
    finalizedAt: null,
    closedAt: null,
    updatedAt: new Date()
  };
}

function groupBy<T>(items: T[], keyOf: (item: T) => string) {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  return grouped;
}

function logPerformance(label: string, startedAt: number, details: Record<string, unknown>) {
  if (!PERFORMANCE_DEBUG) return;
  console.info("[performance]", { label, durationMs: Date.now() - startedAt, ...details });
}

function requireBillingAccess(user: ActiveUser | null) {
  if (!user) return { error: "Usuário ativo não encontrado.", status: 401 };
  if (!canAccessBilling({ id: user.id, email: user.email, name: user.name })) {
    return { error: "Você não tem permissão para acessar Billing.", status: 403 };
  }
  return null;
}

function findActiveUser(email: string) {
  return prisma.user.findUnique({
    where: { email },
    include: { role: true, employeeProfile: { include: { user: true, lob: true, supervisor: true, shift: true } } }
  }).then((user) => (user?.status === "ACTIVE" ? user : null));
}

async function nextRequestCode(tx: Prisma.TransactionClient) {
  const recentCodes = await tx.request.findMany({
    where: { code: { startsWith: "REQ-" } },
    select: { code: true },
    orderBy: { code: "desc" },
    take: 200
  });
  const maxNumber = recentCodes.reduce((max, item) => {
    const numeric = Number(item.code.replace(/^REQ-/i, ""));
    return Number.isFinite(numeric) ? Math.max(max, numeric) : max;
  }, 1000);
  for (let offset = 1; offset <= 100; offset += 1) {
    const candidate = `REQ-${String(maxNumber + offset).padStart(4, "0")}`;
    const exists = await tx.request.findUnique({ where: { code: candidate }, select: { id: true } });
    if (!exists) return candidate;
  }
  return `REQ-${Date.now()}`;
}

function normalizeBillingMonth(input?: string | null) {
  return normalizeReferenceMonth(input || currentReferenceMonth(), currentReferenceMonth());
}

function isBillingMonthAvailable(referenceMonth: string) {
  return referenceMonth >= BILLING_START_MONTH;
}

function billingUnavailable() {
  return { error: "Billing disponível a partir de Junho/2026.", status: 403 };
}

function monthPeriod(referenceMonth: string) {
  const [year, month] = referenceMonth.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  return { start, end, startInput: dateInput(start), endInput: dateInput(end) };
}

function parseInputDate(input: string) {
  const [year, month, day] = input.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function startOfWeekMonday(date: Date) {
  const start = startOfUtcDay(date);
  const day = start.getUTCDay() || 7;
  start.setUTCDate(start.getUTCDate() - day + 1);
  return start;
}

function dateKey(date: Date) {
  return dateInput(date);
}

function dateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(date);
}

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function minutesToHoursLabel(minutes: number) {
  const safe = Math.max(0, Math.round(minutes));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

export function formatBillingCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number.isFinite(value) ? value : 0);
}

function moneyText(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}

function numberOrZero(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function roundMoney(value: number) {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function decimal(value: number | string | Prisma.Decimal) {
  return new Prisma.Decimal(Number(value || 0).toFixed(2));
}

function decimalOrNull(value?: number | null) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  return decimal(value);
}

function cycleStatusLabel(status: string) {
  const labels: Record<string, string> = {
    ABERTO: "Aberto",
    EM_REVISAO: "Em revisão",
    FINALIZADO_CONFERENCIA: "Finalizado para conferência",
    FECHADO: "Fechado",
    ENVIADO: "Enviado",
    PAGO: "Pago"
  };
  return labels[status] ?? status;
}

function invoiceStatusLabel(status: string) {
  const labels: Record<string, string> = {
    EM_PREVISAO: "Em previsão",
    DISPONIVEL_APROVACAO: "Disponível para aprovação",
    APROVADO_COLABORADOR: "Aprovado pelo colaborador",
    AJUSTE_SOLICITADO: "Ajuste solicitado",
    AGUARDANDO_SUPERVISOR: "Aguardando supervisor",
    AGUARDANDO_ADMIN: "Aguardando Admin",
    AJUSTE_CONCLUIDO: "Ajuste concluído",
    FECHADO: "Fechado"
  };
  return labels[status] ?? status;
}

function mapCycle(cycle: { id: string; referenceMonth: string; status: string; grossAmount: Prisma.Decimal | number; adjustmentsAmount: Prisma.Decimal | number; finalAmount: Prisma.Decimal | number; totalApprovedMinutes: number; finalizedAt?: Date | null; closedAt?: Date | null; updatedAt: Date }) {
  return {
    id: cycle.id,
    referenceMonth: cycle.referenceMonth,
    status: cycle.status,
    statusLabel: cycleStatusLabel(cycle.status),
    grossAmount: Number(cycle.grossAmount),
    adjustmentsAmount: Number(cycle.adjustmentsAmount),
    finalAmount: Number(cycle.finalAmount),
    totalApprovedMinutes: cycle.totalApprovedMinutes,
    finalizedAt: cycle.finalizedAt ? formatDateTime(cycle.finalizedAt) : "",
    closedAt: cycle.closedAt ? formatDateTime(cycle.closedAt) : "",
    updatedAt: formatDateTime(cycle.updatedAt)
  };
}

function mapAdjustment(row: Prisma.BillingAdjustmentGetPayload<{ include: { employee: true; lob: true; createdBy: true } }> | Prisma.BillingAdjustmentGetPayload<{}>) {
  const withRelations = row as Prisma.BillingAdjustmentGetPayload<{ include: { employee: true; lob: true; createdBy: true } }>;
  return {
    id: row.id,
    referenceMonth: row.referenceMonth,
    type: row.type,
    description: row.description,
    amount: Number(row.amount),
    employeeId: row.employeeId ?? "",
    employeeName: withRelations.employee?.fullName ?? "",
    lob: withRelations.lob?.name ?? "",
    createdBy: withRelations.createdBy?.name ?? "",
    createdAt: formatDateTime(row.createdAt)
  };
}

function mapAdjustmentRequest(row: Prisma.InvoiceAdjustmentRequestGetPayload<{ include: { employee?: true; employeeInvoice?: true; request?: true; supervisorCheckedBy?: true; adminDecidedBy?: true } }> | Prisma.InvoiceAdjustmentRequestGetPayload<{}>) {
  const withRelations = row as Prisma.InvoiceAdjustmentRequestGetPayload<{ include: { employee: true; employeeInvoice: true; request: true; supervisorCheckedBy: true; adminDecidedBy: true } }>;
  return {
    id: row.id,
    requestId: row.requestId ?? "",
    requestCode: withRelations.request?.code ?? "",
    employeeId: row.employeeId,
    employeeName: withRelations.employee?.fullName ?? "",
    wbLogin: withRelations.employee?.wbLogin ?? "",
    type: row.type,
    questionedItem: row.questionedItem,
    description: row.description,
    supervisorChecked: row.supervisorChecked,
    supervisorObservation: row.supervisorObservation ?? "",
    supervisorCheckedBy: withRelations.supervisorCheckedBy?.name ?? "",
    adminDecision: row.adminDecision ?? "",
    adminFinalResponse: row.adminFinalResponse ?? "",
    adminAdjustmentAmount: row.adminAdjustmentAmount ? Number(row.adminAdjustmentAmount) : 0,
    adminFinalMinutes: row.adminFinalMinutes ?? null,
    status: row.status,
    statusLabel: adjustmentRequestStatusLabel(row.status),
    createdAt: formatDateTime(row.createdAt),
    completedAt: row.completedAt ? formatDateTime(row.completedAt) : "",
    finalAmount: withRelations.employeeInvoice ? Number(withRelations.employeeInvoice.finalAmount) : 0
  };
}

function mapRateConfig(row: Prisma.BillingRateConfigGetPayload<{ include?: { updatedBy: true } }> | Prisma.BillingRateConfigGetPayload<{}>) {
  const withUser = row as Prisma.BillingRateConfigGetPayload<{ include: { updatedBy: true } }>;
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    value: Number(row.value),
    active: row.active,
    effectiveFrom: formatDate(row.effectiveFrom),
    updatedBy: withUser.updatedBy?.name ?? "",
    updatedAt: formatDateTime(row.updatedAt)
  };
}

function adjustmentRequestStatusLabel(status: string) {
  const labels: Record<string, string> = {
    AGUARDANDO_SUPERVISOR: "Aguardando supervisor",
    AGUARDANDO_ADMIN: "Aguardando Admin",
    AJUSTE_CONCLUIDO: "Concluído",
    RECUSADO: "Recusado"
  };
  return labels[status] ?? status;
}
