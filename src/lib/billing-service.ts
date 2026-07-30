import { randomUUID } from "node:crypto";

import { AuditAction, Prisma, RequestStatus, ScheduleStatus, WorkHourRecordStatus } from "@prisma/client";

import type { Actor } from "@/lib/mock-db";
import {
  BillingFiscalExtractionError,
  createBillingFiscalValidationToken,
  currencyEquals,
  extractBillingFiscalInvoice,
  type BillingFiscalDocumentExtraction,
  verifyBillingFiscalValidationToken
} from "@/lib/billing-fiscal-invoice-extraction";
import { calculateBillingFiscalExpectedAmount } from "@/lib/billing-fiscal-invoice";
import { buildBillingOmieAllocation } from "@/lib/billing-omie-allocation";
import { canAccessBilling, canManageBilling } from "@/lib/billing-permissions";
import { isAgentJobTitle, normalizeComparableJobTitle } from "@/lib/job-title-normalization";
import { MONTHLY_ADVANCE_FIXED_AMOUNT, isMonthlyAdvanceReferenceMonthAvailable } from "@/lib/monthly-advance-constants";
import { formatReferenceMonth, normalizeReferenceMonth } from "@/lib/monthly-advance-service";
import {
  attachBillingInvoiceDocument,
  buildOmieIntegrationCode,
  buildOmiePixTransferData,
  OmieIntegrationError,
  upsertBillingAccountPayable
} from "@/lib/omie-service";
import { prisma } from "@/lib/prisma";
import { normalizeRole } from "@/lib/permissions";
import { cleanShiftName } from "@/lib/shift-display";
import { deletePrivateObject, downloadPrivateObject, isStorageConfigured, uploadPrivateObject, validateStorageUpload } from "@/lib/supabase-storage";
import type { XlsxExportPayload } from "@/lib/xlsx-export";

export const BILLING_START_MONTH = "2026-06";
export const DEFAULT_BILLING_REFERENCE_MONTH = "2026-07";

const BILLING_PJ_ONLY_MESSAGE = "Billing disponível apenas para colaboradores PJ.";
const BILLING_REQUEST_TYPE_NAME = "Ajuste de Invoice";
const BILLING_INVOICE_BUCKET = "billing-invoices" as const;
const POC_AGENT_HOURLY_RATE_MULTIPLIER = 1.15;
const OPEN_ADJUSTMENT_STATUSES = ["AGUARDANDO_SUPERVISOR", "AGUARDANDO_ADMIN"] as const;
const BILLABLE_WORK_HOUR_STATUSES: WorkHourRecordStatus[] = [
  "IMPORTED",
  "OK",
  "DIVERGENT",
  "ADJUSTMENT_APPROVED",
  "ADJUSTMENT_REJECTED",
  "MANUALLY_CORRECTED"
];
const PROJECTABLE_SCHEDULE_STATUSES = new Set<ScheduleStatus>(["ESCALADO", "PRESENTE", "VENDA_FOLGA_APROVADA"]);

const DEFAULT_RATE_CONFIGS = [
  { key: "BILINGUAL_HOURLY_RATE", label: "Bilingual", value: 62.5, group: "SPECIAL", displayName: "Bilingual" },
  { key: "RA_HOURLY_RATE", label: "RA", value: 14.2, group: "SPECIAL", displayName: "RA" },
  { key: "ASSISTANT_HOURLY_RATE", label: "Assistant", value: 17.04, group: "SPECIAL", displayName: "Assistant" },
  { key: "MORNING_HOURLY_RATE", label: "Agente Manhã", value: 11.36, group: "AGENT", displayName: "Agente", shiftBucket: "MANHA" },
  { key: "AFTERNOON_HOURLY_RATE", label: "Agente Tarde", value: 11.36, group: "AGENT", displayName: "Agente", shiftBucket: "TARDE" },
  { key: "NIGHT_HOURLY_RATE", label: "Agente Noite", value: 13.1, group: "AGENT", displayName: "Agente", shiftBucket: "NOITE" },
  { key: "STAFF_COORDINATOR_DAY_RATE", label: "Coordinator Manhã/Tarde", value: 51.14, group: "STAFF", skillKey: "coordinator", displayName: "Coordinator", shiftBucket: "DIA" },
  { key: "STAFF_COORDINATOR_NIGHT_RATE", label: "Coordinator Noite", value: 58.81, group: "STAFF", skillKey: "coordinator", displayName: "Coordinator", shiftBucket: "NOITE" },
  { key: "STAFF_IT_TEAM_DAY_RATE", label: "TI Manhã/Tarde", value: 31.25, group: "STAFF", skillKey: "it_team", displayName: "TI", shiftBucket: "DIA" },
  { key: "STAFF_IT_TEAM_NIGHT_RATE", label: "TI Noite", value: 35.94, group: "STAFF", skillKey: "it_team", displayName: "TI", shiftBucket: "NOITE" },
  { key: "STAFF_QUALITY_ANALYST_DAY_RATE", label: "Quality Analyst Manhã/Tarde", value: 28.41, group: "STAFF", skillKey: "quality_analyst", displayName: "Quality Analyst", shiftBucket: "DIA" },
  { key: "STAFF_QUALITY_ANALYST_NIGHT_RATE", label: "Quality Analyst Noite", value: 32.67, group: "STAFF", skillKey: "quality_analyst", displayName: "Quality Analyst", shiftBucket: "NOITE" },
  { key: "STAFF_RTA_DAY_RATE", label: "RTA Manhã/Tarde", value: 17.05, group: "STAFF", skillKey: "rta", displayName: "RTA", shiftBucket: "DIA" },
  { key: "STAFF_RTA_NIGHT_RATE", label: "RTA Noite", value: 19.6, group: "STAFF", skillKey: "rta", displayName: "RTA", shiftBucket: "NOITE" },
  { key: "STAFF_SUPERVISOR_DAY_RATE", label: "Supervisor Manhã/Tarde", value: 34.09, group: "STAFF", skillKey: "supervisor", displayName: "Supervisor", shiftBucket: "DIA" },
  { key: "STAFF_SUPERVISOR_NIGHT_RATE", label: "Supervisor Noite", value: 39.2, group: "STAFF", skillKey: "supervisor", displayName: "Supervisor", shiftBucket: "NOITE" },
  { key: "STAFF_TRAINER_DAY_RATE", label: "Trainer Manhã/Tarde", value: 28.41, group: "STAFF", skillKey: "trainer", displayName: "Trainer", shiftBucket: "DIA" },
  { key: "STAFF_TRAINER_NIGHT_RATE", label: "Trainer Noite", value: 32.67, group: "STAFF", skillKey: "trainer", displayName: "Trainer", shiftBucket: "NOITE" },
  { key: "STAFF_WFM_I_DAY_RATE", label: "WFM I Manhã/Tarde", value: 28.41, group: "STAFF", skillKey: "wfm_i", displayName: "WFM I", shiftBucket: "DIA" },
  { key: "STAFF_WFM_I_NIGHT_RATE", label: "WFM I Noite", value: 32.67, group: "STAFF", skillKey: "wfm_i", displayName: "WFM I", shiftBucket: "NOITE" },
  { key: "STAFF_WFM_II_DAY_RATE", label: "WFM II Manhã/Tarde", value: 36.93, group: "STAFF", skillKey: "wfm_ii", displayName: "WFM II", shiftBucket: "DIA" },
  { key: "STAFF_WFM_II_NIGHT_RATE", label: "WFM II Noite", value: 42.47, group: "STAFF", skillKey: "wfm_ii", displayName: "WFM II", shiftBucket: "NOITE" },
  { key: "STAFF_WFM_III_DAY_RATE", label: "WFM III Manhã/Tarde", value: 42.61, group: "STAFF", skillKey: "wfm_iii", displayName: "WFM III", shiftBucket: "DIA" },
  { key: "STAFF_WFM_III_NIGHT_RATE", label: "WFM III Noite", value: 49.01, group: "STAFF", skillKey: "wfm_iii", displayName: "WFM III", shiftBucket: "NOITE" }
] as const;

const STAFF_RATE_RULES = [
  { skillKey: "coordinator", displayName: "Coordinator", dayKey: "STAFF_COORDINATOR_DAY_RATE", nightKey: "STAFF_COORDINATOR_NIGHT_RATE", aliases: ["coordinator", "coordenador", "coordenadora"] },
  { skillKey: "it_team", displayName: "TI", dayKey: "STAFF_IT_TEAM_DAY_RATE", nightKey: "STAFF_IT_TEAM_NIGHT_RATE", aliases: ["it team", "it", "ti", "logistica/ti", "logistica ti"] },
  { skillKey: "quality_analyst", displayName: "Quality Analyst", dayKey: "STAFF_QUALITY_ANALYST_DAY_RATE", nightKey: "STAFF_QUALITY_ANALYST_NIGHT_RATE", aliases: ["quality analyst", "quality", "qa", "analista de qualidade", "qualidade"] },
  { skillKey: "rta", displayName: "RTA", dayKey: "STAFF_RTA_DAY_RATE", nightKey: "STAFF_RTA_NIGHT_RATE", aliases: ["rta"] },
  { skillKey: "supervisor", displayName: "Supervisor", dayKey: "STAFF_SUPERVISOR_DAY_RATE", nightKey: "STAFF_SUPERVISOR_NIGHT_RATE", aliases: ["supervisor", "supervisora"] },
  { skillKey: "trainer", displayName: "Trainer", dayKey: "STAFF_TRAINER_DAY_RATE", nightKey: "STAFF_TRAINER_NIGHT_RATE", aliases: ["trainer", "treinador", "treinadora"] },
  { skillKey: "wfm_i", displayName: "WFM I", dayKey: "STAFF_WFM_I_DAY_RATE", nightKey: "STAFF_WFM_I_NIGHT_RATE", aliases: ["wfm i", "wfmi", "wfm 1"] },
  { skillKey: "wfm_ii", displayName: "WFM II", dayKey: "STAFF_WFM_II_DAY_RATE", nightKey: "STAFF_WFM_II_NIGHT_RATE", aliases: ["wfm ii", "wfmii", "wfm 2"] },
  { skillKey: "wfm_iii", displayName: "WFM III", dayKey: "STAFF_WFM_III_DAY_RATE", nightKey: "STAFF_WFM_III_NIGHT_RATE", aliases: ["wfm iii", "wfmiii", "wfm 3"] }
] as const;

type ActiveUser = NonNullable<Awaited<ReturnType<typeof findActiveUser>>>;
type BillingFiscalPreviewStage =
  | "CALCULATE_BILLING"
  | "EXTRACT_DOCUMENT"
  | "CHECK_DUPLICATE"
  | "CREATE_VALIDATION";
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
  roleTitle?: string | null;
  billingRule?: string | null;
  adjustmentType?: string | null;
  search?: string | null;
  section?: string | null;
};

type BillingDashboardSection = "lob" | "employees" | "hours" | "adjustments" | "rates" | "all";
type BillingRates = Record<(typeof DEFAULT_RATE_CONFIGS)[number]["key"], number>;
type InvoiceExtra = {
  status?: string;
  approvedByEmployeeAt?: Date;
  approvedByEmployeeUserId?: string;
  clearEmployeeApproval?: boolean;
};
type InvoiceHourDetail = {
  kind: "APPROVED" | "PROJECTED";
  date: string;
  shift: string;
  minutes: number;
  amount: number;
};
type BillingFiscalInvoiceRecord = {
  id: string;
  accessKey: string | null;
  documentHash: string | null;
  extractionMethod: string | null;
  extractedAt: Date | null;
  invoiceNumber: string;
  grossAmount: Prisma.Decimal;
  serviceDescription: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageBucket: string;
  storagePath: string;
  submittedAt: Date;
  omieStatus: string;
  omieIntegrationCode: string | null;
  omieLaunchCode: string | null;
  omieSupplierCode: string | null;
  omieSyncedAt: Date | null;
  omieLastAttemptAt: Date | null;
  omieLastError: string | null;
  omieAttempts: number;
  updatedAt: Date;
};
type BillingFiscalInvoiceView = {
  id: string;
  accessKey: string;
  invoiceNumber: string;
  grossAmount: number;
  serviceDescription: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  submittedAt: string;
  downloadUrl: string;
  omie: {
    status: "NOT_SENT" | "PENDING" | "SYNCED" | "ERROR";
    launchCode: string;
    syncedAt: string;
    lastAttemptAt: string;
    lastError: string;
    attempts: number;
    canRetry: boolean;
  };
};

type BillingOmieSyncResult = {
  status: "NOT_SENT" | "SYNCED" | "ERROR";
  message: string;
  launchCode: string;
};
type InvoiceCalculation = {
  id: string;
  referenceMonth: string;
  employeeId: string;
  employeeName: string;
  wbLogin: string;
  cnpj: string;
  pixKeyType: string;
  pixKey: string;
  email: string;
  roleTitle: string;
  employeeStatus: string;
  lob: string;
  lobId: string | null;
  supervisor: string;
  supervisorId: string;
  skill: string;
  officialShift: string;
  officialShiftId: string | null;
  status: string;
  statusLabel: string;
  approvedByEmployeeAt: string;
  approvedMinutes: number;
  projectedMinutes: number;
  projectedDays: number;
  totalConsideredMinutes: number;
  hourlyRate: number;
  billingRule: string;
  billingRuleLabel: string;
  billingRateSource: string;
  billingWarning?: string;
  grossAmount: number;
  advanceAmount: number;
  automaticAdvanceAmount: number;
  manualAdvanceAmount: number;
  campaignAmount: number;
  bonusAmount: number;
  discountAmount: number;
  correctionAmount: number;
  otherAdjustmentAmount: number;
  adjustmentAmount: number;
  finalAmount: number;
  adjustmentTypes: string[];
  hasOpenAdjustment: boolean;
  fiscalInvoice: BillingFiscalInvoiceView | null;
  hourDetails: InvoiceHourDetail[];
};
export type BillingFinanceCostSnapshotRow = {
  referenceMonth: string;
  lob: string;
  agents: number;
  approvedMinutes: number;
  projectedMinutes: number;
  approvedCostBrl: number;
  projectedCostBrl: number;
  grossAmount: number;
  advanceAmount: number;
  adjustmentAmount: number;
  finalAmount: number;
};
type PersistedInvoiceSnapshot = {
  id: string;
  employeeId: string;
  status: string;
  approvedMinutes: number;
  projectedMinutes: number;
  totalConsideredMinutes: number;
  hourlyRate: Prisma.Decimal;
  billingRule: string;
  grossAmount: Prisma.Decimal;
  advanceAmount: Prisma.Decimal;
  campaignAmount: Prisma.Decimal;
  adjustmentAmount: Prisma.Decimal;
  finalAmount: Prisma.Decimal;
  approvedByEmployeeAt: Date | null;
  approvedByEmployeeUserId: string | null;
  fiscalInvoice: BillingFiscalInvoiceRecord | null;
};
type BillingRateResolution = {
  hourlyRate: number;
  billingRule: string;
  billingRuleLabel: string;
  billingRateSource: string;
  billingWarning?: string;
};

const PERFORMANCE_DEBUG = process.env.PERFORMANCE_DEBUG === "true";

export async function getBillingDashboard(actor: Actor, filters: BillingDashboardFilters = {}) {
  const user = await findActiveUser(actor.email);
  const denied = requireBillingAccess(user);
  if (denied) return denied;
  const scope = getBillingAccessScope(user);
  if ("error" in scope) return scope;
  const scopedFilters = applyBillingScope(filters, scope);

  const referenceMonth = normalizeBillingMonth(scopedFilters.referenceMonth);
  if (!isBillingMonthAvailable(referenceMonth)) return billingUnavailable();

  const startedAt = Date.now();
  const section = normalizeBillingSection(scopedFilters.section);
  const [cycle, rates] = await Promise.all([
    prisma.billingCycle.findUnique({ where: { referenceMonth } }),
    getBillingRates()
  ]);
  const invoices = await buildBillingInvoicesReadModel(referenceMonth, rates, cycle, scopedFilters, {
    includeHourDetails: section === "hours" || section === "all"
  });
  const filteredInvoices = filterInvoices(invoices, scopedFilters);
  const cycleStatus = cycle?.status ?? "ABERTO";
  const summary = buildDashboardSummary(filteredInvoices, cycleStatus);
  const byLob = buildLobSummary(filteredInvoices);
  const visibleEmployeeIds = scope.restricted ? new Set(filteredInvoices.map((invoice) => invoice.employeeId)) : null;
  const [adjustments, adjustmentRequests, rateConfigs] = await Promise.all([
    cycle && (section === "adjustments" || section === "all") ? listCycleAdjustments(cycle.id, visibleEmployeeIds) : Promise.resolve([]),
    cycle && (section === "adjustments" || section === "all") ? listInvoiceAdjustmentRequests(cycle.id, visibleEmployeeIds) : Promise.resolve([]),
    !scope.restricted && (section === "rates" || section === "all") ? listBillingRateConfigs() : Promise.resolve([])
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
      startDate: scopedFilters.startDate || monthPeriod(referenceMonth).startInput,
      endDate: scopedFilters.endDate || monthPeriod(referenceMonth).endInput,
      startMonth: BILLING_START_MONTH,
      cycle: mapCycle(cycle ?? virtualBillingCycle(referenceMonth)),
      summary,
      byLob,
      invoices: filteredInvoices,
      adjustments,
      adjustmentRequests,
      rateConfigs,
      permissions: {
        canManageBilling: canManageBilling({ id: user!.id, email: user!.email, name: user!.name, role: user!.role.name })
      },
      filterOptions: buildBillingFilterOptions(invoices)
    }
  };
}

export async function getBillingFinanceCostSnapshot(referenceMonthInput: string) {
  const referenceMonth = normalizeBillingMonth(referenceMonthInput);
  if (!isBillingMonthAvailable(referenceMonth)) return { referenceMonth, rows: [] as BillingFinanceCostSnapshotRow[] };
  const [cycle, rates] = await Promise.all([
    prisma.billingCycle.findUnique({ where: { referenceMonth } }),
    getBillingRates()
  ]);
  const invoices = await buildBillingInvoicesReadModel(referenceMonth, rates, cycle, {}, { includeHourDetails: false });
  return {
    referenceMonth,
    rows: buildFinanceCostLobSummary(invoices)
  };
}

export async function getMyBillingInvoice(actor: Actor, referenceMonthInput?: string | null) {
  const user = await findActiveUser(actor.email);
  if (!user) return { error: "Usuário ativo não encontrado.", status: 401 };
  if (!user.employeeProfile) return { error: "Seu usuário não está vinculado a um cadastro de colaborador.", status: 400 };
  if (!isBillingEligibleContract(user.employeeProfile.contractType)) return { error: BILLING_PJ_ONLY_MESSAGE, status: 403 };

  const referenceMonth = normalizeBillingMonth(referenceMonthInput);
  if (!isBillingMonthAvailable(referenceMonth)) return billingUnavailable();

  const rates = await getBillingRates();
  const cycle = await prisma.billingCycle.findUnique({ where: { referenceMonth } });
  const invoice = await calculateEmployeeInvoice(user.employeeProfile as BillingEmployee, referenceMonth, rates, cycle?.id ?? null, cycle?.status);
  const persisted = cycle
    ? await prisma.billingEmployeeInvoice.findUnique({
      where: { billingCycleId_employeeId: { billingCycleId: cycle.id, employeeId: user.employeeProfile.id } },
      include: { fiscalInvoice: true }
    })
    : null;
  const adjustmentRequests = persisted
    ? await prisma.invoiceAdjustmentRequest.findMany({
      where: { employeeInvoiceId: persisted.id },
      orderBy: { createdAt: "desc" },
      take: 20
    })
    : [];
  const adjustmentDetails = cycle
    ? await listEmployeeBillingAdjustmentDetails(cycle.id, user.employeeProfile.id, user.employeeProfile.lobId)
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
        fiscalInvoice: mapBillingFiscalInvoice(
          persisted?.fiscalInvoice ?? null,
          persisted?.id ?? "",
          persisted?.status ?? invoice.status
        ),
        canApprove: canEmployeeApproveInvoice(cycle?.status, persisted?.status ?? invoice.status),
        canRequestAdjustment: canEmployeeRequestAdjustment(cycle?.status, persisted?.status ?? invoice.status)
      },
      weeklyApprovedHours: buildWeeklyApprovedHours(invoice.hourDetails),
      composition: buildInvoiceComposition(invoice),
      adjustmentDetails,
      adjustmentRequests: adjustmentRequests.map(mapAdjustmentRequest),
      history
    }
  };
}

export async function getEmployeeBillingPreview(employeeId: string, referenceMonthInput = DEFAULT_BILLING_REFERENCE_MONTH) {
  const referenceMonth = normalizeBillingMonth(referenceMonthInput);
  if (!isBillingMonthAvailable(referenceMonth)) return null;
  const employee = await prisma.employeeProfile.findFirst({
    where: { id: employeeId, deletedAt: null },
    include: { user: true, lob: true, supervisor: true, shift: true }
  });
  if (!employee || !isBillableEmployee(employee)) return null;
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
    automaticAdvanceAmount: invoice.automaticAdvanceAmount,
    manualAdvanceAmount: invoice.manualAdvanceAmount,
    campaignAmount: invoice.campaignAmount,
    bonusAmount: invoice.bonusAmount,
    discountAmount: invoice.discountAmount,
    correctionAmount: invoice.correctionAmount,
    otherAdjustmentAmount: invoice.otherAdjustmentAmount,
    adjustmentAmount: invoice.adjustmentAmount,
    finalAmount: invoice.finalAmount,
    message: isInvoiceAvailableForEmployeeReview(cycle?.status, persisted?.status ?? invoice.status)
      ? "Invoice disponível para conferência."
      : "Este valor ainda é uma previsão e pode mudar até o fechamento do Billing."
  };
}

export async function previewBillingFiscalInvoice(actor: Actor, input: {
  referenceMonth?: string | null;
  employeeId?: string | null;
  file?: File | null;
}) {
  const user = await findActiveUser(actor.email);
  if (!user) return { error: "Usuário ativo não encontrado.", status: 401 };
  if (!input.file) return { error: "Selecione a nota fiscal para leitura automática.", status: 400 };

  const referenceMonth = normalizeBillingMonth(input.referenceMonth);
  if (!isBillingMonthAvailable(referenceMonth)) return billingUnavailable();

  let employee: BillingEmployee | null = null;
  const requestedEmployeeId = String(input.employeeId ?? "").trim();
  if (requestedEmployeeId) {
    const denied = requireBillingManagement(user);
    if (denied) return denied;
    employee = await prisma.employeeProfile.findFirst({
      where: { id: requestedEmployeeId, deletedAt: null },
      include: { user: true, lob: true, supervisor: true, shift: true }
    });
  } else {
    employee = user.employeeProfile as BillingEmployee | null;
  }

  if (!employee) return { error: "Colaborador não encontrado para validar a nota fiscal.", status: 404 };
  if (!isBillableEmployee(employee)) return { error: "Colaborador não elegível para Billing.", status: 403 };

  const cycle = await prisma.billingCycle.findUnique({ where: { referenceMonth } });
  const isOwnInvoice = !requestedEmployeeId;
  if (isOwnInvoice) {
    if (!cycle) return { error: "Invoice ainda não está disponível para aprovação.", status: 403 };
    const persisted = await prisma.billingEmployeeInvoice.findUnique({
      where: { billingCycleId_employeeId: { billingCycleId: cycle.id, employeeId: employee.id } },
      select: { status: true }
    });
    const effectiveStatus = persisted?.status ?? defaultInvoiceStatusForCycle(cycle.status);
    if (!isInvoiceAvailableForEmployeeReview(cycle.status, effectiveStatus)) {
      return { error: "Invoice ainda não está disponível para aprovação.", status: 403 };
    }
    if (isFinalizedInvoiceStatus(persisted?.status)) {
      return { error: "Este invoice já foi finalizado pelo Admin Central.", status: 409 };
    }
  }

  const uploadValidation = validateStorageUpload(actor, BILLING_INVOICE_BUCKET, input.file);
  if ("error" in uploadValidation) return { error: uploadValidation.error, status: 400 };

  let stage: BillingFiscalPreviewStage = "CALCULATE_BILLING";
  try {
    const calculated = await calculateEmployeeInvoice(
      employee,
      referenceMonth,
      await getBillingRates(),
      cycle?.id ?? null,
      cycle?.status
    );
    const expectedFiscalAmount = calculateBillingFiscalExpectedAmount(calculated);
    stage = "EXTRACT_DOCUMENT";
    const extraction = await extractBillingFiscalInvoice(input.file);
    stage = "CHECK_DUPLICATE";
    await ensureBillingFiscalDocumentAvailable(extraction, referenceMonth, employee.id);

    const matchesBilling = currencyEquals(extraction.serviceAmount, expectedFiscalAmount);
    stage = "CREATE_VALIDATION";
    const validationToken = matchesBilling
      ? createBillingFiscalValidationToken({
        ...extraction,
        serviceDescription: buildAutomaticBillingServiceDescription(extraction, referenceMonth),
        actorEmail: user.email,
        referenceMonth,
        employeeId: employee.id,
        billingGrossAmount: expectedFiscalAmount
      })
      : "";

    return {
      data: {
        accessKey: extraction.accessKey,
        invoiceNumber: extraction.invoiceNumber,
        serviceAmount: extraction.serviceAmount,
        serviceDescription: buildAutomaticBillingServiceDescription(extraction, referenceMonth),
        extractionMethod: extraction.extractionMethod,
        billingGrossAmount: expectedFiscalAmount,
        difference: roundMoney(extraction.serviceAmount - expectedFiscalAmount),
        matchesBilling,
        validationToken
      }
    };
  } catch (error) {
    if (error instanceof BillingFiscalExtractionError) {
      return { error: error.message, status: error.status };
    }
    logBillingFiscalPreviewFailure(error, stage);
    if (isBillingFiscalMigrationMissingError(error)) {
      return {
        error: "A atualização do banco necessária para ler a nota fiscal ainda não está disponível neste ambiente.",
        status: 503
      };
    }
    return { error: "Não foi possível ler a nota fiscal automaticamente.", status: 500 };
  }
}

export async function approveMyBillingInvoice(actor: Actor, input: {
  referenceMonth?: string | null;
  validationToken?: string | null;
  file?: File | null;
}) {
  const user = await findActiveUser(actor.email);
  if (!user) return { error: "Usuário ativo não encontrado.", status: 401 };
  if (!user.employeeProfile) return { error: "Seu usuário não está vinculado a um cadastro de colaborador.", status: 400 };
  if (!isBillingEligibleContract(user.employeeProfile.contractType)) return { error: BILLING_PJ_ONLY_MESSAGE, status: 403 };

  const referenceMonth = normalizeBillingMonth(input.referenceMonth);
  if (!isBillingMonthAvailable(referenceMonth)) return billingUnavailable();
  const cycle = await prisma.billingCycle.findUnique({ where: { referenceMonth } });
  if (!cycle) return { error: "Invoice ainda não está disponível para aprovação.", status: 403 };
  const persisted = await prisma.billingEmployeeInvoice.findUnique({
    where: { billingCycleId_employeeId: { billingCycleId: cycle.id, employeeId: user.employeeProfile.id } },
    select: { status: true, fiscalInvoice: true }
  });
  const effectiveStatus = persisted?.status ?? defaultInvoiceStatusForCycle(cycle.status);
  if (!isInvoiceAvailableForEmployeeReview(cycle.status, effectiveStatus)) return { error: "Invoice ainda não está disponível para aprovação.", status: 403 };
  if (isFinalizedInvoiceStatus(persisted?.status)) return { error: "Este invoice foi finalizado pelo Admin Central e não pode ser aprovado pelo colaborador.", status: 409 };

  if (!input.file && !hasReusableBillingFiscalExtraction(persisted?.fiscalInvoice)) {
    return { error: "Anexe a nota fiscal para que os dados sejam lidos automaticamente.", status: 400 };
  }
  if (input.file) {
    const validation = validateStorageUpload(actor, BILLING_INVOICE_BUCKET, input.file);
    if ("error" in validation) return { error: validation.error, status: 400 };
    if (!isStorageConfigured() && (process.env.NODE_ENV === "production" || process.env.VERCEL === "1")) {
      return { error: "O armazenamento de notas fiscais não está configurado no ambiente de produção.", status: 503 };
    }
  }

  const sensitiveData = await prisma.employeeSensitiveData.findUnique({
    where: { employeeId: user.employeeProfile.id },
    select: { cnpj: true }
  });
  if (String(sensitiveData?.cnpj ?? "").replace(/\D/g, "").length !== 14) {
    return { error: "Cadastre um CNPJ válido antes de aprovar o invoice e enviar o lançamento ao Omie.", status: 400 };
  }

  const rates = await getBillingRates();
  const calculated = await calculateEmployeeInvoice(user.employeeProfile as BillingEmployee, referenceMonth, rates, cycle.id, cycle.status);
  try {
    buildBillingOmieAllocation({
      roleTitle: user.employeeProfile.roleTitle,
      skill: user.employeeProfile.skill,
      finalAmount: calculated.finalAmount,
      bonusAmount: calculated.bonusAmount,
      campaignAmount: calculated.campaignAmount,
      advanceAmount: calculated.advanceAmount
    });
    buildOmiePixTransferData({
      employeeName: user.employeeProfile.fullName,
      cnpj: sensitiveData?.cnpj ?? "",
      pixKey: user.employeeProfile.pixKey ?? "",
      pixKeyType: user.employeeProfile.pixKeyType ?? ""
    });
  } catch (error) {
    if (error instanceof OmieIntegrationError) return { error: error.message, status: 400 };
    return { error: "Os dados financeiros do colaborador não estão completos para o envio ao Omie.", status: 400 };
  }
  const expectedFiscalAmount = calculateBillingFiscalExpectedAmount(calculated);
  const file = input.file ?? null;
  let extraction: BillingFiscalDocumentExtraction;
  try {
    extraction = await resolveBillingFiscalSubmission({
      actorEmail: user.email,
      referenceMonth,
      employeeId: user.employeeProfile.id,
      billingGrossAmount: expectedFiscalAmount,
      file,
      validationToken: String(input.validationToken ?? ""),
      existing: persisted?.fiscalInvoice ?? null
    });
  } catch (error) {
    if (error instanceof BillingFiscalExtractionError) return { error: error.message, status: error.status };
    return { error: "Não foi possível validar os dados extraídos da nota fiscal.", status: 400 };
  }

  const invoiceNumber = extraction.invoiceNumber;
  const serviceDescription = buildAutomaticBillingServiceDescription(extraction, referenceMonth);
  const storagePath = file ? buildBillingInvoiceStoragePath(referenceMonth, user.employeeProfile.id, file.name) : null;
  const wbLogin = user.employeeProfile.wbLogin;
  let uploadedPath: string | null = null;

  try {
    if (file && storagePath) {
      const uploaded = await uploadPrivateObject(BILLING_INVOICE_BUCKET, storagePath, file);
      uploadedPath = uploaded.storagePath;
    }

    const approvedAt = new Date();
    const invoice = await prisma.$transaction(async (tx) => {
      const savedInvoice = await upsertEmployeeInvoice(cycle.id, calculated, {
        status: "APROVADO_COLABORADOR",
        approvedByEmployeeAt: approvedAt,
        approvedByEmployeeUserId: user.id
      }, tx);

      const existingFile = persisted?.fiscalInvoice;
      const fileData = file && uploadedPath
        ? {
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          storageBucket: BILLING_INVOICE_BUCKET,
          storagePath: uploadedPath
        }
        : existingFile
          ? {
            fileName: existingFile.fileName,
            mimeType: existingFile.mimeType,
            sizeBytes: existingFile.sizeBytes,
            storageBucket: existingFile.storageBucket,
            storagePath: existingFile.storagePath
          }
          : null;
      if (!fileData) throw new Error("Anexo da nota fiscal não encontrado.");

      await tx.billingFiscalInvoice.upsert({
        where: { employeeInvoiceId: savedInvoice.id },
        update: {
          accessKey: extraction.accessKey,
          documentHash: extraction.documentHash,
          extractionMethod: extraction.extractionMethod,
          extractedAt: approvedAt,
          invoiceNumber,
          grossAmount: decimal(extraction.serviceAmount),
          serviceDescription,
          ...fileData,
          submittedById: user.id,
          submittedAt: approvedAt,
          omieStatus: "PENDING",
          omieIntegrationCode: persisted?.fiscalInvoice?.omieIntegrationCode
            || buildOmieIntegrationCode(referenceMonth, wbLogin),
          omieSyncedAt: null,
          omieLastError: null
        },
        create: {
          employeeInvoiceId: savedInvoice.id,
          accessKey: extraction.accessKey,
          documentHash: extraction.documentHash,
          extractionMethod: extraction.extractionMethod,
          extractedAt: approvedAt,
          invoiceNumber,
          grossAmount: decimal(extraction.serviceAmount),
          serviceDescription,
          ...fileData,
          submittedById: user.id,
          submittedAt: approvedAt,
          omieStatus: "PENDING",
          omieIntegrationCode: buildOmieIntegrationCode(referenceMonth, wbLogin)
        }
      });

      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: AuditAction.APROVACAO,
          entity: "BillingEmployeeInvoice",
          entityId: savedInvoice.id,
          reason: "Invoice aprovado pelo colaborador com nota fiscal",
          newValue: {
            referenceMonth,
            employeeId: calculated.employeeId,
            accessKey: extraction.accessKey,
            invoiceNumber,
            invoiceGrossAmount: extraction.serviceAmount,
            billingGrossAmount: expectedFiscalAmount,
            billingHoursGrossAmount: calculated.grossAmount,
            billingCorrectionAmount: calculated.correctionAmount,
            extractionMethod: extraction.extractionMethod,
            invoiceFileName: fileData.fileName,
            finalAmount: calculated.finalAmount,
            totalMinutes: calculated.totalConsideredMinutes
          }
        }
      });

      return savedInvoice;
    });

    if (uploadedPath && persisted?.fiscalInvoice?.storagePath && persisted.fiscalInvoice.storagePath !== uploadedPath) {
      void deletePrivateObject(BILLING_INVOICE_BUCKET, persisted.fiscalInvoice.storagePath).catch(() => undefined);
    }
    const omie = await syncBillingFiscalInvoiceToOmie(invoice.id, user.id).catch(() => ({
      status: "ERROR" as const,
      message: "Invoice salvo, mas não foi possível iniciar o envio ao Omie. Tente novamente pelo botão de reenvio.",
      launchCode: ""
    }));
    return { data: { id: invoice.id, status: "Aprovado pelo colaborador", omie } };
  } catch (error) {
    if (uploadedPath) await deletePrivateObject(BILLING_INVOICE_BUCKET, uploadedPath).catch(() => undefined);
    if (isBillingFiscalDuplicateError(error)) {
      return { error: "Esta NFS-e já foi utilizada em outro invoice.", status: 409 };
    }
    return { error: "Não foi possível salvar a nota fiscal.", status: 500 };
  }
}

export async function retryMyBillingInvoiceOmie(actor: Actor, referenceMonthInput?: string | null) {
  const user = await findActiveUser(actor.email);
  if (!user) return { error: "Usuário ativo não encontrado.", status: 401 };
  if (!user.employeeProfile) return { error: "Seu usuário não está vinculado a um cadastro de colaborador.", status: 400 };
  const referenceMonth = normalizeBillingMonth(referenceMonthInput);
  const cycle = await prisma.billingCycle.findUnique({ where: { referenceMonth }, select: { id: true } });
  if (!cycle) return { error: "Ciclo de Billing não encontrado.", status: 404 };
  const invoice = await prisma.billingEmployeeInvoice.findUnique({
    where: { billingCycleId_employeeId: { billingCycleId: cycle.id, employeeId: user.employeeProfile.id } },
    select: { id: true, status: true, fiscalInvoice: { select: { id: true } } }
  });
  if (!invoice?.fiscalInvoice) return { error: "Nota fiscal não encontrada para reenviar ao Omie.", status: 404 };
  if (invoice.status !== "APROVADO_COLABORADOR") {
    return { error: "Somente a aprovação feita pelo colaborador pode enviar o invoice ao Omie.", status: 409 };
  }
  const omie = await syncBillingFiscalInvoiceToOmie(invoice.id, user.id);
  return { data: { id: invoice.id, omie } };
}

async function syncBillingFiscalInvoiceToOmie(employeeInvoiceId: string, actorId: string | null): Promise<BillingOmieSyncResult> {
  const fiscalInvoice = await prisma.billingFiscalInvoice.findUnique({
    where: { employeeInvoiceId },
    include: {
      employeeInvoice: {
        select: {
          id: true,
          status: true,
          referenceMonth: true,
          billingCycleId: true,
          employeeId: true,
          approvedByEmployeeAt: true,
          grossAmount: true,
          advanceAmount: true,
          campaignAmount: true,
          adjustmentAmount: true,
          finalAmount: true,
          employee: {
            select: {
              wbLogin: true,
              fullName: true,
              roleTitle: true,
              skill: true,
              pixKey: true,
              pixKeyType: true,
              lobId: true
            }
          }
        }
      }
    }
  });
  if (!fiscalInvoice) return { status: "ERROR", message: "Nota fiscal não encontrada para integração com o Omie.", launchCode: "" };
  if (fiscalInvoice.employeeInvoice.status !== "APROVADO_COLABORADOR") {
    return {
      status: "NOT_SENT",
      message: "Somente a aprovação feita pelo colaborador pode enviar o invoice ao Omie.",
      launchCode: ""
    };
  }

  const integrationCode = fiscalInvoice.omieIntegrationCode
    || buildOmieIntegrationCode(
      fiscalInvoice.employeeInvoice.referenceMonth,
      fiscalInvoice.employeeInvoice.employee.wbLogin
    );
  const attemptedAt = new Date();
  await prisma.billingFiscalInvoice.update({
    where: { id: fiscalInvoice.id },
    data: {
      omieStatus: "PENDING",
      omieIntegrationCode: integrationCode,
      omieLastAttemptAt: attemptedAt,
      omieLastError: null,
      omieAttempts: { increment: 1 }
    }
  });

  try {
    const sensitiveData = await prisma.employeeSensitiveData.findUnique({
      where: { employeeId: fiscalInvoice.employeeInvoice.employeeId },
      select: { cnpj: true }
    });
    if (fiscalInvoice.storageBucket !== BILLING_INVOICE_BUCKET) {
      throw new OmieIntegrationError("A nota fiscal está armazenada em uma origem inválida para envio ao Omie.");
    }
    const adjustmentRows = await prisma.billingAdjustment.findMany({
      where: {
        billingCycleId: fiscalInvoice.employeeInvoice.billingCycleId,
        deletedAt: null,
        OR: [
          { employeeId: fiscalInvoice.employeeInvoice.employeeId },
          {
            employeeId: null,
            lobId: fiscalInvoice.employeeInvoice.employee.lobId
          },
          { employeeInvoiceId }
        ]
      },
      select: { type: true, amount: true }
    });
    const adjustmentBreakdown = buildAdjustmentBreakdown(adjustmentRows);
    const billingGrossAmount = Number(fiscalInvoice.employeeInvoice.grossAmount);
    const fiscalGrossAmount = Number(fiscalInvoice.grossAmount);
    const campaignAmount = Number(fiscalInvoice.employeeInvoice.campaignAmount);
    const advanceAmount = Number(fiscalInvoice.employeeInvoice.advanceAmount);
    const finalAmount = Number(fiscalInvoice.employeeInvoice.finalAmount);
    const allocation = buildBillingOmieAllocation({
      roleTitle: fiscalInvoice.employeeInvoice.employee.roleTitle,
      skill: fiscalInvoice.employeeInvoice.employee.skill,
      finalAmount,
      bonusAmount: adjustmentBreakdown.bonusAmount,
      campaignAmount,
      advanceAmount
    });
    const storedInvoice = await downloadPrivateObject(BILLING_INVOICE_BUCKET, fiscalInvoice.storagePath)
      .catch(() => {
        throw new OmieIntegrationError("Não foi possível recuperar a nota fiscal para anexar ao lançamento no Omie.");
      });
    const result = await upsertBillingAccountPayable({
      employeeInvoiceId,
      referenceMonth: fiscalInvoice.employeeInvoice.referenceMonth,
      wbLogin: fiscalInvoice.employeeInvoice.employee.wbLogin,
      employeeName: fiscalInvoice.employeeInvoice.employee.fullName,
      roleTitle: fiscalInvoice.employeeInvoice.employee.roleTitle,
      cnpj: sensitiveData?.cnpj ?? "",
      pixKey: fiscalInvoice.employeeInvoice.employee.pixKey ?? "",
      pixKeyType: fiscalInvoice.employeeInvoice.employee.pixKeyType ?? "",
      accessKey: fiscalInvoice.accessKey ?? "",
      invoiceNumber: fiscalInvoice.invoiceNumber,
      serviceDescription: fiscalInvoice.serviceDescription,
      grossAmount: fiscalGrossAmount,
      documentAmount: allocation.documentAmount,
      projectCode: allocation.projectCode,
      documentTypeCode: allocation.documentTypeCode,
      categories: allocation.categories,
      billingGrossAmount,
      correctionAmount: adjustmentBreakdown.correctionAmount,
      bonusAmount: adjustmentBreakdown.bonusAmount,
      campaignAmount,
      advanceAmount,
      discountAmount: adjustmentBreakdown.discountAmount,
      otherAdjustmentAmount: adjustmentBreakdown.otherAdjustmentAmount,
      approvedAt: fiscalInvoice.employeeInvoice.approvedByEmployeeAt ?? fiscalInvoice.submittedAt,
      integrationCode
    });
    const attachment = await attachBillingInvoiceDocument({
      employeeInvoiceId,
      documentHash: fiscalInvoice.documentHash,
      launchCode: result.launchCode,
      fileName: fiscalInvoice.fileName,
      file: storedInvoice.data
    });
    const syncedAt = new Date();
    await prisma.billingFiscalInvoice.update({
      where: { id: fiscalInvoice.id },
      data: {
        omieStatus: "SYNCED",
        omieIntegrationCode: result.integrationCode,
        omieLaunchCode: result.launchCode,
        omieSupplierCode: result.supplierCode,
        omieSyncedAt: syncedAt,
        omieLastError: null
      }
    });
    await createOmieAuditLog(actorId, fiscalInvoice.id, AuditAction.CRIACAO, "Conta a Pagar sincronizada com o Omie", {
      employeeInvoiceId,
      referenceMonth: fiscalInvoice.employeeInvoice.referenceMonth,
      integrationCode: result.integrationCode,
      launchCode: result.launchCode,
      supplierCode: result.supplierCode,
      invoiceNumber: fiscalInvoice.invoiceNumber,
      wbLogin: fiscalInvoice.employeeInvoice.employee.wbLogin,
      grossAmount: fiscalGrossAmount,
      documentAmount: allocation.documentAmount,
      projectCode: allocation.projectCode,
      documentTypeCode: allocation.documentTypeCode,
      pixKeyType: fiscalInvoice.employeeInvoice.employee.pixKeyType ?? "",
      categories: allocation.categories,
      billingGrossAmount,
      correctionAmount: adjustmentBreakdown.correctionAmount,
      bonusAmount: adjustmentBreakdown.bonusAmount,
      campaignAmount,
      advanceAmount,
      discountAmount: adjustmentBreakdown.discountAmount,
      otherAdjustmentAmount: adjustmentBreakdown.otherAdjustmentAmount,
      finalAmount,
      attachmentIntegrationCode: attachment.integrationCode,
      attachmentId: attachment.attachmentId,
      attachmentFileName: attachment.fileName,
      attachmentAlreadyExisted: attachment.alreadyAttached
    });
    return {
      status: "SYNCED",
      message: "Lançamento e nota fiscal enviados ao Omie.",
      launchCode: result.launchCode
    };
  } catch (error) {
    const message = error instanceof OmieIntegrationError
      ? error.message
      : "Não foi possível enviar o lançamento ao Omie.";
    await prisma.billingFiscalInvoice.update({
      where: { id: fiscalInvoice.id },
      data: { omieStatus: "ERROR", omieLastError: message.slice(0, 500) }
    });
    await createOmieAuditLog(actorId, fiscalInvoice.id, AuditAction.EDICAO, "Falha ao sincronizar Conta a Pagar com o Omie", {
      employeeInvoiceId,
      referenceMonth: fiscalInvoice.employeeInvoice.referenceMonth,
      integrationCode,
      error: message.slice(0, 500)
    });
    return { status: "ERROR", message, launchCode: "" };
  }
}

async function createOmieAuditLog(actorId: string | null, entityId: string, action: AuditAction, reason: string, newValue: Prisma.InputJsonValue) {
  await prisma.auditLog.create({
    data: { actorId, action, entity: "BillingFiscalInvoiceOmie", entityId, reason, newValue }
  }).catch(() => undefined);
}

export async function getBillingFiscalInvoiceDownload(actor: Actor, employeeInvoiceId: string) {
  const user = await findActiveUser(actor.email);
  if (!user) return { error: "Usuário ativo não encontrado.", status: 401 };
  const invoice = await prisma.billingEmployeeInvoice.findUnique({
    where: { id: employeeInvoiceId },
    select: {
      employeeId: true,
      employee: { select: { supervisorId: true } },
      fiscalInvoice: true
    }
  });
  if (!invoice?.fiscalInvoice) return { error: "Nota fiscal não encontrada.", status: 404 };

  const isOwner = user.employeeProfile?.id === invoice.employeeId;
  if (!isOwner) {
    const scope = getBillingAccessScope(user);
    if ("error" in scope) return scope;
    if (scope.restricted && invoice.employee.supervisorId !== scope.supervisorId) {
      return { error: "Você não tem permissão para baixar esta nota fiscal.", status: 403 };
    }
  }
  if (invoice.fiscalInvoice.storageBucket !== BILLING_INVOICE_BUCKET) {
    return { error: "Origem do arquivo da nota fiscal inválida.", status: 409 };
  }

  try {
    const file = await downloadPrivateObject(BILLING_INVOICE_BUCKET, invoice.fiscalInvoice.storagePath);
    return {
      data: {
        body: file.data,
        fileName: invoice.fiscalInvoice.fileName,
        contentType: invoice.fiscalInvoice.mimeType || file.contentType
      }
    };
  } catch {
    return { error: "Não foi possível baixar a nota fiscal.", status: 500 };
  }
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
  if (!isBillingEligibleContract(user.employeeProfile.contractType)) return { error: BILLING_PJ_ONLY_MESSAGE, status: 403 };

  const referenceMonth = normalizeBillingMonth(input.referenceMonth);
  if (!isBillingMonthAvailable(referenceMonth)) return billingUnavailable();
  if (!input.type?.trim()) return { error: "Tipo do ajuste é obrigatório.", status: 400 };
  if (!input.questionedItem?.trim()) return { error: "Item questionado é obrigatório.", status: 400 };
  if (!input.description?.trim()) return { error: "Descrição do ajuste é obrigatória.", status: 400 };

  const cycle = await prisma.billingCycle.findUnique({ where: { referenceMonth } });
  if (!cycle) return { error: "Invoice ainda não está disponível para solicitação de ajuste.", status: 403 };
  const existingInvoice = await prisma.billingEmployeeInvoice.findUnique({
    where: { billingCycleId_employeeId: { billingCycleId: cycle.id, employeeId: user.employeeProfile.id } },
    select: { status: true }
  });
  const effectiveStatus = existingInvoice?.status ?? defaultInvoiceStatusForCycle(cycle.status);
  if (!isInvoiceAvailableForEmployeeReview(cycle.status, effectiveStatus)) return { error: "Invoice ainda não está disponível para solicitação de ajuste.", status: 403 };
  if (isFinalizedInvoiceStatus(existingInvoice?.status)) return { error: "Este invoice foi finalizado pelo Admin Central. Solicite reabertura ao Admin para pedir ajuste.", status: 409 };

  const rates = await getBillingRates();
  const calculated = await calculateEmployeeInvoice(user.employeeProfile as BillingEmployee, referenceMonth, rates, cycle.id, cycle.status);
  const invoice = await upsertEmployeeInvoice(cycle.id, calculated);
  if (invoice.status === "APROVADO_COLABORADOR") return { error: "Este invoice já foi aprovado. Apenas o Admin Central pode reabrir.", status: 409 };

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
  if (!["SUPERVISOR", "ADMIN"].includes(role)) {
    return { error: "Apenas o Supervisor responsável ou o Admin podem validar ajuste de invoice.", status: 403 };
  }
  if (!input.observation?.trim()) return { error: "Observação do supervisor é obrigatória.", status: 400 };

  const existing = await prisma.invoiceAdjustmentRequest.findUnique({
    where: { id: input.id },
    include: {
      request: true,
      employeeInvoice: true,
      employee: { select: { supervisorId: true } }
    }
  });
  if (!existing) return { error: "Solicitação de ajuste não encontrada.", status: 404 };
  if (existing.status !== "AGUARDANDO_SUPERVISOR") return { error: "Esta solicitação não está aguardando validação do supervisor.", status: 409 };
  if (role === "SUPERVISOR" && (!user.employeeProfile?.id || existing.employee.supervisorId !== user.employeeProfile.id)) {
    return { error: "Você só pode validar ajustes de invoice do próprio time.", status: 403 };
  }

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
  const denied = requireBillingManagement(user);
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
  const denied = requireBillingManagement(user);
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
  let frozenInvoiceCount = 0;
  if (nextStatus === "FECHADO") {
    const invoices = await buildBillingInvoicesReadModel(referenceMonth, await getBillingRates(), cycle, {}, { includeHourDetails: false });
    for (const invoice of invoices) {
      await upsertEmployeeInvoice(cycle.id, invoice, { status: "FECHADO" });
    }
    await updateCycleTotals(cycle.id, invoices);
    frozenInvoiceCount = invoices.length;
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
      newValue: { status: updated.status, referenceMonth, frozenInvoiceCount }
    }
  });
  return { data: mapCycle(updated) };
}

export async function setEmployeeBillingInvoiceFinalized(actor: Actor, input: {
  referenceMonth?: string | null;
  employeeId: string;
  finalized: boolean;
  validationToken?: string | null;
  file?: File | null;
}) {
  const user = await findActiveUser(actor.email);
  const denied = requireBillingManagement(user);
  if (denied) return denied;
  const referenceMonth = normalizeBillingMonth(input.referenceMonth);
  if (!isBillingMonthAvailable(referenceMonth)) return billingUnavailable();
  if (!input.employeeId?.trim()) return { error: "Colaborador obrigatório para finalizar invoice.", status: 400 };

  const employee = await prisma.employeeProfile.findFirst({
    where: { id: input.employeeId, deletedAt: null },
    include: { user: true, lob: true, supervisor: true, shift: true }
  });
  if (!employee) return { error: "Colaborador não encontrado.", status: 404 };
  if (!isBillableEmployee(employee)) return { error: "Colaborador não elegível para Billing.", status: 403 };

  const cycle = await ensureBillingCycle(referenceMonth);
  const existing = await prisma.billingEmployeeInvoice.findUnique({
    where: { billingCycleId_employeeId: { billingCycleId: cycle.id, employeeId: employee.id } },
    include: { fiscalInvoice: true }
  });

  if (input.finalized) {
    if (!input.file && !hasReusableBillingFiscalExtraction(existing?.fiscalInvoice)) {
      return { error: "Anexe a nota fiscal para que os dados sejam lidos automaticamente.", status: 400 };
    }
    if (input.file) {
      const validation = validateStorageUpload(actor, BILLING_INVOICE_BUCKET, input.file);
      if ("error" in validation) return { error: validation.error, status: 400 };
      if (!isStorageConfigured() && (process.env.NODE_ENV === "production" || process.env.VERCEL === "1")) {
        return { error: "O armazenamento de notas fiscais não está configurado no ambiente de produção.", status: 503 };
      }
    }

    const calculated = await calculateEmployeeInvoice(employee, referenceMonth, await getBillingRates(), cycle.id, cycle.status);
    const expectedFiscalAmount = calculateBillingFiscalExpectedAmount(calculated);
    const file = input.file ?? null;
    let extraction: BillingFiscalDocumentExtraction;
    try {
      extraction = await resolveBillingFiscalSubmission({
        actorEmail: user!.email,
        referenceMonth,
        employeeId: employee.id,
        billingGrossAmount: expectedFiscalAmount,
        file,
        validationToken: String(input.validationToken ?? ""),
        existing: existing?.fiscalInvoice ?? null
      });
    } catch (error) {
      if (error instanceof BillingFiscalExtractionError) return { error: error.message, status: error.status };
      return { error: "Não foi possível validar os dados extraídos da nota fiscal.", status: 400 };
    }

    const invoiceNumber = extraction.invoiceNumber;
    const serviceDescription = buildAutomaticBillingServiceDescription(extraction, referenceMonth);
    const storagePath = file ? buildBillingInvoiceStoragePath(referenceMonth, employee.id, file.name) : null;
    let uploadedPath: string | null = null;

    try {
      if (file && storagePath) {
        const uploaded = await uploadPrivateObject(BILLING_INVOICE_BUCKET, storagePath, file);
        uploadedPath = uploaded.storagePath;
      }

      const submittedAt = new Date();
      const invoice = await prisma.$transaction(async (tx) => {
        const savedInvoice = await upsertEmployeeInvoice(cycle.id, calculated, { status: "FECHADO" }, tx);
        const existingFile = existing?.fiscalInvoice;
        const fileData = file && uploadedPath
          ? {
            fileName: file.name,
            mimeType: file.type || "application/octet-stream",
            sizeBytes: file.size,
            storageBucket: BILLING_INVOICE_BUCKET,
            storagePath: uploadedPath
          }
          : existingFile
            ? {
              fileName: existingFile.fileName,
              mimeType: existingFile.mimeType,
              sizeBytes: existingFile.sizeBytes,
              storageBucket: existingFile.storageBucket,
              storagePath: existingFile.storagePath
            }
            : null;
        if (!fileData) throw new Error("Anexo da nota fiscal não encontrado.");

        await tx.billingFiscalInvoice.upsert({
          where: { employeeInvoiceId: savedInvoice.id },
          update: {
            accessKey: extraction.accessKey,
            documentHash: extraction.documentHash,
            extractionMethod: extraction.extractionMethod,
            extractedAt: submittedAt,
            invoiceNumber,
            grossAmount: decimal(extraction.serviceAmount),
            serviceDescription,
            ...fileData,
            submittedById: user!.id,
            submittedAt,
            omieStatus: existing?.fiscalInvoice?.omieStatus === "SYNCED" ? "SYNCED" : "NOT_SENT",
            omieIntegrationCode: existing?.fiscalInvoice?.omieStatus === "SYNCED"
              ? existing.fiscalInvoice.omieIntegrationCode
              : null,
            omieLaunchCode: existing?.fiscalInvoice?.omieStatus === "SYNCED"
              ? existing.fiscalInvoice.omieLaunchCode
              : null,
            omieSupplierCode: existing?.fiscalInvoice?.omieStatus === "SYNCED"
              ? existing.fiscalInvoice.omieSupplierCode
              : null,
            omieSyncedAt: existing?.fiscalInvoice?.omieStatus === "SYNCED"
              ? existing.fiscalInvoice.omieSyncedAt
              : null,
            omieLastAttemptAt: existing?.fiscalInvoice?.omieStatus === "SYNCED"
              ? existing.fiscalInvoice.omieLastAttemptAt
              : null,
            omieLastError: null,
            omieAttempts: existing?.fiscalInvoice?.omieStatus === "SYNCED"
              ? existing.fiscalInvoice.omieAttempts
              : 0
          },
          create: {
            employeeInvoiceId: savedInvoice.id,
            accessKey: extraction.accessKey,
            documentHash: extraction.documentHash,
            extractionMethod: extraction.extractionMethod,
            extractedAt: submittedAt,
            invoiceNumber,
            grossAmount: decimal(extraction.serviceAmount),
            serviceDescription,
            ...fileData,
            submittedById: user!.id,
            submittedAt,
            omieStatus: "NOT_SENT",
            omieIntegrationCode: null
          }
        });

        await tx.auditLog.create({
          data: {
            actorId: user!.id,
            action: AuditAction.EDICAO,
            entity: "BillingEmployeeInvoice",
            entityId: savedInvoice.id,
            reason: "Invoice individual finalizado pelo Admin Central com nota fiscal",
            previousValue: existing ? {
              status: existing.status,
              finalAmount: Number(existing.finalAmount),
              totalMinutes: existing.totalConsideredMinutes,
              invoiceNumber: existing.fiscalInvoice?.invoiceNumber ?? null
            } : undefined,
            newValue: {
              status: savedInvoice.status,
              referenceMonth,
              employeeId: employee.id,
              accessKey: extraction.accessKey,
              invoiceNumber,
              invoiceGrossAmount: extraction.serviceAmount,
              billingGrossAmount: expectedFiscalAmount,
              billingHoursGrossAmount: calculated.grossAmount,
              billingCorrectionAmount: calculated.correctionAmount,
              extractionMethod: extraction.extractionMethod,
              invoiceFileName: fileData.fileName,
              finalAmount: Number(savedInvoice.finalAmount),
              totalMinutes: savedInvoice.totalConsideredMinutes
            }
          }
        });

        return savedInvoice;
      });

      if (uploadedPath && existing?.fiscalInvoice?.storagePath && existing.fiscalInvoice.storagePath !== uploadedPath) {
        void deletePrivateObject(BILLING_INVOICE_BUCKET, existing.fiscalInvoice.storagePath).catch(() => undefined);
      }
      return {
        data: {
          id: invoice.id,
          status: invoice.status,
          statusLabel: invoiceStatusLabel(invoice.status),
          omie: {
            status: "NOT_SENT" as const,
            message: "Fechamento manual concluído sem envio ao Omie.",
            launchCode: ""
          }
        }
      };
    } catch (error) {
      if (uploadedPath) await deletePrivateObject(BILLING_INVOICE_BUCKET, uploadedPath).catch(() => undefined);
      if (isBillingFiscalDuplicateError(error)) {
        return { error: "Esta NFS-e já foi utilizada em outro invoice.", status: 409 };
      }
      return { error: "Não foi possível finalizar o invoice com a nota fiscal.", status: 500 };
    }
  }

  if (!existing) return { error: "Invoice individual ainda não existe para este colaborador/ciclo.", status: 404 };
  const fiscalInvoiceToRemove = existing.fiscalInvoice;
  const reopenedAt = new Date();
  const invoice = await prisma.$transaction(async (tx) => {
    if (fiscalInvoiceToRemove) {
      await tx.billingFiscalInvoice.delete({ where: { id: fiscalInvoiceToRemove.id } });
    }
    const reopenedInvoice = await tx.billingEmployeeInvoice.update({
      where: { id: existing.id },
      data: {
        status: "DISPONIVEL_APROVACAO",
        approvedByEmployeeAt: null,
        approvedByEmployeeUserId: null,
        reopenedAt,
        reopenedById: user!.id
      }
    });
    await tx.auditLog.create({
      data: {
        actorId: user!.id,
        action: AuditAction.EDICAO,
        entity: "BillingEmployeeInvoice",
        entityId: reopenedInvoice.id,
        reason: "Invoice individual reaberto e nota fiscal removida pelo Admin Central",
        previousValue: {
          status: existing.status,
          finalAmount: Number(existing.finalAmount),
          totalMinutes: existing.totalConsideredMinutes,
          fiscalInvoiceId: fiscalInvoiceToRemove?.id ?? null,
          invoiceNumber: fiscalInvoiceToRemove?.invoiceNumber ?? null,
          omieStatus: fiscalInvoiceToRemove?.omieStatus ?? null,
          omieLaunchCode: fiscalInvoiceToRemove?.omieLaunchCode ?? null
        },
        newValue: {
          status: reopenedInvoice.status,
          referenceMonth,
          employeeId: employee.id,
          fiscalInvoiceRemoved: Boolean(fiscalInvoiceToRemove)
        }
      }
    });
    return reopenedInvoice;
  });
  if (fiscalInvoiceToRemove?.storagePath) {
    await deletePrivateObject(BILLING_INVOICE_BUCKET, fiscalInvoiceToRemove.storagePath).catch(async (error: unknown) => {
      await prisma.errorLog.create({
        data: {
          userId: user!.id,
          code: "BILLING_REOPEN_STORAGE_DELETE_FAILED",
          message: "A nota fiscal foi removida do invoice, mas o arquivo antigo não pôde ser excluído do Storage.",
          action: "reopen-billing-invoice",
          severity: "ERROR",
          metadata: {
            employeeInvoiceId: invoice.id,
            fiscalInvoiceId: fiscalInvoiceToRemove.id,
            storageBucket: fiscalInvoiceToRemove.storageBucket,
            storagePath: fiscalInvoiceToRemove.storagePath,
            error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500)
          }
        }
      }).catch(() => undefined);
    });
  }
  return {
    data: {
      id: invoice.id,
      status: invoice.status,
      statusLabel: invoiceStatusLabel(invoice.status),
      fiscalInvoiceRemoved: Boolean(fiscalInvoiceToRemove)
    }
  };
}

export async function releaseEmployeeBillingInvoiceForReview(actor: Actor, input: { referenceMonth?: string | null; employeeId: string }) {
  const user = await findActiveUser(actor.email);
  const denied = requireBillingManagement(user);
  if (denied) return denied;
  const referenceMonth = normalizeBillingMonth(input.referenceMonth);
  if (!isBillingMonthAvailable(referenceMonth)) return billingUnavailable();
  if (!input.employeeId?.trim()) return { error: "Colaborador obrigatório para liberar conferência.", status: 400 };

  const employee = await prisma.employeeProfile.findFirst({
    where: { id: input.employeeId, deletedAt: null },
    include: { user: true, lob: true, supervisor: true, shift: true }
  });
  if (!employee) return { error: "Colaborador não encontrado.", status: 404 };
  if (!isBillableEmployee(employee)) return { error: "Colaborador não elegível para Billing.", status: 403 };

  const cycle = await ensureBillingCycle(referenceMonth);
  const existing = await prisma.billingEmployeeInvoice.findUnique({
    where: { billingCycleId_employeeId: { billingCycleId: cycle.id, employeeId: employee.id } }
  });
  if (isFinalizedInvoiceStatus(existing?.status)) {
    return { error: "Invoice individual finalizado. Reabra antes de liberar novamente para conferência.", status: 409 };
  }

  const calculated = await calculateEmployeeInvoice(employee, referenceMonth, await getBillingRates(), cycle.id, cycle.status);
  const invoice = await upsertEmployeeInvoice(cycle.id, calculated, {
    status: "DISPONIVEL_APROVACAO",
    clearEmployeeApproval: true
  });

  await prisma.auditLog.create({
    data: {
      actorId: user!.id,
      action: AuditAction.EDICAO,
      entity: "BillingEmployeeInvoice",
      entityId: invoice.id,
      reason: "Invoice individual liberado para conferência pelo Admin Central",
      previousValue: existing ? { status: existing.status, finalAmount: Number(existing.finalAmount), totalMinutes: existing.totalConsideredMinutes } : undefined,
      newValue: { status: invoice.status, referenceMonth, employeeId: employee.id, finalAmount: Number(invoice.finalAmount), totalMinutes: invoice.totalConsideredMinutes }
    }
  });

  return { data: { id: invoice.id, status: invoice.status, statusLabel: invoiceStatusLabel(invoice.status) } };
}

export async function saveBillingRates(actor: Actor, input: Record<string, number>) {
  const user = await findActiveUser(actor.email);
  const denied = requireBillingManagement(user);
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
        update: { label: config.label, value: decimal(value), active: true, updatedById: user!.id },
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
  const denied = requireBillingManagement(user);
  if (denied) return denied;
  const referenceMonth = normalizeBillingMonth(input.referenceMonth);
  if (!isBillingMonthAvailable(referenceMonth)) return billingUnavailable();
  if (!input.type?.trim()) return { error: "Tipo de ajuste é obrigatório.", status: 400 };
  if (!input.description?.trim()) return { error: "Descrição do ajuste é obrigatória.", status: 400 };
  if (!Number.isFinite(Number(input.amount))) return { error: "Valor do ajuste inválido.", status: 400 };
  if (normalizeComparableJobTitle(input.type) === "penalty") return { error: "Tipo de ajuste Penalty não é permitido no Billing.", status: 400 };
  const cycle = await ensureBillingCycle(referenceMonth);
  const targetDenied = await validateBillingAdjustmentTarget(input);
  if (targetDenied) return targetDenied;
  const finalizedTargetDenied = await validateBillingAdjustmentFinalizedTarget(cycle.id, input);
  if (finalizedTargetDenied) return finalizedTargetDenied;
  const amount = normalizeBillingAdjustmentAmount(input.type, Number(input.amount));
  const adjustment = await prisma.billingAdjustment.create({
    data: {
      billingCycleId: cycle.id,
      employeeInvoiceId: input.employeeInvoiceId || null,
      referenceMonth,
      type: input.type.trim(),
      description: input.description.trim(),
      amount: decimal(amount),
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

export async function bulkCreateBillingAdjustments(actor: Actor, input: {
  referenceMonth?: string | null;
  rows: Array<Record<string, unknown>>;
  fileName?: string | null;
}) {
  const user = await findActiveUser(actor.email);
  const denied = requireBillingManagement(user);
  if (denied) return denied;

  const referenceMonth = normalizeBillingMonth(input.referenceMonth);
  if (!isBillingMonthAvailable(referenceMonth)) return billingUnavailable();
  const rows = input.rows ?? [];
  if (!rows.length) return { error: "A planilha não possui linhas para importar.", status: 400 };

  const cycle = await ensureBillingCycle(referenceMonth);
  const rowNumbers = rows.map((_, index) => index + 2);
  const identifiers = rows
    .map((row) => readBulkAdjustmentCell(row, ["wb_login", "wb", "login", "wbLogin", "WB/Login", "colaborador", "employee", "email"]))
    .filter(Boolean)
    .map((value) => normalizeBulkLookup(value));
  const uniqueIdentifiers = Array.from(new Set(identifiers));
  const employees = uniqueIdentifiers.length
    ? await prisma.employeeProfile.findMany({
      where: {
        deletedAt: null,
        OR: [
          { wbLogin: { in: uniqueIdentifiers } },
          { user: { email: { in: uniqueIdentifiers } } }
        ]
      },
      include: { user: true }
    })
    : [];
  const employeesByLookup = new Map<string, typeof employees[number]>();
  for (const employee of employees) {
    employeesByLookup.set(normalizeBulkLookup(employee.wbLogin), employee);
    if (employee.user?.email) employeesByLookup.set(normalizeBulkLookup(employee.user.email), employee);
  }
  const finalizedInvoices = await prisma.billingEmployeeInvoice.findMany({
    where: {
      billingCycleId: cycle.id,
      employeeId: { in: employees.map((employee) => employee.id) },
      status: "FECHADO"
    },
    select: { employeeId: true }
  });
  const finalizedEmployeeIds = new Set(finalizedInvoices.map((invoice) => invoice.employeeId));

  const errors: Array<{ rowNumber: number; wbLogin: string; error: string }> = [];
  const validRows: Array<{
    rowNumber: number;
    employeeId: string;
    wbLogin: string;
    type: string;
    description: string;
    amount: number;
    observation: string;
  }> = [];

  rows.forEach((row, index) => {
    const rowNumber = rowNumbers[index];
    if (isBulkAdjustmentRowEmpty(row)) return;
    const identifier = readBulkAdjustmentCell(row, ["wb_login", "wb", "login", "wbLogin", "WB/Login", "colaborador", "employee", "email"]);
    const lookup = normalizeBulkLookup(identifier);
    if (!lookup) {
      errors.push({ rowNumber, wbLogin: "", error: "Informe wb_login ou e-mail do colaborador." });
      return;
    }
    const employee = employeesByLookup.get(lookup);
    if (!employee) {
      errors.push({ rowNumber, wbLogin: String(identifier ?? ""), error: "Colaborador não encontrado pelo WB/Login ou e-mail." });
      return;
    }
    if (!isBillingEligibleContract(employee.contractType)) {
      errors.push({ rowNumber, wbLogin: employee.wbLogin, error: BILLING_PJ_ONLY_MESSAGE });
      return;
    }
    if (finalizedEmployeeIds.has(employee.id)) {
      errors.push({ rowNumber, wbLogin: employee.wbLogin, error: "Invoice individual já finalizado. Reabra antes de aplicar ajustes." });
      return;
    }

    const parsed = parseBulkAdjustmentTypeAndAmount(row);
    if (!parsed) {
      errors.push({ rowNumber, wbLogin: employee.wbLogin, error: "Informe uma coluna correcao/correção ou bonus/bônus com valor válido." });
      return;
    }
    const motivo = readBulkAdjustmentCell(row, ["motivo", "observacao", "observação", "obs", "reason"]);
    const description = readBulkAdjustmentCell(row, ["descricao", "descrição", "description"]) || parsed.type;
    validRows.push({
      rowNumber,
      employeeId: employee.id,
      wbLogin: employee.wbLogin,
      type: parsed.type,
      description: String(description).trim(),
      amount: normalizeBillingAdjustmentAmount(parsed.type, parsed.amount),
      observation: motivo ? String(motivo).trim() : ""
    });
  });

  if (!validRows.length) {
    return {
      data: {
        fileName: input.fileName ?? "",
        referenceMonth,
        rowsTotal: rows.length,
        rowsCreated: 0,
        rowsError: errors.length,
        errors
      }
    };
  }

  const created = await prisma.$transaction(async (tx) => {
    const adjustments = [];
    for (const row of validRows) {
      const adjustment = await tx.billingAdjustment.create({
        data: {
          billingCycleId: cycle.id,
          referenceMonth,
          type: row.type,
          description: row.description,
          amount: decimal(row.amount),
          employeeId: row.employeeId,
          employeeInvoiceId: null,
          lobId: null,
          observation: row.observation || null,
          createdById: user!.id
        }
      });
      adjustments.push(adjustment);
      await tx.auditLog.create({
        data: {
          actorId: user!.id,
          action: AuditAction.CRIACAO,
          entity: "BillingAdjustment",
          entityId: adjustment.id,
          reason: "Importação em lote de ajustes de Billing",
          newValue: {
            referenceMonth,
            type: row.type,
            amount: row.amount,
            employeeId: row.employeeId,
            wbLogin: row.wbLogin,
            observation: row.observation,
            fileName: input.fileName ?? ""
          }
        }
      });
    }
    return adjustments;
  });

  return {
    data: {
      fileName: input.fileName ?? "",
      referenceMonth,
      rowsTotal: rows.length,
      rowsCreated: created.length,
      rowsError: errors.length,
      errors
    }
  };
}

export async function updateBillingAdjustment(actor: Actor, input: {
  id: string;
  type: string;
  description: string;
  amount: number;
}) {
  const user = await findActiveUser(actor.email);
  const denied = requireBillingManagement(user);
  if (denied) return denied;
  if (!input.id?.trim()) return { error: "Ajuste obrigatório para edição.", status: 400 };
  if (!input.type?.trim()) return { error: "Tipo de ajuste é obrigatório.", status: 400 };
  if (!input.description?.trim()) return { error: "Descrição do ajuste é obrigatória.", status: 400 };
  if (!Number.isFinite(Number(input.amount))) return { error: "Valor do ajuste inválido.", status: 400 };
  if (normalizeComparableJobTitle(input.type) === "penalty") return { error: "Tipo de ajuste Penalty não é permitido no Billing.", status: 400 };

  const existing = await prisma.billingAdjustment.findFirst({
    where: { id: input.id, deletedAt: null },
    include: { employeeInvoice: true }
  });
  if (!existing) return { error: "Ajuste de Billing não encontrado.", status: 404 };
  const finalizedTargetDenied = await validateBillingAdjustmentFinalizedTarget(existing.billingCycleId, {
    employeeInvoiceId: existing.employeeInvoiceId,
    employeeId: existing.employeeId
  });
  if (finalizedTargetDenied) return finalizedTargetDenied;

  const amount = normalizeBillingAdjustmentAmount(input.type, Number(input.amount));
  const updated = await prisma.$transaction(async (tx) => {
    const adjustment = await tx.billingAdjustment.update({
      where: { id: existing.id },
      data: {
        type: input.type.trim(),
        description: input.description.trim(),
        amount: decimal(amount)
      },
      include: { employee: true, lob: true, createdBy: true }
    });
    await tx.auditLog.create({
      data: {
        actorId: user!.id,
        action: AuditAction.EDICAO,
        entity: "BillingAdjustment",
        entityId: existing.id,
        reason: "Ajuste manual de Billing editado",
        previousValue: {
          type: existing.type,
          description: existing.description,
          amount: Number(existing.amount)
        },
        newValue: {
          type: adjustment.type,
          description: adjustment.description,
          amount: Number(adjustment.amount)
        }
      }
    });
    return adjustment;
  });

  return { data: mapAdjustment(updated) };
}

export async function deleteBillingAdjustment(actor: Actor, input: { id: string }) {
  const user = await findActiveUser(actor.email);
  const denied = requireBillingManagement(user);
  if (denied) return denied;
  if (!input.id?.trim()) return { error: "Ajuste obrigatório para exclusão.", status: 400 };

  const existing = await prisma.billingAdjustment.findFirst({
    where: { id: input.id, deletedAt: null },
    include: { employee: true, lob: true }
  });
  if (!existing) return { error: "Ajuste de Billing não encontrado.", status: 404 };
  const finalizedTargetDenied = await validateBillingAdjustmentFinalizedTarget(existing.billingCycleId, {
    employeeInvoiceId: existing.employeeInvoiceId,
    employeeId: existing.employeeId
  });
  if (finalizedTargetDenied) return finalizedTargetDenied;

  await prisma.$transaction(async (tx) => {
    await tx.billingAdjustment.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() }
    });
    await tx.auditLog.create({
      data: {
        actorId: user!.id,
        action: AuditAction.EXCLUSAO,
        entity: "BillingAdjustment",
        entityId: existing.id,
        reason: "Ajuste manual de Billing excluído",
        previousValue: {
          referenceMonth: existing.referenceMonth,
          type: existing.type,
          description: existing.description,
          amount: Number(existing.amount),
          employeeId: existing.employeeId,
          employeeName: existing.employee?.fullName,
          lobId: existing.lobId,
          lob: existing.lob?.name
        }
      }
    });
  });

  return { data: { id: existing.id, deleted: true } };
}

export async function exportBilling(actor: Actor, filters: BillingDashboardFilters = {}): Promise<XlsxExportPayload | { error: string; status?: number }> {
  const result = await getBillingDashboard(actor, { ...filters, section: "all" });
  if ("error" in result) return result;
  const data = result.data;

  return {
    fileName: `billing_${data.referenceMonth}.xlsx`,
    sheetName: "Consolidado",
    headers: ["mes", "valor_bruto", "adiantamento", "ajustes", "valor_final", "horas_aprovadas", "agentes_com_horas", "status_ciclo"],
    columnFormats: currencyColumnFormats([1, 2, 3, 4]),
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
        columnFormats: currencyColumnFormats([3, 4, 5, 6]),
        rows: data.byLob.map((row) => [row.lob, row.agents, minutesToHoursLabel(row.approvedMinutes), moneyText(row.grossAmount), moneyText(row.advanceAmount), moneyText(row.adjustmentAmount), moneyText(row.finalAmount)])
      },
      {
        sheetName: "Por Colaborador",
        headers: ["nome", "wb_login", "cnpj", "tipo_chave_pix", "chave_pix", "cargo_funcao", "skill", "status_colaborador", "lob", "supervisor", "turno_oficial", "regra_billing", "valor_hora", "horas_aprovadas", "horas_projetadas", "total_horas", "valor_bruto", "adiantamento", "campanha", "bonus", "desconto", "correcao", "ajustes_total", "valor_final", "status_invoice", "aprovado_em"],
        columnFormats: currencyColumnFormats([12, 16, 17, 18, 19, 20, 21, 22, 23]),
        rows: data.invoices.map((row) => [row.employeeName, row.wbLogin, row.cnpj, row.pixKeyType, row.pixKey, row.roleTitle, row.skill, row.employeeStatus, row.lob, row.supervisor, row.officialShift, row.billingRuleLabel || row.billingRule, moneyText(row.hourlyRate), minutesToHoursLabel(row.approvedMinutes), minutesToHoursLabel(row.projectedMinutes), minutesToHoursLabel(row.totalConsideredMinutes), moneyText(row.grossAmount), moneyText(row.advanceAmount), moneyText(row.campaignAmount), moneyText(row.bonusAmount), moneyText(row.discountAmount), moneyText(row.correctionAmount), moneyText(row.adjustmentAmount), moneyText(row.finalAmount), row.statusLabel, row.approvedByEmployeeAt || ""])
      },
      {
        sheetName: "Detalhamento de Horas",
        headers: ["data", "nome", "wb_login", "cnpj", "tipo_chave_pix", "chave_pix", "status_colaborador", "lob", "supervisor", "skill", "cargo_funcao", "turno_oficial", "turno_slot", "horas_aprovadas", "valor_hora", "valor_calculado", "regra_billing"],
        columnFormats: currencyColumnFormats([14, 15]),
        rows: data.invoices.flatMap((row) => row.hourDetails.map((detail) => [detail.date, row.employeeName, row.wbLogin, row.cnpj, row.pixKeyType, row.pixKey, row.employeeStatus, row.lob, row.supervisor, row.skill, row.roleTitle, row.officialShift, detail.shift, minutesToHoursLabel(detail.minutes), moneyText(row.hourlyRate), moneyText(detail.amount), row.billingRuleLabel || row.billingRule]))
      },
      {
        sheetName: "Ajustes",
        headers: ["tipo_ajuste", "descricao", "mes", "colaborador", "lob", "valor", "criado_por", "criado_em"],
        columnFormats: currencyColumnFormats([5]),
        rows: data.adjustments.map((row) => [row.type, row.description, row.referenceMonth, row.employeeName || "", row.lob || "", moneyText(row.amount), row.createdBy, row.createdAt])
      },
      {
        sheetName: "Aprovações",
        headers: ["colaborador", "wb_login", "cnpj", "tipo_chave_pix", "chave_pix", "status_invoice", "aprovado_em", "ajuste_aberto", "valor_final"],
        columnFormats: currencyColumnFormats([8]),
        rows: data.invoices.map((row) => [row.employeeName, row.wbLogin, row.cnpj, row.pixKeyType, row.pixKey, row.statusLabel, row.approvedByEmployeeAt || "", row.hasOpenAdjustment ? "Sim" : "Não", moneyText(row.finalAmount)])
      },
      {
        sheetName: "Configurações",
        headers: ["skill", "nome_exibido", "turno", "valor", "ativo", "vigente_desde", "atualizado_por", "atualizado_em"],
        columnFormats: currencyColumnFormats([3]),
        rows: data.rateConfigs.map((row) => [row.skillKey || row.key, row.displayName || row.label, row.shiftBucket || row.group, moneyText(row.value), row.active ? "Sim" : "Não", row.effectiveFrom, row.updatedBy || "", row.updatedAt])
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
  const employees = await listBillingEmployees(filters, referenceMonth, cycle?.id ?? null);
  const employeeIds = employees.map((employee) => employee.id);
  if (!employeeIds.length) return [] as InvoiceCalculation[];

  const period = monthPeriod(referenceMonth);
  const lobIds = Array.from(new Set(employees.map((employee) => employee.lobId).filter(Boolean))) as string[];
  const includeMonthlyAdvance = isMonthlyAdvanceReferenceMonthAvailable(referenceMonth);

  const [workHours, schedules, advances, persistedInvoices, sensitiveRows] = await Promise.all([
    prisma.workHourRecord.findMany({
      where: {
        employeeId: { in: employeeIds },
        date: { gte: period.start, lte: period.end },
        status: { in: BILLABLE_WORK_HOUR_STATUSES }
      },
      select: { employeeId: true, date: true, effectiveHours: true, status: true },
      orderBy: { date: "asc" }
    }),
    prisma.schedule.findMany({
      where: {
        employeeId: { in: employeeIds },
        deletedAt: null,
        date: { gte: period.start, lte: period.end },
        status: { in: Array.from(PROJECTABLE_SCHEDULE_STATUSES) }
      },
      select: { employeeId: true, date: true, status: true, shift: { select: { name: true } } },
      orderBy: { date: "asc" }
    }),
    includeMonthlyAdvance
      ? prisma.monthlyAdvanceRecord.findMany({
        where: { employeeId: { in: employeeIds }, referenceMonth, status: { not: "REMOVED" } },
        select: { employeeId: true, optIn: true, amount: true, finalAmount: true }
      })
      : Promise.resolve([]),
    cycle
      ? prisma.billingEmployeeInvoice.findMany({
        where: { billingCycleId: cycle.id, employeeId: { in: employeeIds } },
        select: {
          id: true,
          employeeId: true,
          status: true,
          approvedMinutes: true,
          projectedMinutes: true,
          totalConsideredMinutes: true,
          hourlyRate: true,
          billingRule: true,
          grossAmount: true,
          advanceAmount: true,
          campaignAmount: true,
          adjustmentAmount: true,
          finalAmount: true,
          approvedByEmployeeAt: true,
          approvedByEmployeeUserId: true,
          fiscalInvoice: true
        }
      })
      : Promise.resolve([]),
    prisma.employeeSensitiveData.findMany({
      where: { employeeId: { in: employeeIds } },
      select: { employeeId: true, cnpj: true }
    })
  ]);

  const sensitiveByEmployee = new Map(sensitiveRows.map((row) => [row.employeeId, row]));
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
    const sensitive = sensitiveByEmployee.get(employee.id);
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
    const projectedSchedules = (schedulesByEmployee.get(employee.id) ?? []).filter((schedule) => {
      if (!isScheduleWithinEmployeeBillingWindow(employee, schedule.date)) return false;
      return !approvedByDate.has(dateKey(schedule.date));
    });
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
    const adjustmentBreakdown = buildAdjustmentBreakdown(adjustmentRowsForEmployee);
    const persisted = persistedByEmployee.get(employee.id);
    const status = persisted?.status ?? defaultInvoiceStatusForCycle(cycle?.status);
    const automaticAdvanceAmount = advance?.optIn ? roundMoney(Number(advance.finalAmount ?? advance.amount ?? MONTHLY_ADVANCE_FIXED_AMOUNT)) : 0;
    const advanceAmount = roundMoney(automaticAdvanceAmount + adjustmentBreakdown.manualAdvanceAmount);
    const campaignAmount = adjustmentBreakdown.campaignAmount;
    const bonusAmount = adjustmentBreakdown.bonusAmount;
    const discountAmount = adjustmentBreakdown.discountAmount;
    const correctionAmount = adjustmentBreakdown.correctionAmount;
    const otherAdjustmentAmount = adjustmentBreakdown.otherAdjustmentAmount;
    const adjustmentAmount = roundMoney(bonusAmount + correctionAmount + otherAdjustmentAmount - discountAmount);
    const finalAmount = roundMoney(grossAmount - advanceAmount + campaignAmount + adjustmentAmount);

    const invoice = {
      id: persisted?.id ?? "",
      referenceMonth,
      employeeId: employee.id,
      employeeName: employee.fullName,
      wbLogin: employee.wbLogin,
      cnpj: sensitive?.cnpj ?? "",
      pixKeyType: employee.pixKeyType ?? "",
      pixKey: employee.pixKey ?? "",
      email: employee.user?.email ?? "",
      roleTitle: employee.roleTitle,
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
      billingRuleLabel: rate.billingRuleLabel,
      billingRateSource: rate.billingRateSource,
      billingWarning: rate.billingWarning,
      grossAmount,
      advanceAmount,
      automaticAdvanceAmount,
      manualAdvanceAmount: adjustmentBreakdown.manualAdvanceAmount,
      campaignAmount,
      bonusAmount,
      discountAmount,
      correctionAmount,
      otherAdjustmentAmount,
      adjustmentAmount,
      finalAmount,
      adjustmentTypes: adjustmentBreakdown.types,
      hasOpenAdjustment: persisted ? openAdjustmentInvoiceIds.has(persisted.id) : false,
      fiscalInvoice: mapBillingFiscalInvoice(
        persisted?.fiscalInvoice ?? null,
        persisted?.id ?? "",
        status
      ),
      hourDetails: [...approvedDetails, ...projectedDetails]
    };
    invoices.push(persisted && isFinalizedInvoiceStatus(persisted.status) ? applyPersistedInvoiceSnapshot(invoice, persisted) : invoice);
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
    isMonthlyAdvanceReferenceMonthAvailable(referenceMonth)
      ? prisma.monthlyAdvanceRecord.findFirst({ where: { employeeId: employee.id, referenceMonth, status: { not: "REMOVED" } } })
      : Promise.resolve(null),
    billingCycleId
      ? prisma.billingAdjustment.findMany({ where: { billingCycleId, deletedAt: null, OR: [{ employeeId: employee.id }, { employeeId: null, lobId: employee.lobId }, { employeeInvoice: { employeeId: employee.id } }] } })
      : Promise.resolve([]),
    billingCycleId
      ? prisma.billingEmployeeInvoice.findUnique({
        where: { billingCycleId_employeeId: { billingCycleId, employeeId: employee.id } },
        include: { fiscalInvoice: true }
      })
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
    if (!isScheduleWithinEmployeeBillingWindow(employee, schedule.date)) return false;
    if (!PROJECTABLE_SCHEDULE_STATUSES.has(schedule.status)) return false;
    if (approvedByDate.has(dateKey(schedule.date))) return false;
    return true;
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
  const adjustmentBreakdown = buildAdjustmentBreakdown(adjustmentRows);
  const automaticAdvanceAmount = advance?.optIn ? roundMoney(Number(advance.finalAmount ?? advance.amount ?? MONTHLY_ADVANCE_FIXED_AMOUNT)) : 0;
  const advanceAmount = roundMoney(automaticAdvanceAmount + adjustmentBreakdown.manualAdvanceAmount);
  const campaignAmount = adjustmentBreakdown.campaignAmount;
  const bonusAmount = adjustmentBreakdown.bonusAmount;
  const discountAmount = adjustmentBreakdown.discountAmount;
  const correctionAmount = adjustmentBreakdown.correctionAmount;
  const otherAdjustmentAmount = adjustmentBreakdown.otherAdjustmentAmount;
  const adjustmentAmount = roundMoney(bonusAmount + correctionAmount + otherAdjustmentAmount - discountAmount);
  const finalAmount = roundMoney(grossAmount - advanceAmount + campaignAmount + adjustmentAmount);

  const invoice = {
    id: persisted?.id ?? "",
    referenceMonth,
    employeeId: employee.id,
    employeeName: employee.fullName,
    wbLogin: employee.wbLogin,
    cnpj: "",
    pixKeyType: employee.pixKeyType ?? "",
    pixKey: employee.pixKey ?? "",
    email: employee.user?.email ?? "",
    roleTitle: employee.roleTitle,
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
    billingRuleLabel: rate.billingRuleLabel,
    billingRateSource: rate.billingRateSource,
    billingWarning: rate.billingWarning,
    grossAmount,
    advanceAmount,
    automaticAdvanceAmount,
    manualAdvanceAmount: adjustmentBreakdown.manualAdvanceAmount,
    campaignAmount,
    bonusAmount,
    discountAmount,
    correctionAmount,
    otherAdjustmentAmount,
    adjustmentAmount,
    finalAmount,
    adjustmentTypes: adjustmentBreakdown.types,
    hasOpenAdjustment: false,
    fiscalInvoice: mapBillingFiscalInvoice(
      persisted?.fiscalInvoice ?? null,
      persisted?.id ?? "",
      persisted?.status ?? defaultInvoiceStatusForCycle(cycleStatus)
    ),
    hourDetails: [...approvedDetails, ...projectedDetails]
  };
  return persisted && isFinalizedInvoiceStatus(persisted.status) ? applyPersistedInvoiceSnapshot(invoice, persisted) : invoice;
}

async function listBillingEmployees(filters: BillingDashboardFilters, referenceMonth: string, cycleId: string | null) {
  const period = monthPeriod(referenceMonth);
  const [approvedHourEmployees, finalizedInvoices] = await Promise.all([
    prisma.workHourRecord.findMany({
      where: {
        date: { gte: period.start, lte: period.end },
        status: { in: BILLABLE_WORK_HOUR_STATUSES }
      },
      distinct: ["employeeId"],
      select: { employeeId: true }
    }),
    cycleId
      ? prisma.billingEmployeeInvoice.findMany({
        where: { billingCycleId: cycleId, status: "FECHADO" },
        distinct: ["employeeId"],
        select: { employeeId: true }
      })
      : Promise.resolve([])
  ]);
  const approvedHourEmployeeIds = approvedHourEmployees.map((record) => record.employeeId);
  const finalizedInvoiceEmployeeIds = finalizedInvoices.map((invoice) => invoice.employeeId);
  const where: Prisma.EmployeeProfileWhereInput = {
    deletedAt: null,
    OR: [
      { terminationDate: null },
      { terminationDate: { gte: period.start } },
      ...(approvedHourEmployeeIds.length ? [{ id: { in: approvedHourEmployeeIds } }] : []),
      ...(finalizedInvoiceEmployeeIds.length ? [{ id: { in: finalizedInvoiceEmployeeIds } }] : [])
    ]
  };
  const and: Prisma.EmployeeProfileWhereInput[] = [];
  if (filters.lob && filters.lob !== "Todos") and.push({ lobId: filters.lob });
  if (filters.supervisorId && filters.supervisorId !== "Todos") and.push({ supervisorId: filters.supervisorId });
  if (filters.skill && filters.skill !== "Todos") {
    if (filters.skill === "Sem skill") and.push({ OR: [{ skill: null }, { skill: "" }] });
    else and.push({ skill: { equals: filters.skill, mode: "insensitive" } });
  }
  if (filters.shiftId && filters.shiftId !== "Todos") and.push({ shiftId: filters.shiftId });
  if (filters.employeeId) and.push({ id: filters.employeeId });
  if (filters.roleTitle && filters.roleTitle !== "Todos") and.push({ roleTitle: { equals: filters.roleTitle, mode: "insensitive" } });
  const employeeStatus = filters.employeeStatus?.trim();
  if (employeeStatus && !["Todos", "Ambos"].includes(employeeStatus)) {
    and.push({ operationalStatus: { equals: employeeStatus, mode: "insensitive" } });
  }
  const search = filters.search?.trim();
  if (search) {
    and.push({
      OR: [
        { fullName: { contains: search, mode: "insensitive" } },
        { wbLogin: { contains: search, mode: "insensitive" } },
        { roleTitle: { contains: search, mode: "insensitive" } },
        { skill: { contains: search, mode: "insensitive" } },
        { user: { email: { contains: search, mode: "insensitive" } } },
        { lob: { name: { contains: search, mode: "insensitive" } } },
        { supervisor: { fullName: { contains: search, mode: "insensitive" } } }
      ]
    });
  }
  if (and.length) where.AND = and;

  const employees = await prisma.employeeProfile.findMany({
    where,
    include: { user: true, lob: true, supervisor: true, shift: true },
    orderBy: [{ lob: { name: "asc" } }, { fullName: "asc" }]
  });
  return employees.filter((employee) => isBillableEmployee(employee));
}

function filterInvoices<T extends { status: string; billingRule?: string; adjustmentTypes?: string[] }>(invoices: T[], filters: BillingDashboardFilters) {
  return invoices.filter((invoice) => {
    if (filters.invoiceStatus && filters.invoiceStatus !== "Todos" && invoice.status !== filters.invoiceStatus) return false;
    if (filters.billingRule && filters.billingRule !== "Todos" && invoice.billingRule !== filters.billingRule) return false;
    if (filters.adjustmentType && filters.adjustmentType !== "Todos") {
      const target = normalizeComparableJobTitle(filters.adjustmentType);
      if (!invoice.adjustmentTypes?.some((type) => normalizeComparableJobTitle(type) === target)) return false;
    }
    return true;
  });
}

function isFinalizedInvoiceStatus(status?: string | null) {
  return status === "FECHADO";
}

function applyPersistedInvoiceSnapshot<T extends InvoiceCalculation>(invoice: T, persisted: PersistedInvoiceSnapshot): T {
  const advanceAmount = Number(persisted.advanceAmount);
  const campaignAmount = Number(persisted.campaignAmount);
  const adjustmentAmount = Number(persisted.adjustmentAmount);
  return {
    ...invoice,
    id: persisted.id,
    status: persisted.status,
    statusLabel: invoiceStatusLabel(persisted.status),
    approvedByEmployeeAt: persisted.approvedByEmployeeAt ? formatDateTime(persisted.approvedByEmployeeAt) : "",
    approvedMinutes: persisted.approvedMinutes,
    projectedMinutes: persisted.projectedMinutes,
    projectedDays: Math.max(0, Math.round(persisted.projectedMinutes / 480)),
    totalConsideredMinutes: persisted.totalConsideredMinutes,
    hourlyRate: Number(persisted.hourlyRate),
    billingRule: persisted.billingRule,
    billingRuleLabel: `${invoice.billingRuleLabel || persisted.billingRule} (snapshot finalizado)`,
    billingRateSource: "Snapshot finalizado pelo Admin Central",
    grossAmount: Number(persisted.grossAmount),
    advanceAmount,
    campaignAmount,
    adjustmentAmount,
    finalAmount: Number(persisted.finalAmount),
    hasOpenAdjustment: false,
    fiscalInvoice: mapBillingFiscalInvoice(persisted.fiscalInvoice, persisted.id, persisted.status)
  };
}

async function upsertEmployeeInvoice(
  cycleId: string,
  calculated: InvoiceCalculation,
  extra: InvoiceExtra = {},
  client: Prisma.TransactionClient | typeof prisma = prisma
) {
  const status = String(extra.status ?? calculated.status ?? defaultInvoiceStatusForCycle(null));
  const approvalRelation = extra.approvedByEmployeeUserId ? { approvedByEmployeeUser: { connect: { id: extra.approvedByEmployeeUserId } } } : {};
  const clearApproval = extra.clearEmployeeApproval ? { approvedByEmployeeAt: null, approvedByEmployeeUser: { disconnect: true } } : {};
  return client.billingEmployeeInvoice.upsert({
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
      ...clearApproval,
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
      group: config.group,
      skillKey: "skillKey" in config ? config.skillKey : "",
      displayName: config.displayName,
      shiftBucket: "shiftBucket" in config ? config.shiftBucket : "",
      effectiveFrom: "",
      updatedBy: "",
      updatedAt: ""
    };
  });
}

function resolveHourlyRate(employee: BillingEmployee, rates: BillingRates): BillingRateResolution {
  const skill = normalizeComparableJobTitle(employee.skill);
  if (skill.includes("bilingual") || skill.includes("bilingue")) {
    return {
      hourlyRate: rates.BILINGUAL_HOURLY_RATE,
      billingRule: "BILINGUAL",
      billingRuleLabel: "Bilingual",
      billingRateSource: "Skill Bilingual"
    };
  }
  if (skill === "ra") {
    return {
      hourlyRate: rates.RA_HOURLY_RATE,
      billingRule: "RA",
      billingRuleLabel: "RA",
      billingRateSource: "Skill RA"
    };
  }
  if (isAssistantSkill(employee.skill)) {
    return {
      hourlyRate: rates.ASSISTANT_HOURLY_RATE,
      billingRule: "ASSISTANT",
      billingRuleLabel: "Assistant",
      billingRateSource: "Skill Assistant"
    };
  }

  const shiftBucket = officialShiftBucket(employee.shift?.name);
  if (!shiftBucket) {
    return {
      hourlyRate: 0,
      billingRule: "TURNO_NAO_CADASTRADO",
      billingRuleLabel: "Turno oficial não cadastrado",
      billingRateSource: "Cadastro do colaborador",
      billingWarning: "Turno oficial não cadastrado."
    };
  }

  const staffRule = resolveStaffRateRule(employee.skill);
  if (staffRule) {
    const rateKey = shiftBucket === "NOITE" ? staffRule.nightKey : staffRule.dayKey;
    const shiftLabel = shiftBucket === "NOITE" ? "Noite" : "Manhã/Tarde";
    return {
      hourlyRate: rates[rateKey],
      billingRule: `SKILL_${staffRule.skillKey}_${shiftBucket}`,
      billingRuleLabel: `Skill ${staffRule.displayName} + Turno ${shiftLabel}`,
      billingRateSource: `Skill ${staffRule.displayName}`
    };
  }

  if (isAgentJobTitle(employee.roleTitle)) {
    if (shiftBucket === "NOITE") {
      return applyPocAgentRateModifier(employee, {
        hourlyRate: rates.NIGHT_HOURLY_RATE,
        billingRule: "AGENTE_NOITE",
        billingRuleLabel: "Agente + Turno Noite",
        billingRateSource: "Cargo/Função Agente"
      });
    }
    if (shiftBucket === "TARDE") {
      return applyPocAgentRateModifier(employee, {
        hourlyRate: rates.AFTERNOON_HOURLY_RATE,
        billingRule: "AGENTE_TARDE",
        billingRuleLabel: "Agente + Turno Tarde",
        billingRateSource: "Cargo/Função Agente"
      });
    }
    return applyPocAgentRateModifier(employee, {
      hourlyRate: rates.MORNING_HOURLY_RATE,
      billingRule: "AGENTE_MANHA",
      billingRuleLabel: "Agente + Turno Manhã",
      billingRateSource: "Cargo/Função Agente"
    });
  }

  return {
    hourlyRate: 0,
    billingRule: "VALOR_NAO_CONFIGURADO",
    billingRuleLabel: "Valor/hora não configurado",
    billingRateSource: "Sem regra aplicável",
    billingWarning: "Valor/hora não configurado para este cargo/skill."
  };
}

function applyPocAgentRateModifier(employee: Pick<BillingEmployee, "roleTitle" | "skill">, rate: BillingRateResolution): BillingRateResolution {
  if (!isAgentJobTitle(employee.roleTitle) || !isPocSkill(employee.skill) || rate.hourlyRate <= 0) return rate;
  return {
    ...rate,
    hourlyRate: roundMoney(rate.hourlyRate * POC_AGENT_HOURLY_RATE_MULTIPLIER),
    billingRule: `${rate.billingRule}_POC`,
    billingRuleLabel: `${rate.billingRuleLabel} + Skill POC (15%)`,
    billingRateSource: `${rate.billingRateSource} + adicional POC`
  };
}

function isBillableEmployee(employee: Pick<BillingEmployee, "roleTitle" | "skill" | "contractType"> & { operationalStatus?: string | null }) {
  if (isTrainingTerminationStatus(employee.operationalStatus)) return false;
  if (!isBillingEligibleContract(employee.contractType)) return false;
  return isAgentJobTitle(employee.roleTitle) || Boolean(resolveStaffRateRule(employee.skill)) || isSpecialBillingSkill(employee.skill);
}

function isScheduleWithinEmployeeBillingWindow(employee: Pick<BillingEmployee, "terminationDate">, date: Date) {
  if (!employee.terminationDate) return true;
  return startOfUtcDay(date).getTime() <= startOfUtcDay(employee.terminationDate).getTime();
}

function isTrainingTerminationStatus(value?: string | null) {
  const status = normalizeComparableJobTitle(value).replace(/[^a-z0-9]/g, "");
  return status === "desligadoemtreinamento" || status === "desligadotreinamento";
}

function isBillingEligibleContract(value?: string | null) {
  const contract = normalizeComparableJobTitle(value).replace(/[^a-z0-9]/g, "");
  return contract === "pj" || contract === "pessoajuridica" || contract === "pessoajuridico";
}

async function validateBillingAdjustmentTarget(input: { employeeInvoiceId?: string | null; employeeId?: string | null }) {
  if (input.employeeInvoiceId) {
    const invoice = await prisma.billingEmployeeInvoice.findUnique({
      where: { id: input.employeeInvoiceId },
      select: {
        id: true,
        employee: { select: { contractType: true } }
      }
    });
    if (!invoice) return { error: "Invoice do colaborador não encontrado.", status: 404 };
    if (!isBillingEligibleContract(invoice.employee.contractType)) return { error: BILLING_PJ_ONLY_MESSAGE, status: 403 };
  }

  if (input.employeeId) {
    const employee = await prisma.employeeProfile.findFirst({
      where: { id: input.employeeId, deletedAt: null },
      select: { contractType: true }
    });
    if (!employee) return { error: "Colaborador não encontrado.", status: 404 };
    if (!isBillingEligibleContract(employee.contractType)) return { error: BILLING_PJ_ONLY_MESSAGE, status: 403 };
  }

  return null;
}

async function validateBillingAdjustmentFinalizedTarget(cycleId: string, input: { employeeInvoiceId?: string | null; employeeId?: string | null }) {
  const invoice = input.employeeInvoiceId
    ? await prisma.billingEmployeeInvoice.findUnique({ where: { id: input.employeeInvoiceId }, select: { status: true } })
    : input.employeeId
      ? await prisma.billingEmployeeInvoice.findUnique({
        where: { billingCycleId_employeeId: { billingCycleId: cycleId, employeeId: input.employeeId } },
        select: { status: true }
      })
      : null;
  if (isFinalizedInvoiceStatus(invoice?.status)) {
    return { error: "Invoice individual já finalizado. Reabra o invoice antes de aplicar novos ajustes.", status: 409 };
  }
  return null;
}

function isSpecialBillingSkill(value?: string | null) {
  const skill = normalizeComparableJobTitle(value);
  return skill.includes("bilingual") || skill.includes("bilingue") || skill === "ra" || isAssistantSkill(value);
}

function isPocSkill(value?: string | null) {
  const skill = normalizeComparableJobTitle(value).replace(/[^a-z0-9]/g, "");
  return skill === "poc";
}

function isAssistantSkill(value?: string | null) {
  const skill = normalizeComparableJobTitle(value);
  return skill === "assistant" || skill === "assistente";
}

function resolveStaffRateRule(value?: string | null) {
  const skill = normalizeComparableJobTitle(value);
  return STAFF_RATE_RULES.find((rule) => rule.aliases.some((alias) => normalizeComparableJobTitle(alias) === skill)) ?? null;
}

function officialShiftBucket(value?: string | null): "MANHA" | "TARDE" | "NOITE" | null {
  const shift = normalizeComparableJobTitle(cleanShiftName(value ?? ""));
  if (!shift) return null;
  if (shift.includes("noite")) return "NOITE";
  if (shift.includes("tarde")) return "TARDE";
  if (shift.includes("manha") || shift.includes("manhã")) return "MANHA";
  return null;
}

function buildAdjustmentBreakdown(rows: Array<{ type: string; amount: Prisma.Decimal | number }>) {
  const breakdown = {
    campaignAmount: 0,
    bonusAmount: 0,
    discountAmount: 0,
    correctionAmount: 0,
    manualAdvanceAmount: 0,
    otherAdjustmentAmount: 0,
    types: [] as string[]
  };
  const typeNames = new Set<string>();
  for (const row of rows) {
    const type = row.type.trim() || "Ajuste";
    const normalized = normalizeComparableJobTitle(type);
    const amount = roundMoney(Number(row.amount));
    typeNames.add(type);
    if (normalized === "campanha") breakdown.campaignAmount = roundMoney(breakdown.campaignAmount + amount);
    else if (normalized === "bonus" || normalized === "bonificacao") breakdown.bonusAmount = roundMoney(breakdown.bonusAmount + amount);
    else if (normalized === "desconto") breakdown.discountAmount = roundMoney(breakdown.discountAmount + Math.abs(amount));
    else if (normalized === "adiantamento") breakdown.manualAdvanceAmount = roundMoney(breakdown.manualAdvanceAmount + Math.abs(amount));
    else if (normalized === "correcao" || normalized === "correção") breakdown.correctionAmount = roundMoney(breakdown.correctionAmount + amount);
    else breakdown.otherAdjustmentAmount = roundMoney(breakdown.otherAdjustmentAmount + amount);
  }
  breakdown.types = Array.from(typeNames).sort((a, b) => a.localeCompare(b, "pt-BR"));
  return breakdown;
}

function normalizeBillingAdjustmentAmount(type: string, amount: number) {
  const normalized = normalizeComparableJobTitle(type);
  if (normalized === "desconto" || normalized === "adiantamento") return -Math.abs(amount);
  return amount;
}

function readBulkAdjustmentCell(row: Record<string, unknown>, keys: string[]) {
  const normalizedKeys = new Map(Object.keys(row).map((key) => [normalizeBulkHeader(key), key]));
  for (const key of keys) {
    const originalKey = normalizedKeys.get(normalizeBulkHeader(key));
    if (!originalKey) continue;
    const value = row[originalKey];
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return value;
  }
  return "";
}

function normalizeBulkHeader(value: string) {
  return normalizeComparableJobTitle(value).replace(/[^a-z0-9]/g, "");
}

function normalizeBulkLookup(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function isBulkAdjustmentRowEmpty(row: Record<string, unknown>) {
  return Object.values(row).every((value) => String(value ?? "").trim() === "");
}

function parseBulkAdjustmentTypeAndAmount(row: Record<string, unknown>) {
  const explicitType = readBulkAdjustmentCell(row, ["tipo", "type"]);
  const explicitAmount = readBulkAdjustmentCell(row, ["valor", "amount"]);
  if (explicitType && explicitAmount !== "") {
    const normalizedType = normalizeComparableJobTitle(explicitType);
    const type = normalizedType === "bonus" || normalizedType === "bonificacao"
      ? "Bônus"
      : normalizedType === "correcao" || normalizedType === "correção"
        ? "Correção"
        : "";
    const amount = parseBulkMoney(explicitAmount);
    if (type && Number.isFinite(amount)) return { type, amount };
  }

  const correction = readBulkAdjustmentCell(row, ["correcao", "correção", "correction"]);
  const correctionAmount = parseBulkMoney(correction);
  if (Number.isFinite(correctionAmount)) return { type: "Correção", amount: correctionAmount };

  const bonus = readBulkAdjustmentCell(row, ["bonus", "bônus", "bonificacao", "bonificação"]);
  const bonusAmount = parseBulkMoney(bonus);
  if (Number.isFinite(bonusAmount)) return { type: "Bônus", amount: bonusAmount };

  return null;
}

function parseBulkMoney(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return roundMoney(value);
  const text = String(value ?? "").trim();
  if (!text) return NaN;
  const clean = text.replace(/R\$/gi, "").replace(/\s/g, "");
  const normalized = clean.includes(",")
    ? clean.replace(/\./g, "").replace(",", ".")
    : clean.replace(/,/g, "");
  const number = Number(normalized);
  return Number.isFinite(number) ? roundMoney(number) : NaN;
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

function buildBillingFilterOptions(invoices: Array<{
  lobId?: string | null;
  lob: string;
  supervisorId?: string | null;
  supervisor: string;
  roleTitle?: string;
  skill?: string;
  officialShiftId?: string | null;
  officialShift?: string;
  billingRule?: string;
  billingRuleLabel?: string;
  adjustmentTypes?: string[];
}>) {
  return {
    lobs: uniqueOptionPairs(invoices.map((row) => ({ value: row.lobId ?? "", label: row.lob }))).filter((item) => item.value),
    supervisors: uniqueOptionPairs(invoices.map((row) => ({ value: row.supervisorId ?? "", label: row.supervisor }))).filter((item) => item.value),
    roleTitles: uniqueTextOptions(invoices.map((row) => row.roleTitle)),
    skills: uniqueTextOptions(invoices.map((row) => row.skill || "Sem skill")),
    shifts: uniqueOptionPairs(invoices.map((row) => ({ value: row.officialShiftId ?? "", label: row.officialShift ?? "" }))).filter((item) => item.value),
    billingRules: uniqueOptionPairs(invoices.map((row) => ({ value: row.billingRule ?? "", label: row.billingRuleLabel ?? row.billingRule ?? "" }))).filter((item) => item.value),
    adjustmentTypes: uniqueTextOptions(invoices.flatMap((row) => row.adjustmentTypes ?? []))
  };
}

function uniqueTextOptions(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function uniqueOptionPairs(values: Array<{ value: string; label: string }>) {
  const options = new Map<string, string>();
  for (const item of values) {
    const value = item.value.trim();
    const label = item.label.trim();
    if (value && label && !options.has(value)) options.set(value, label);
  }
  return Array.from(options.entries()).map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
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

function buildFinanceCostLobSummary(invoices: InvoiceCalculation[]): BillingFinanceCostSnapshotRow[] {
  const byLob = new Map<string, InvoiceCalculation[]>();
  for (const invoice of invoices) byLob.set(invoice.lob, [...(byLob.get(invoice.lob) ?? []), invoice]);
  return Array.from(byLob.entries()).map(([lob, rows]) => ({
    referenceMonth: rows[0]?.referenceMonth ?? "",
    lob,
    agents: new Set(rows.map((row) => row.employeeId)).size,
    approvedMinutes: rows.reduce((sum, row) => sum + row.approvedMinutes, 0),
    projectedMinutes: rows.reduce((sum, row) => sum + row.projectedMinutes, 0),
    approvedCostBrl: roundMoney(rows.reduce((sum, row) => sum + (row.approvedMinutes / 60) * row.hourlyRate, 0)),
    projectedCostBrl: roundMoney(rows.reduce((sum, row) => sum + (row.projectedMinutes / 60) * row.hourlyRate, 0)),
    grossAmount: roundMoney(rows.reduce((sum, row) => sum + row.grossAmount, 0)),
    advanceAmount: roundMoney(rows.reduce((sum, row) => sum + row.advanceAmount, 0)),
    adjustmentAmount: roundMoney(rows.reduce((sum, row) => sum + row.adjustmentAmount + row.campaignAmount, 0)),
    finalAmount: roundMoney(rows.reduce((sum, row) => sum + row.finalAmount, 0))
  })).sort((a, b) => a.lob.localeCompare(b.lob, "pt-BR"));
}

async function listCycleAdjustments(billingCycleId: string, employeeIds?: Set<string> | null) {
  const employeeWhere = employeeIds
    ? {
      OR: [
        { employeeId: { in: Array.from(employeeIds) } },
        { employeeInvoice: { employeeId: { in: Array.from(employeeIds) } } }
      ]
    }
    : {};
  const rows = await prisma.billingAdjustment.findMany({
    where: { billingCycleId, deletedAt: null, ...employeeWhere },
    include: { employee: true, lob: true, createdBy: true },
    orderBy: { createdAt: "desc" }
  });
  return rows.map(mapAdjustment);
}

async function listInvoiceAdjustmentRequests(billingCycleId: string, employeeIds?: Set<string> | null) {
  const rows = await prisma.invoiceAdjustmentRequest.findMany({
    where: {
      billingCycleId,
      ...(employeeIds ? { employeeId: { in: Array.from(employeeIds) } } : {})
    },
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

function buildInvoiceComposition(invoice: InvoiceCalculation) {
  return [
    { label: "Horas aprovadas", hours: minutesToHoursLabel(invoice.approvedMinutes), value: roundMoney((invoice.approvedMinutes / 60) * invoice.hourlyRate), tone: "green" },
    { label: "Projeção de dias futuros", hours: minutesToHoursLabel(invoice.projectedMinutes), value: roundMoney((invoice.projectedMinutes / 60) * invoice.hourlyRate), tone: "blue" },
    { label: "Adiantamento", hours: "-", value: -invoice.advanceAmount, tone: "orange" },
    { label: "Campanha", hours: "-", value: invoice.campaignAmount, tone: "green" },
    { label: "Bônus", hours: "-", value: invoice.bonusAmount, tone: "green" },
    { label: "Correção", hours: "-", value: invoice.correctionAmount, tone: invoice.correctionAmount < 0 ? "red" : "green" },
    { label: "Desconto", hours: "-", value: -invoice.discountAmount, tone: "red" },
    { label: "Outros ajustes", hours: "-", value: invoice.otherAdjustmentAmount, tone: invoice.otherAdjustmentAmount < 0 ? "red" : "green" }
  ];
}

async function listEmployeeBillingAdjustmentDetails(cycleId: string, employeeId: string, lobId?: string | null) {
  const rows = await prisma.billingAdjustment.findMany({
    where: {
      billingCycleId: cycleId,
      deletedAt: null,
      OR: [
        { employeeId },
        { employeeInvoice: { employeeId } },
        ...(lobId ? [{ employeeId: null, employeeInvoiceId: null, lobId }] : [])
      ]
    },
    include: { lob: true, createdBy: true },
    orderBy: { createdAt: "desc" }
  });

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    description: row.description,
    observation: row.observation ?? "",
    amount: Number(row.amount),
    target: row.employeeId || row.employeeInvoiceId ? "Individual" : row.lob?.name ? `LOB ${row.lob.name}` : "Geral",
    createdBy: row.createdBy?.name ?? "",
    createdAt: formatDateTime(row.createdAt)
  }));
}

function canEmployeeApproveInvoice(cycleStatus?: string | null, invoiceStatus?: string | null) {
  return isInvoiceAvailableForEmployeeReview(cycleStatus, invoiceStatus) && invoiceStatus !== "APROVADO_COLABORADOR" && !isFinalizedInvoiceStatus(invoiceStatus);
}

function canEmployeeRequestAdjustment(cycleStatus: string | null | undefined, invoiceStatus: string | null | undefined) {
  return isInvoiceAvailableForEmployeeReview(cycleStatus, invoiceStatus)
    && invoiceStatus !== "APROVADO_COLABORADOR"
    && !isFinalizedInvoiceStatus(invoiceStatus);
}

function isInvoiceAvailableForEmployeeReview(cycleStatus?: string | null, invoiceStatus?: string | null) {
  return cycleStatus === "FINALIZADO_CONFERENCIA" || invoiceStatus === "DISPONIVEL_APROVACAO";
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
  if (!canAccessBilling({ id: user.id, email: user.email, name: user.name, role: user.role.name })) {
    return { error: "Você não tem permissão para acessar Billing.", status: 403 };
  }
  return null;
}

function requireBillingManagement(user: ActiveUser | null) {
  if (!user) return { error: "Usuário ativo não encontrado.", status: 401 };
  if (!canManageBilling({ id: user.id, email: user.email, name: user.name, role: user.role.name })) {
    return { error: "Você não tem permissão para administrar Billing.", status: 403 };
  }
  return null;
}

function getBillingAccessScope(user: ActiveUser | null): { restricted: false; supervisorId?: undefined } | { restricted: true; supervisorId: string } | { error: string; status: number } {
  if (!user) return { error: "Usuário ativo não encontrado.", status: 401 };
  if (canManageBilling({ id: user.id, email: user.email, name: user.name, role: user.role.name })) return { restricted: false };
  if (normalizeRole(user.role.name) === "SUPERVISOR") {
    const supervisorId = user.employeeProfile?.id;
    if (!supervisorId) return { error: "Supervisor sem cadastro vinculado para filtrar o time no Billing.", status: 403 };
    return { restricted: true, supervisorId };
  }
  if (canAccessBilling({ id: user.id, email: user.email, name: user.name, role: user.role.name })) return { restricted: false };
  return { error: "Você não tem permissão para acessar Billing.", status: 403 };
}

function applyBillingScope(filters: BillingDashboardFilters, scope: { restricted: false; supervisorId?: undefined } | { restricted: true; supervisorId: string }): BillingDashboardFilters {
  if (!scope.restricted) return filters;
  return { ...filters, supervisorId: scope.supervisorId };
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
  return normalizeReferenceMonth(input || DEFAULT_BILLING_REFERENCE_MONTH, DEFAULT_BILLING_REFERENCE_MONTH);
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

function mapBillingFiscalInvoice(
  row: BillingFiscalInvoiceRecord | null | undefined,
  employeeInvoiceId: string,
  employeeInvoiceStatus: string
): BillingFiscalInvoiceView | null {
  if (!row || !employeeInvoiceId) return null;
  const omieStatus = row.omieStatus === "SYNCED"
    ? "SYNCED"
    : employeeInvoiceStatus === "APROVADO_COLABORADOR"
      ? normalizeOmieStatus(row.omieStatus)
      : "NOT_SENT";
  return {
    id: row.id,
    accessKey: row.accessKey ?? "",
    invoiceNumber: row.invoiceNumber,
    grossAmount: Number(row.grossAmount),
    serviceDescription: row.serviceDescription,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    submittedAt: formatDateTime(row.submittedAt),
    downloadUrl: `/api/billing/invoices/${encodeURIComponent(employeeInvoiceId)}/fiscal-document`,
    omie: {
      status: omieStatus,
      launchCode: row.omieLaunchCode ?? "",
      syncedAt: row.omieSyncedAt ? formatDateTime(row.omieSyncedAt) : "",
      lastAttemptAt: row.omieLastAttemptAt ? formatDateTime(row.omieLastAttemptAt) : "",
      lastError: row.omieLastError ?? "",
      attempts: row.omieAttempts,
      canRetry: employeeInvoiceStatus === "APROVADO_COLABORADOR" && omieStatus !== "SYNCED"
    }
  };
}

async function resolveBillingFiscalSubmission(input: {
  actorEmail: string;
  referenceMonth: string;
  employeeId: string;
  billingGrossAmount: number;
  file: File | null;
  validationToken: string;
  existing: BillingFiscalInvoiceRecord | null;
}): Promise<BillingFiscalDocumentExtraction> {
  let extraction: BillingFiscalDocumentExtraction;

  if (input.file) {
    if (!input.validationToken) {
      throw new BillingFiscalExtractionError("Aguarde a leitura automática da nota fiscal antes de aprovar.");
    }
    extraction = await verifyBillingFiscalValidationToken(input.validationToken, input.file, {
      actorEmail: input.actorEmail,
      referenceMonth: input.referenceMonth,
      employeeId: input.employeeId,
      billingGrossAmount: input.billingGrossAmount
    });
  } else if (hasReusableBillingFiscalExtraction(input.existing)) {
    extraction = {
      accessKey: input.existing.accessKey,
      invoiceNumber: input.existing.invoiceNumber,
      serviceAmount: Number(input.existing.grossAmount),
      serviceDescription: input.existing.serviceDescription,
      documentHash: input.existing.documentHash,
      extractionMethod: normalizeBillingFiscalExtractionMethod(input.existing.extractionMethod)
    };
  } else {
    throw new BillingFiscalExtractionError("Anexe a nota fiscal para que os dados sejam lidos automaticamente.");
  }

  if (!currencyEquals(extraction.serviceAmount, input.billingGrossAmount)) {
    throw new BillingFiscalExtractionError(
      `O valor do serviço na nota (${formatBillingCurrency(extraction.serviceAmount)}) é diferente do valor esperado do Billing com o adiantamento reincorporado (${formatBillingCurrency(input.billingGrossAmount)}).`,
      409
    );
  }
  await ensureBillingFiscalDocumentAvailable(extraction, input.referenceMonth, input.employeeId);
  return extraction;
}

function hasReusableBillingFiscalExtraction(
  row: BillingFiscalInvoiceRecord | null | undefined
): row is BillingFiscalInvoiceRecord & { accessKey: string; documentHash: string; extractionMethod: string } {
  return Boolean(
    row?.accessKey
    && row.documentHash
    && row.extractionMethod
    && row.invoiceNumber
    && Number(row.grossAmount) > 0
  );
}

async function ensureBillingFiscalDocumentAvailable(
  extraction: Pick<BillingFiscalDocumentExtraction, "accessKey" | "documentHash">,
  referenceMonth: string,
  employeeId: string
) {
  const duplicate = await prisma.billingFiscalInvoice.findFirst({
    where: {
      OR: [
        { accessKey: extraction.accessKey },
        { documentHash: extraction.documentHash }
      ]
    },
    select: {
      employeeInvoice: {
        select: { referenceMonth: true, employeeId: true }
      }
    }
  });
  if (
    duplicate
    && (
      duplicate.employeeInvoice.referenceMonth !== referenceMonth
      || duplicate.employeeInvoice.employeeId !== employeeId
    )
  ) {
    throw new BillingFiscalExtractionError("Esta NFS-e já foi utilizada em outro invoice.", 409);
  }
}

function buildAutomaticBillingServiceDescription(extraction: BillingFiscalDocumentExtraction, referenceMonth: string) {
  return extraction.serviceDescription.trim()
    || `Prestação de serviços - Billing ${formatReferenceMonth(referenceMonth)}`;
}

function normalizeBillingFiscalExtractionMethod(value: string | null | undefined): BillingFiscalDocumentExtraction["extractionMethod"] {
  if (value === "PDF_TEXT" || value === "XML") return value;
  return "OCR";
}

function isBillingFiscalDuplicateError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError
    && error.code === "P2002"
    && Array.isArray(error.meta?.target)
    && error.meta.target.some((field) => field === "accessKey" || field === "documentHash");
}

function isBillingFiscalMigrationMissingError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError
    && (error.code === "P2021" || error.code === "P2022");
}

function logBillingFiscalPreviewFailure(error: unknown, stage: BillingFiscalPreviewStage) {
  const normalized = error instanceof Error
    ? {
      name: error.name,
      message: error.message,
      stack: error.stack
    }
    : {
      name: "UnknownError",
      message: String(error)
    };
  const prismaCode = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : undefined;
  console.error("[billing-fiscal-preview] unexpected failure", {
    stage,
    prismaCode,
    ...normalized
  });
}

function normalizeOmieStatus(value: string): "NOT_SENT" | "PENDING" | "SYNCED" | "ERROR" {
  if (value === "NOT_SENT" || value === "SYNCED" || value === "ERROR") return value;
  return "PENDING";
}

function buildBillingInvoiceStoragePath(referenceMonth: string, employeeId: string, fileName: string) {
  const safeName = fileName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(-100) || "nota-fiscal";
  return `${referenceMonth}/${employeeId}/${randomUUID()}-${safeName}`;
}

export function minutesToHoursLabel(minutes: number) {
  const safe = Math.max(0, Math.round(minutes));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

export function formatBillingCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number.isFinite(value) ? value : 0);
}

const BILLING_XLSX_CURRENCY_FORMAT = '[$R$-416] #,##0.00;[Red]-[$R$-416] #,##0.00;[$R$-416] 0.00';

function moneyText(value: number) {
  return roundMoney(Number.isFinite(value) ? value : 0);
}

function currencyColumnFormats(columns: number[]) {
  const formats: Record<number, string> = {};
  for (const column of columns) formats[column] = BILLING_XLSX_CURRENCY_FORMAT;
  return formats;
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
    observation: row.observation ?? "",
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
  const config = DEFAULT_RATE_CONFIGS.find((item) => item.key === row.key);
  return {
    id: row.id,
    key: row.key,
    label: config?.label ?? row.label,
    value: Number(row.value),
    active: row.active,
    group: config?.group ?? "CUSTOM",
    skillKey: config && "skillKey" in config ? config.skillKey : "",
    displayName: config?.displayName ?? row.label,
    shiftBucket: config && "shiftBucket" in config ? config.shiftBucket : "",
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
