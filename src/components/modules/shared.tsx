"use client";

import { type InputHTMLAttributes, useState } from "react";
import { AlertTriangle, CalendarCheck, ClipboardList, Frown, Headphones, HeartPulse, Laptop, Meh, ShieldCheck, Smile } from "lucide-react";
import { EmptyState, MetricPill } from "@/components/ui/primitives";
import { employees } from "@/lib/demo-data";
import { getDefaultDateRange } from "@/lib/default-date-range";
import { cn } from "@/lib/utils";
import { approvedShiftBaseTimes } from "@/lib/shift-base-times";
import { cleanShiftName, standardShiftNames } from "@/lib/shift-display";
import { formatSignedMinutesToHHMM, formatWorkHours, parseWorkHoursToMinutes, workHoursFromMinutes } from "@/lib/work-hours-rules";
export const employeeOperationalStatusOptions = ["Ativo", "Em treinamento", "Nesting", "Afastado", "Desligado", "Desligado em Treinamento", "Inativo", "Desativado"];

export const pcdDisabilityTypeOptions = ["", "Física", "Auditiva", "Visual", "Intelectual", "Psicossocial", "Múltipla", "Neurodivergente", "Outra", "Prefiro não informar"];

export const scheduleShiftTimes: Record<string, { startsAt: string; endsAt: string }> = approvedShiftBaseTimes;

export const dayOffKinds = ["DAY_OFF_SWAP", "DAY_OFF_SELL", "DAY_OFF_REQUEST"] as const;

export type DayOffKind = (typeof dayOffKinds)[number];

export const dayOffKindLabels: Record<DayOffKind, string> = {
  DAY_OFF_SWAP: "Troca de Folga",
  DAY_OFF_SELL: "Venda de Folga",
  DAY_OFF_REQUEST: "Solicitação de Dia de Folga"
};


export type ClientRequest = {
  id: string;
  type: string;
  title?: string;
  requester: string;
  requesterEmail?: string;
  requesterWbLogin?: string;
  lob?: string;
  supervisor?: string;
  priority: string;
  status: string;
  area: string;
  assignee?: string;
  nextStep?: string;
  nextOwner?: string;
  canSupervisorStep?: boolean;
  canWfmFinal?: boolean;
  time: string;
  description?: string;
  payload?: Record<string, unknown>;
  coverageImpact?: CoverageImpactClient | null;
  history?: Array<{ at: string; actor: string; action: string; reason?: string }>;
  comments?: Array<{ at: string; author: string; body: string }>;
  createdAt?: string;
  updatedAt?: string;
};


export type CoverageImpactClient = {
  requestId: string;
  requestType: string;
  impactStatus?: "IMPACTA" | "NAO_IMPACTA" | "SEM_REQUERIDO";
  impactDirection?: "MELHORA" | "PIORA" | "NEUTRO";
  impacts: Array<{
    date: string;
    label: string;
    lob: string;
    shift: string;
    required: number | null;
    currentAvailable: number;
    currentGap: number | null;
    impactDelta: number;
    projectedAvailable: number;
    projectedGap: number | null;
    impactStatus?: "IMPACTA" | "NAO_IMPACTA" | "SEM_REQUERIDO";
    impactDirection?: "MELHORA" | "PIORA" | "NEUTRO";
    result: "IMPROVES" | "WORSENS" | "NEUTRAL" | "NO_REQUIREMENT" | "NO_SCHEDULE";
    message?: string;
  }>;
  hasCriticalWarning: boolean;
  badgeLabel: string;
  badgeTone: "red" | "green" | "blue" | "slate" | "orange";
  summary: string;
};


export type CoverageWarningDialogState = {
  impact: CoverageImpactClient;
  onConfirm: () => Promise<void>;
};


export type WorkHourRow = {
  id: string;
  employeeName: string;
  wbLogin: string;
  employeeStatus: string;
  date: string;
  lob: string;
  supervisor: string;
  shift: string;
  plannedStart: string;
  plannedEnd: string;
  plannedHours: number;
  actualHours: number;
  adjustedHours: number;
  effectiveHours: number;
  capturedHours: number;
  differenceMinutes: number;
  status: string;
  rawStatus?: string;
  adjustmentId?: string;
  adjustmentStatus: string;
  adjustmentCurrentHours?: number | null;
  adjustmentRequestedHours?: number | null;
  adjustmentDifferenceMinutes?: number | null;
  adjustmentReason?: string;
  adjustmentJustification?: string;
  adjustmentRejectionReason?: string;
  adjustmentRejectedBy?: string;
  adjustmentRejectedAt?: string;
  adjustmentRequestedBy?: string;
  adjustmentRequestedAt?: string;
  source: string;
};


export type MonthlyAdvanceRecordClient = {
  id: string;
  employeeId: string;
  employeeName: string;
  wbLogin: string;
  email?: string;
  contractType?: string;
  lob?: string;
  supervisor: string;
  supervisorId?: string;
  employeeStatus?: string;
  referenceMonth: string;
  monthLabel: string;
  optIn: boolean;
  optInLabel: string;
  amount: number;
  status: string;
  observation?: string | null;
  updatedBy?: string;
  updatedAt: string;
  createdAt: string;
};


export function employeeMapStatusLabel(status: string) {
  const key = String(status ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const labels: Record<string, string> = {
    ONLINE: "Ativo",
    EM_ATENDIMENTO: "Ativo",
    OFFLINE: "Inativo",
    ESCALADO: "Ativo",
    PRESENTE: "Ativo",
    FALTA: "Ativo",
    FOLGA: "Ativo",
    FERIAS: "Ativo",
    ATRASO: "Ativo",
    SAIDA_ANTECIPADA: "Ativo",
    TROCA_APROVADA: "Ativo",
    VENDA_FOLGA_APROVADA: "Ativo",
    FOLGA_APROVADA: "Ativo",
    SEM_ESCALA: "Ativo",
    SEM_CRONOGRAMA: "Ativo",
    ERRO_ESCALA: "Ativo",
    ERRO_DE_CRONOGRAMA: "Ativo",
    TREINAMENTO: "Em treinamento",
    EM_TREINAMENTO: "Em treinamento",
    DESLIGADO: "Desligado",
    DESLIGADA: "Desligado",
    DESLIGADO_EM_TREINAMENTO: "Desligado em Treinamento",
    DESLIGADA_EM_TREINAMENTO: "Desligado em Treinamento",
    DESLIGADO_TREINAMENTO: "Desligado em Treinamento",
    DESLIGADA_TREINAMENTO: "Desligado em Treinamento",
    DESATIVADO: "Desativado",
    DESATIVADA: "Desativado",
    ACTIVE: "Ativo",
    INACTIVE: "Inativo",
    BLOCKED: "Inativo"
  };
  return labels[key] ?? status;
}


export function employeeStatusKey(value: string) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}


export type WorkHourSummary = {
  plannedHours: number;
  actualHours: number;
  differenceHours: number;
  okRecords: number;
  divergentRecords: number;
  overtimeHours: number;
  pendingHours: number;
  noScheduleRecords: number;
  pendingAdjustments: number;
  approvedAdjustments: number;
  rejectedAdjustments: number;
  adjustedHours: number;
};


export type RegistrationItem = {
  id: string;
  submittedAt: string;
  status: string;
  fullName: string;
  email: string;
  hasPassword?: boolean;
  cpf: string;
  cnpj: string;
  city: string;
  stateUf: string;
  primaryPhone: string;
  emergencyContactName: string;
  emergencyPhone: string;
  birthDate: string;
  educationLevel: string;
  ethnicity?: string;
  sexualOrientation?: string;
  isPcd?: string;
  pcdDisabilityType?: string;
  pcdDisabilityOther?: string;
  preferredSchedule: string;
  trainingStartDate: string;
  reviewNotes?: string;
  operationalData?: Record<string, string>;
  history: Array<{ at: string; actor: string; action: string; notes?: string }>;
};


export type AttendanceSummary = {
  planned: number;
  present: number;
  absent: number;
  absRate: number;
  late: number;
  earlyLeave: number;
  unjustified: number;
  justified?: number;
  classifiedUnjustified?: number;
  coverageRate: number;
  gap: number;
  riskLevel: string;
  byReason: Record<string, number>;
  byShift?: Record<string, { planned: number; present: number; absent: number; gap: number }>;
  bySupervisor?: Record<string, { planned: number; present: number; absent: number; unjustified: number; justified: number; classifiedUnjustified?: number; absRate: number }>;
  byLob?: Record<string, { planned: number; present: number; absent: number; unjustified: number; justified: number; classifiedUnjustified?: number; absRate: number }>;
  topAbsenceAgents?: Array<{ employeeId: string; name: string; wbLogin: string; supervisor: string; lob: string; planned: number; absent: number; unjustified: number; justified: number; classifiedUnjustified?: number; absRate: number }>;
  recurringAbsences?: RecurringAbsenceItem[];
  activePeopleByLobAndShift?: Array<{ lob: string; shifts: Record<string, number>; total: number }>;
  attrition?: {
    total: { lob: string; terminations: number; hcStart: number; hcEnd: number; hcAverage: number; attritionRate: number };
    byLob: Array<{ lob: string; terminations: number; hcStart: number; hcEnd: number; hcAverage: number; attritionRate: number }>;
  };
  mood?: {
    average: number;
    responses: number;
    interpretation: string;
    distribution: Record<string, number>;
    byLob: Array<{ label: string; responses: number; average: number; interpretation: string }>;
    bySupervisor: Array<{ label: string; responses: number; average: number; interpretation: string }>;
    byRoleTitle: Array<{ label: string; responses: number; average: number; interpretation: string }>;
  };
};


export type RecurringAbsenceItem = {
  employeeId: string;
  name: string;
  wbLogin: string;
  lob: string;
  supervisor: string;
  roleTitle: string;
  skill: string;
  consecutiveDays: number;
  riskLevel: "Atenção" | "Alto risco" | "Crítico";
  lastDateIso?: string;
  lastDate: string;
  lastStatus: string;
  sequence: Array<{ date: string; status: string; reason: string; classification: string }>;
};


export type AttendanceItem = {
  id: string;
  attendanceRecordId?: string;
  employeeId: string;
  employeeName: string;
  wbLogin?: string;
  date: string;
  dateIso?: string;
  scheduleId?: string;
  shift: string;
  lob?: string;
  supervisor?: string;
  roleTitle?: string;
  status: string;
  absenceReason?: string;
  reasonClassification?: string;
  reasonCategory?: string;
  supervisorJustification?: string;
  isJustified?: boolean;
  impactsAbs: boolean;
  impactsCoverage: boolean;
  registeredBy: string;
  registeredAt: string;
  justifiedBy?: string;
  justifiedAt?: string;
  updatedAt?: string;
};


export type SystemSettings = {
  users?: Array<{ id: string; name: string; email: string; status: string; roleName: string; roleLabel?: string; employeeId?: string; employeeName?: string }>;
  lobs: Array<{ id: string; name: string; label?: string; description?: string; status: "ACTIVE" | "INACTIVE"; active?: boolean; system?: boolean; isSystem?: boolean }>;
  shifts: Array<{ id: string; name: string; startsAt: string; endsAt: string; color?: string; status: "ACTIVE" | "INACTIVE" }>;
  roles: Array<{ id: string; name: string; label: string; description?: string; status?: "ACTIVE" | "INACTIVE"; essential?: boolean; permissions?: string[] }>;
  permissions?: Array<{ id: string; key: string; label: string; description?: string; status: "ACTIVE" | "INACTIVE" }>;
  requestTypes: Array<{ id: string; name: string; area: string; slaHours: number; requiresApproval: boolean; status?: "ACTIVE" | "INACTIVE"; essential?: boolean }>;
  skills: Array<{ id: string; name: string; description?: string; color: string; status: "ACTIVE" | "INACTIVE" }>;
  teams?: Array<{ id: string; name: string; lobId: string; lob: string; supervisorId?: string; supervisorName?: string; supervisorEmail?: string; status: "ACTIVE" | "INACTIVE" }>;
  supervisors?: Array<{ id: string; name: string; email?: string; lobId?: string; lob?: string; teamId?: string; team?: string; supervisees?: number; status?: string }>;
  employees?: Array<{ id: string; name: string; email?: string; wb?: string; roleTitle?: string; roleName?: string; lobId?: string; lob?: string; teamId?: string; team?: string; supervisorId?: string; supervisorName?: string; shiftId?: string; shift?: string; status?: string }>;
  roleTitles: Array<{ name: string; status: "ACTIVE" | "INACTIVE" }>;
  defaultMonth: string;
  slaRules?: Array<Record<string, unknown> & { id: string; name: string; status: "ACTIVE" | "INACTIVE" }>;
  approvalRules?: Array<Record<string, unknown> & { id: string; name: string; status: "ACTIVE" | "INACTIVE" }>;
  coverageRules?: Array<Record<string, unknown> & { id: string; name: string; status: "ACTIVE" | "INACTIVE" }>;
  tokenRules?: Array<Record<string, unknown> & { id: string; name: string; status: "ACTIVE" | "INACTIVE" }>;
  generalSettings?: Record<string, unknown>;
};


export type EmployeeClient = (typeof employees)[number] & {
  email?: string;
  userId?: string;
  userStatus?: string;
  userStatusRaw?: string;
  systemRole?: string;
  socialName?: string;
  team?: string;
  teamId?: string;
  supervisorId?: string;
  directReports?: number;
  totalReports?: number;
  skill?: string;
  skills?: Array<{ id: string; name: string; color: string; isPrimary: boolean; status?: "ACTIVE" | "INACTIVE" }>;
  wave?: string;
  lobId?: string;
  shiftId?: string;
  admissionIso?: string;
  seniority?: string;
  terminationDate?: string;
  terminationDateIso?: string;
  terminationType?: string;
  terminationReason?: string;
  trainingStartDate?: string;
  trainingStartDateIso?: string;
  nestingStartDate?: string;
  nestingStartDateIso?: string;
  goLiveDate?: string;
  goLiveDateIso?: string;
  workStartTime?: string;
  workEndTime?: string;
  contractType?: string;
  ethnicity?: string;
  sexualOrientation?: string;
  isPcd?: string;
  pcdDisabilityType?: string;
  pcdDisabilityOther?: string;
  firstJob?: string;
  hasTelemarketingExperience?: string;
  telemarketingWhere?: string;
  siteOperation?: string;
  internalNotes?: string;
  primaryPhone?: string;
  city?: string;
  stateUf?: string;
  preferredSchedule?: string;
  pixKeyType?: string;
  pixKey?: string;
  isAgent?: boolean;
  canViewSensitive?: boolean;
  canEditEmployeeData?: boolean;
  canEditPeopleData?: boolean;
  canEditOperationalData?: boolean;
  canEditHierarchyData?: boolean;
  restrictedSections?: Record<string, boolean>;
  sensitive?: {
    cpf: string;
    rg: string;
    rgIssuer: string;
    cnpj: string;
    birthDate: string;
    address: string;
    bankData: string;
    pixKeyType?: string;
    pixKey?: string;
    emergencyContactData: string;
    familyData: string;
  };
  maskedSensitive?: {
    cpf: string;
    rg: string;
    bankData: string;
    pixKeyType?: string;
    pixKey?: string;
    emergencyContactData: string;
  };
  attendanceHistory?: AttendanceItem[];
  lastPresence?: string;
};


export type AdditionalRegistrationDataForm = {
  ethnicity: string;
  sexualOrientation: string;
  isPcd: string;
  pcdDisabilityType: string;
  pcdDisabilityOther: string;
  firstJob: string;
  hasTelemarketingExperience: string;
  telemarketingWhere: string;
  pixKeyType: string;
  pixKey: string;
};


export type AdditionalRegistrationDataResponse = {
  data: {
    completed: boolean;
    pending: boolean;
    href: string;
    profile: AdditionalRegistrationDataForm & {
      id: string;
      name: string;
      wbLogin: string;
      additionalDataCompletedAt?: string;
      additionalDataUpdatedAt?: string;
    };
  };
  message?: string;
};


export type EmployeeListResponse = {
  data: EmployeeClient[];
  total?: number;
  page?: number;
  limit?: number;
  totalPages?: number;
  filterOptions?: { skills: string[]; waves: string[]; roleTitles?: string[]; statuses?: string[] };
  contractSummary?: { clt: number; pj: number };
  batchWb?: { applied: string[]; notFound: string[]; duplicatesRemoved: number };
};


export class ApiRequestError extends Error {
  fields?: Record<string, string>;
  type?: string;
  status?: number;
  payload?: unknown;

  constructor(message: string, options?: { fields?: Record<string, string>; type?: string; status?: number; payload?: unknown }) {
    super(message);
    this.name = "ApiRequestError";
    this.fields = options?.fields;
    this.type = options?.type;
    this.status = options?.status;
    this.payload = options?.payload;
  }
}


export const apiResponseCache = new Map<string, { expiresAt: number; payload: unknown }>();

export const cachedGetTtls: Array<{ pattern: RegExp; ttlMs: number }> = [
  { pattern: /^\/api\/settings(?:\?|$)/, ttlMs: 60_000 }
];

export const IMPORT_PREVIEW_ROW_LIMIT = 200;

export const IMPORT_PREVIEW_ISSUE_LIMIT = 50;


export async function apiJson<T>(url: string, options?: RequestInit) {
  const method = String(options?.method ?? "GET").toUpperCase();
  const cacheRule = method === "GET" ? cachedGetTtls.find((rule) => rule.pattern.test(url)) : undefined;
  if (cacheRule) {
    const cached = apiResponseCache.get(url);
    if (cached && cached.expiresAt > Date.now()) return cached.payload as T;
  }

  const response = await fetch(url, {
    ...options,
    headers: options?.body instanceof FormData ? options.headers : { "Content-Type": "application/json", ...(options?.headers ?? {}) }
  });
  const rawPayload = await response.text();
  let payload: T & { error?: string; message?: string; fields?: Record<string, string>; fieldErrors?: Record<string, string>; type?: string };
  try {
    payload = rawPayload ? JSON.parse(rawPayload) : { message: response.ok ? "Resposta vazia do servidor." : `Erro HTTP ${response.status}.` } as T & { message?: string };
  } catch {
    const plainText = rawPayload
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 300);
    payload = {
      message: response.ok
        ? "Resposta vazia ou inválida do servidor."
        : `Erro HTTP ${response.status}. ${plainText || "O servidor não retornou detalhes em JSON."}`
    } as T & { message?: string };
  }
  if (!response.ok) {
    throw new ApiRequestError(payload.error ?? payload.message ?? "Erro ao processar solicitação", {
      fields: payload.fieldErrors ?? payload.fields,
      type: payload.type,
      status: response.status,
      payload
    });
  }
  if (method !== "GET") {
    for (const key of apiResponseCache.keys()) {
      if (key.startsWith("/api/settings")) apiResponseCache.delete(key);
    }
  }
  if (cacheRule) {
    apiResponseCache.set(url, { expiresAt: Date.now() + cacheRule.ttlMs, payload });
  }
  return payload;
}


export function fileNameFromDisposition(disposition: string | null, fallback: string) {
  if (!disposition) return fallback;
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) return decodeURIComponent(utf8Match[1].replace(/"/g, ""));
  const plainMatch = disposition.match(/filename="?([^";]+)"?/i);
  return plainMatch?.[1] ?? fallback;
}


export async function downloadFile(url: string, fallbackFileName: string, fallbackErrorMessage = "Não foi possível baixar o arquivo. Tente novamente.") {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string; message?: string } | null;
    throw new Error(payload?.message ?? payload?.error ?? fallbackErrorMessage);
  }
  const blob = await response.blob();
  if (!blob.size) throw new Error(fallbackErrorMessage);
  const fileName = fileNameFromDisposition(response.headers.get("Content-Disposition"), fallbackFileName);
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}


export function ImportIssueSummary({
  rows,
  title = "Principais erros encontrados",
  max = IMPORT_PREVIEW_ISSUE_LIMIT
}: {
  rows: Array<{ rowNumber: number; errors: string[]; warnings?: string[] }>;
  title?: string;
  max?: number;
}) {
  const allIssues: Array<{ rowNumber: number; message: string; tone: "red" | "amber" }> = [
    ...rows.flatMap((row) => row.errors.map((message) => ({ rowNumber: row.rowNumber, message, tone: "red" as const }))),
    ...rows.flatMap((row) => (row.warnings ?? []).map((message) => ({ rowNumber: row.rowNumber, message, tone: "amber" as const })))
  ];
  const issues = allIssues.slice(0, max);
  if (!issues.length) return null;
  return (
    <div className="rounded-lg border border-red-100 bg-red-50 p-3 text-xs font-semibold text-red-700">
      <p className="mb-2 text-sm font-extrabold">{title}</p>
      <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
        {issues.map((issue, index) => (
          <p key={`${issue.rowNumber}-${index}`} className={issue.tone === "red" ? "text-red-700" : "text-amber-700"}>
            Linha {issue.rowNumber}: {issue.message}
          </p>
        ))}
      </div>
      {allIssues.length > issues.length ? (
        <p className="mt-2 text-muted">Mostrando {issues.length} de {allIssues.length} erros/alertas. Revise o arquivo completo ou baixe o relatório quando disponível.</p>
      ) : null}
    </div>
  );
}


export function timesForShift(shift: string) {
  return scheduleShiftTimes[cleanShiftName(shift)] ?? scheduleShiftTimes.Manhã;
}

export const requestedHoursInputErrorMessage = "Horas solicitadas devem ser um número ou formato HH:mm, como 8:30, ou decimal, como 8,5.";


export function parseProductiveHoursInput(value: string) {
  const minutes = parseWorkHoursToMinutes(value);
  return minutes === null ? null : workHoursFromMinutes(minutes);
}


export function formatWorkHourValue(value: unknown, fallback = "-") {
  const formatted = formatWorkHours(value);
  return formatted || fallback;
}


export function formatWorkHourSummaryDifference(hours?: number | null) {
  return formatSignedMinutesToHHMM(Math.round((hours ?? 0) * 60)) || "0:00";
}


export function dateInputFromParts(year: number, month: number, day: number) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}


export function dateInputFromUtc(date: Date) {
  return dateInputFromParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}


export const operationalDatePartsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});


export function operationalTodayParts() {
  const parts = operationalDatePartsFormatter.formatToParts(new Date());
  const numberPart = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: numberPart("year"), month: numberPart("month"), day: numberPart("day") };
}


export function currentOperationalMonth() {
  const today = operationalTodayParts();
  return { month: today.month, year: today.year };
}


export function currentOperationalMonthInput() {
  const today = operationalTodayParts();
  return `${today.year}-${String(today.month).padStart(2, "0")}`;
}


export function currentOperationalDateInput() {
  const today = operationalTodayParts();
  return dateInputFromParts(today.year, today.month, today.day);
}


export function offsetOperationalDateInput(days: number) {
  const today = operationalTodayParts();
  const date = operationalDateFromParts(today.year, today.month, today.day);
  date.setUTCDate(date.getUTCDate() + days);
  return dateInputFromUtc(date);
}


export function operationalDateFromParts(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day, 12));
}


export function parseDateInput(value: string) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return operationalDateFromParts(year, month, day);
}


export function monthRange(month: number, year: number) {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { startDate: dateInputFromParts(year, month, 1), endDate: dateInputFromParts(year, month, lastDay) };
}


export function currentOperationalMonthRange() {
  return getDefaultDateRange();
}


export function currentUrlSearchParams() {
  if (typeof window === "undefined") return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}


export function queryParam(name: string) {
  return currentUrlSearchParams().get(name) ?? "";
}


export function initialDateRangeFromUrl(fallback = currentOperationalMonthRange()) {
  const params = currentUrlSearchParams();
  const startDate = params.get("startDate") ?? "";
  const endDate = params.get("endDate") ?? "";
  return startDate && endDate ? { startDate, endDate } : fallback;
}

export const scheduleMonthFormatter = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "America/Sao_Paulo" });

export const currencyFormatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });


export function formatHourDifference(minutes: number | null | undefined) {
  if (minutes === null || minutes === undefined) return "-";
  return formatSignedMinutesToHHMM(minutes) || "0:00";
}


export function statusFromScheduleCell(value: string) {
  const baseStatus = /^(.+?)\s+(sem justificativa|justificada)$/i.test(value) ? value.replace(/\s+(sem justificativa|justificada)$/i, "") : value;
  if (baseStatus === "Ausente") return "Falta";
  if (baseStatus === "Falta Justificada" || baseStatus === "Falta Injustificada") return "Falta";
  return ["Manhã", "Tarde", "Noite"].includes(cleanShiftName(baseStatus)) ? "Escalado" : baseStatus;
}


export function dayOffKindFromRequest(request: Pick<ClientRequest, "type" | "payload"> | { type: string; payload?: Record<string, unknown> }): DayOffKind | null {
  const raw = String(request.payload?.dayOffKind ?? request.payload?.internalType ?? "");
  if ((dayOffKinds as readonly string[]).includes(raw)) return raw as DayOffKind;
  if (/venda de folga/i.test(request.type)) return "DAY_OFF_SELL";
  if (/solicita(ç|c)[aã]o de (dia de )?folga|dia de folga|folga solicitada|pedido de folga/i.test(request.type)) return "DAY_OFF_REQUEST";
  if (/troca de folga/i.test(request.type)) return "DAY_OFF_SWAP";
  return null;
}


export function normalizedImpactStatus(impact?: CoverageImpactClient | null) {
  if (!impact) return null;
  if (impact.impactStatus) return impact.impactStatus;
  if (impact.hasCriticalWarning) return "IMPACTA";
  if (impact.impacts.some((row) => row.result === "NO_REQUIREMENT" || row.result === "NO_SCHEDULE")) return "SEM_REQUERIDO";
  return "NAO_IMPACTA";
}


export function normalizedRowImpactStatus(row: CoverageImpactClient["impacts"][number]) {
  if (row.impactStatus) return row.impactStatus;
  if (row.required === null || row.projectedGap === null || row.result === "NO_REQUIREMENT" || row.result === "NO_SCHEDULE") return "SEM_REQUERIDO";
  return row.projectedGap < 0 ? "IMPACTA" : "NAO_IMPACTA";
}


export function impactStatusLabel(status?: string | null) {
  if (status === "IMPACTA") return "Impacta";
  if (status === "SEM_REQUERIDO") return "Sem necessidade";
  return "Não impacta";
}


export function impactDirectionLabel(direction?: string | null) {
  if (direction === "MELHORA") return "Melhora cobertura";
  if (direction === "PIORA") return "Reduz cobertura";
  return "Neutro";
}


export function coverageImpactToneClass(status?: string | null) {
  if (status === "IMPACTA") return "border-red-200 bg-red-50 text-red-700";
  if (status === "NAO_IMPACTA") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "SEM_REQUERIDO") return "border-slate-200 bg-slate-50 text-slate-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
}


export function CoverageImpactBadge({ impact }: { impact?: CoverageImpactClient | null }) {
  if (!impact) return null;
  const status = normalizedImpactStatus(impact);
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-extrabold", coverageImpactToneClass(status))}>
      {status === "IMPACTA" ? <AlertTriangle className="h-3 w-3" /> : null}
      {impactStatusLabel(status)}
    </span>
  );
}


export function coverageValue(value: number | null | undefined) {
  if (value === null || value === undefined) return "-";
  return value > 0 ? `+${value}` : String(value);
}


export function CoverageImpactBlock({ impact }: { impact?: CoverageImpactClient | null }) {
  if (!impact) return null;
  const status = normalizedImpactStatus(impact);
  return (
    <div className="rounded-lg border border-border bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-extrabold text-navy-950">Impacto</p>
          <p className="text-xs font-semibold text-muted">
            {status === "IMPACTA" ? "Após a alteração, a cobertura prevista ficará abaixo da necessidade." : status === "SEM_REQUERIDO" ? "Não há necessidade cadastrada para ao menos um cenário." : "Cobertura prevista permanece dentro da necessidade."}
          </p>
        </div>
        <CoverageImpactBadge impact={impact} />
      </div>
      <div className="space-y-2">
        {impact.impacts.map((row, index) => (
          <div key={`${row.date}-${row.label}-${index}`} className="rounded-lg border border-white/80 bg-white p-3 text-sm shadow-soft">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="font-extrabold text-navy-950">{row.label}</p>
              <span className={cn("rounded-full border px-2 py-1 text-[11px] font-extrabold", coverageImpactToneClass(normalizedRowImpactStatus(row)))}>
                {impactStatusLabel(normalizedRowImpactStatus(row))}
              </span>
            </div>
            <div className="grid gap-2 md:grid-cols-4">
              <InfoLine label="Data" value={row.date} />
              <InfoLine label="LOB" value={row.lob} />
              <InfoLine label="Turno" value={row.shift} />
              <InfoLine label="Necessidade" value={row.required ?? "Sem necessidade"} />
              <InfoLine label="Programado atual" value={row.currentAvailable} />
              <InfoLine label="Gap atual" value={coverageValue(row.currentGap)} />
              <InfoLine label="Impacto" value={coverageValue(row.impactDelta)} />
              <InfoLine label="Gap previsto" value={coverageValue(row.projectedGap)} />
            </div>
            {row.impactDirection ? <p className="mt-2 text-xs font-semibold text-muted">{impactDirectionLabel(row.impactDirection)}.</p> : null}
            {row.message ? <p className="mt-2 text-xs font-semibold text-muted">{coverageTerminology(row.message)}</p> : null}
          </div>
        ))}
      </div>
    </div>
  );
}


export function coverageImpactFromError(error: unknown): CoverageImpactClient | null {
  if (!(error instanceof ApiRequestError) || error.type !== "COVERAGE_WARNING") return null;
  const payload = error.payload as { coverageImpact?: CoverageImpactClient; details?: { coverageImpact?: CoverageImpactClient } } | undefined;
  return payload?.coverageImpact ?? payload?.details?.coverageImpact ?? null;
}


export function CoverageWarningDialog({ warning, onClose }: { warning: CoverageWarningDialogState | null; onClose: () => void }) {
  const [confirming, setConfirming] = useState(false);
  if (!warning) return null;
  const critical = warning.impact.impacts.find((row) => normalizedRowImpactStatus(row) === "IMPACTA") ?? warning.impact.impacts[0];
  const confirm = async () => {
    if (confirming) return;
    setConfirming(true);
    try {
      await warning.onConfirm();
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-navy-950/45 p-4 backdrop-blur-sm">
      <div className="card w-full max-w-lg p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted">Impacto na Necessidade</p>
            <h2 className="mt-1 text-lg font-extrabold text-navy-950">Aprovação com impacto operacional</h2>
          </div>
          <CoverageImpactBadge impact={warning.impact} />
        </div>
        <p className="mb-4 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
          Após esta alteração, a cobertura prevista ficará abaixo da necessidade.
        </p>
        {critical ? (
          <div className="grid gap-2 rounded-lg border border-border bg-slate-50 p-3 text-sm md:grid-cols-2">
            <InfoLine label="Data" value={critical.date} />
            <InfoLine label="LOB" value={critical.lob} />
            <InfoLine label="Turno" value={critical.shift} />
            <InfoLine label="Necessidade" value={critical.required ?? "Sem necessidade"} />
            <InfoLine label="Programado atual" value={critical.currentAvailable} />
            <InfoLine label="Programado previsto" value={critical.projectedAvailable} />
            <InfoLine label="Gap atual" value={coverageValue(critical.currentGap)} />
            <InfoLine label="Gap previsto" value={coverageValue(critical.projectedGap)} />
          </div>
        ) : null}
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button disabled={confirming} onClick={onClose} className="rounded-lg border border-border bg-white px-4 py-3 text-sm font-bold text-navy-950 disabled:opacity-60">Voltar</button>
          <button disabled={confirming} onClick={confirm} className="rounded-lg bg-red-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-60">
            {confirming ? "Aprovando..." : "Aprovar mesmo assim"}
          </button>
        </div>
      </div>
    </div>
  );
}


export function getRequestIcon(type: string) {
  if (/equipamento|notebook|computador/i.test(type)) return Laptop;
  if (/qualidade/i.test(type)) return ShieldCheck;
  if (/rh|benef/i.test(type)) return HeartPulse;
  if (/suporte|acesso/i.test(type)) return Headphones;
  if (/escala|folga|ponto|turno/i.test(type)) return CalendarCheck;
  return ClipboardList;
}


export type FormInputProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  error?: string;
  disabled?: boolean;
  placeholder?: string;
  helper?: string;
  maxLength?: number;
  inputMode?: InputHTMLAttributes<HTMLInputElement>["inputMode"];
  autoComplete?: string;
};


export function FormInput({ label, value, onChange, type = "text", error, disabled = false, placeholder, helper, maxLength, inputMode, autoComplete }: FormInputProps) {
  function openDatePicker(input: HTMLInputElement) {
    if (type !== "date" || disabled) return;
    const picker = input as HTMLInputElement & { showPicker?: () => void };
    try {
      picker.showPicker?.();
    } catch {
      input.focus();
    }
  }

  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-bold text-muted">{label}</span>
      <input type={type} value={value} disabled={disabled} placeholder={placeholder} maxLength={maxLength} inputMode={inputMode} autoComplete={autoComplete} onClick={(event) => openDatePicker(event.currentTarget)} onChange={(event) => onChange(event.target.value)} className={cn("h-11 w-full rounded-lg border px-3 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500", type === "date" && "cursor-pointer", error ? "border-red-300 bg-red-50/40" : "border-border")} />
      {error ? <span className="mt-1 block text-xs font-bold text-red-600">{error}</span> : null}
      {!error && helper ? <span className="mt-1 block text-xs font-semibold text-muted">{helper}</span> : null}
    </label>
  );
}


export function displaySystemRole(value?: string | null) {
  return value === "COLABORADOR" ? "PARCEIRO" : value || "-";
}


export function FormSelect({ label, value, options, onChange, error, disabled = false, emptyLabel = "Não informado", optionLabel }: { label: string; value: string; options: string[]; onChange: (value: string) => void; error?: string; disabled?: boolean; emptyLabel?: string; optionLabel?: (value: string) => string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-bold text-muted">{label}</span>
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className={cn("h-11 w-full rounded-lg border px-3 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500", error ? "border-red-300 bg-red-50/40" : "border-border")}>
        {options.map((option) => (
          <option key={option} value={option}>{option ? optionLabel?.(option) ?? option : emptyLabel}</option>
        ))}
      </select>
      {error ? <span className="mt-1 block text-xs font-bold text-red-600">{error}</span> : null}
    </label>
  );
}


export function formatPixKeyInputValue(type: string, value: string) {
  if (type === "CPF") return value.replace(/\D/g, "").slice(0, 11);
  if (type === "CNPJ") return value.replace(/\D/g, "").slice(0, 14);
  if (type === "E-mail") return value.replace(/\s/g, "").toLowerCase();
  if (type === "Telefone") {
    const compact = value.trim().replace(/[^\d+]/g, "");
    if (!compact) return "";
    const digits = compact.replace(/\D/g, "").slice(0, 13);
    return compact.startsWith("+") ? `+${digits}` : digits;
  }
  if (type === "Chave aleatória") return value.trim().replace(/\s+/g, "");
  return value;
}


export function getPixInputProps(type: string): Pick<FormInputProps, "placeholder" | "maxLength" | "inputMode" | "type"> {
  if (type === "CPF") return { placeholder: "Somente números, 11 dígitos", maxLength: 11, inputMode: "numeric" };
  if (type === "CNPJ") return { placeholder: "Somente números, 14 dígitos", maxLength: 14, inputMode: "numeric" };
  if (type === "E-mail") return { placeholder: "exemplo@email.com", type: "email", inputMode: "email" };
  if (type === "Telefone") return { placeholder: "+5511930211909", maxLength: 14, inputMode: "tel" };
  if (type === "Chave aleatória") return { placeholder: "Informe sua chave aleatória PIX" };
  return { placeholder: "Selecione o tipo da Chave PIX" };
}


export function shiftTagClass(value: string) {
  const map: Record<string, string> = {
    Manhã: "border border-sky-200 bg-sky-50 text-sky-800",
    Tarde: "border border-amber-200 bg-amber-50 text-amber-800",
    Noite: "border border-indigo-200 bg-indigo-50 text-indigo-800",
    Escalado: "border border-blue-200 bg-blue-50 text-blue-800",
    Presente: "border border-emerald-200 bg-emerald-50 text-emerald-800",
    Falta: "border border-rose-300 bg-rose-100 text-rose-900",
    "Falta Justificada": "border border-teal-200 bg-teal-50 text-teal-800",
    "Falta Injustificada": "border border-red-300 bg-red-100 text-red-900",
    "Falta sem justificativa": "border border-red-300 bg-red-100 text-red-900 shadow-sm shadow-red-100",
    "Atraso sem justificativa": "border border-yellow-300 bg-yellow-100 text-yellow-900 shadow-sm shadow-yellow-100",
    "Saída antecipada sem justificativa": "border border-orange-300 bg-orange-100 text-orange-900 shadow-sm shadow-orange-100",
    "Afastado sem justificativa": "border border-violet-300 bg-violet-100 text-violet-900 shadow-sm shadow-violet-100",
    "Erro de cronograma sem justificativa": "border border-red-300 bg-red-100 text-red-900 shadow-sm shadow-red-100",
    "Falta justificada": "border border-teal-200 bg-teal-50 text-teal-800",
    "Atraso justificada": "border border-yellow-200 bg-yellow-50 text-yellow-800",
    "Saída antecipada justificada": "border border-orange-200 bg-orange-50 text-orange-800",
    "Afastado justificada": "border border-violet-200 bg-violet-50 text-violet-800",
    "Erro de cronograma justificada": "border border-amber-200 bg-amber-50 text-amber-800",
    Atraso: "border border-yellow-200 bg-yellow-50 text-yellow-800",
    "Saída antecipada": "border border-orange-200 bg-orange-50 text-orange-800",
    Afastado: "border border-violet-200 bg-violet-50 text-violet-800",
    Férias: "border border-cyan-200 bg-cyan-50 text-cyan-800",
    Treinamento: "border border-purple-200 bg-purple-50 text-purple-800",
    Nesting: "border border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800",
    Folga: "border border-slate-200 bg-slate-100 text-slate-700",
    "Troca aprovada": "border border-indigo-200 bg-indigo-50 text-indigo-800",
    "Venda de folga aprovada": "border border-amber-300 bg-amber-100 text-amber-900",
    "Folga aprovada": "border border-lime-200 bg-lime-50 text-lime-800",
    Desligado: "border border-zinc-300 bg-zinc-200 text-zinc-800",
    "Sem cronograma": "border border-slate-200 bg-slate-50 text-slate-400",
    "Erro de cronograma": "border border-red-300 bg-red-50 text-red-800",
    Feriado: "border border-pink-200 bg-pink-50 text-pink-800",
    Conflito: "border border-red-300 bg-red-50 text-red-700",
    Descoberto: "border border-dashed border-red-400 bg-white text-red-700"
  };
  return map[value] ?? "bg-slate-100 text-slate-600";
}


export const requestTypes = ["Troca de Folga", "Venda de Folga", "Solicitação de Dia de Folga", "Troca de Turno", "Alteração de Adiantamento", "Ajuste de cronograma", "Correção de cronograma", "Equipamento", "Acesso", "RH", "Qualidade", "WFM", "Operação", "Suporte geral"];

export const requestPriorities = ["Baixa", "Média", "Alta", "Crítica"];

export const requestStatuses = ["Aberto", "Em análise", "Aprovado", "Recusado", "Concluído", "Cancelado"];

export const operationalMoodOptions = [
  { score: 1, label: "Triste", icon: Frown, tone: "text-red-500", selected: "border-red-300 bg-red-50 text-red-600 shadow-sm shadow-red-100", ring: "ring-red-100" },
  { score: 3, label: "Normal", icon: Meh, tone: "text-amber-500", selected: "border-amber-300 bg-amber-50 text-amber-600 shadow-sm shadow-amber-100", ring: "ring-amber-100" },
  { score: 5, label: "Feliz", icon: Smile, tone: "text-emerald-500", selected: "border-emerald-300 bg-emerald-50 text-emerald-600 shadow-sm shadow-emerald-100", ring: "ring-emerald-100" }
];


export function normalizeMoodScoreForUi(score: number) {
  if (score <= 2) return 1;
  if (score >= 4) return 5;
  return 3;
}


export function moodOptionForScore(score: number) {
  const normalizedScore = normalizeMoodScoreForUi(score);
  return operationalMoodOptions.find((option) => option.score === normalizedScore) ?? operationalMoodOptions[1];
}


export function RequestDetailContent({
  selected,
  actorRole,
  actionReason,
  setActionReason,
  comment,
  setComment,
  actionPending = "",
  onMove,
  onComment
}: {
  selected: ClientRequest | null;
  actorRole: string;
  actionReason: string;
  setActionReason: (value: string) => void;
  comment: string;
  setComment: (value: string) => void;
  actionPending?: string;
  onMove: (id: string, status: string, actionInput?: Record<string, string>) => void;
  onComment: (id: string) => void;
}) {
  const [approvalData, setApprovalData] = useState({
    finalApprovedShift: "Manhã",
    finalApprovedStartTime: "",
    finalApprovedEndTime: ""
  });

  if (!selected) {
    return <EmptyState title="Selecione uma solicitação" description="Clique em uma solicitação para abrir o detalhe." />;
  }

  const payload = selected.payload ?? {};
  const dayOffKind = dayOffKindFromRequest(selected);
  const isProcessed = ["Recusado", "Concluído", "Cancelado"].includes(selected.status);
  const isApproved = selected.status === "Aprovado";
  const canSupervisorStep = selected.status === "Aberto" && Boolean(selected.canSupervisorStep);
  const canWfmFinal = selected.status === "Em análise" && Boolean(selected.canWfmFinal);
  const canReject = canSupervisorStep || canWfmFinal;
  const canConclude = selected.status === "Aprovado" && Boolean(selected.canWfmFinal);
  const canCancel = !isProcessed && !isApproved && actorRole === "COLABORADOR" && selected.status === "Aberto";
  const buttonsDisabled = Boolean(actionPending) || isProcessed;
  const actionInput = dayOffKind === "DAY_OFF_SELL" && canWfmFinal ? approvalData : undefined;
  const stageText: Record<string, string> = {
    Aberto: "Aguardando supervisor",
    "Em análise": "Aguardando WFM",
    Aprovado: "Cronograma atualizado",
    Recusado: "Solicitação recusada",
    Concluído: "Processo encerrado",
    Cancelado: "Processo cancelado"
  };

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-muted">{selected.id}</p>
        <h2 className="mt-1 text-xl font-extrabold text-navy-950">{selected.title || selected.type}</h2>
        <p className="mt-1 text-sm text-muted">Solicitante: {selected.requester} • Área: {selected.area} • Responsável: {selected.assignee ?? "Não atribuído"}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <MetricPill value={selected.priority} label="Prioridade" />
        <MetricPill value={selected.status} label="Status" />
        <MetricPill value={stageText[selected.status] ?? selected.status} label="Etapa atual" />
        {dayOffKind ? <MetricPill value={dayOffKindLabels[dayOffKind]} label="Modalidade" /> : null}
        {payload.scheduleApplicationStatus ? <MetricPill value={String(payload.scheduleApplicationStatus)} label="Aplicação no cronograma" /> : null}
      </div>

      <div className="grid gap-2 rounded-lg border border-border bg-white p-4 text-sm md:grid-cols-2">
        <InfoLine label="WB/Login" value={selected.requesterWbLogin ?? "-"} />
        <InfoLine label="LOB" value={selected.lob ?? "-"} />
        <InfoLine label="Supervisor" value={selected.supervisor ?? "-"} />
        <InfoLine label="Próxima etapa" value={selected.nextStep ?? stageText[selected.status] ?? selected.status} />
        <InfoLine label="Responsável pela próxima etapa" value={selected.nextOwner ?? "-"} />
      </div>

      <div className="rounded-lg border border-border bg-slate-50 p-4 text-sm text-muted">
        <p className="mb-2 font-bold text-navy-950">Descrição</p>
        <p>{selected.description}</p>
        {payload.justification ? (
          <p className="mt-3"><strong>Justificativa:</strong> {String(payload.justification)}</p>
        ) : null}
        {payload.attachmentUrl ? (
          <p className="mt-3"><strong>Anexo:</strong> <a href={String(payload.attachmentUrl)} className="font-bold text-blue-700" target="_blank">Abrir arquivo</a></p>
        ) : null}
        {dayOffKind === "DAY_OFF_SWAP" ? (
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <InfoLine label="Folga atual" value={String(payload.currentDayOffDate ?? payload.dataAtual ?? "-")} />
            <InfoLine label="Nova data desejada" value={String(payload.desiredDayOffDate ?? payload.dataDesejada ?? "-")} />
          </div>
        ) : dayOffKind === "DAY_OFF_SELL" ? (
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <InfoLine label="Folga a vender" value={String(payload.dayOffToSellDate ?? "-")} />
            <InfoLine label="Disponibilidade/turno" value={String(payload.availabilityShift ?? "-")} />
            <InfoLine label="Entrada preferencial" value={String(payload.preferredStartTime ?? "-")} />
            <InfoLine label="Saída preferencial" value={String(payload.preferredEndTime ?? "-")} />
          </div>
        ) : dayOffKind === "DAY_OFF_REQUEST" ? (
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <InfoLine label="Data desejada" value={String(payload.desiredDayOffRequestDate ?? payload.desiredDayOffDate ?? payload.requestedDate ?? "-")} />
            <InfoLine label="Motivo" value={String(payload.dayOffReason ?? "-")} />
            <InfoLine label="Urgência" value={String(payload.urgency ?? selected.priority)} />
            <InfoLine label="Anexo" value={payload.attachmentUrl ? <a href={String(payload.attachmentUrl)} className="text-blue-700">Abrir</a> : "-"} />
          </div>
        ) : /turno/i.test(selected.type) ? (
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <InfoLine label="Tipo de troca" value={String(payload.shiftChangeType ?? "Temporária")} />
            <InfoLine label="Data inicial" value={String(payload.shiftChangeStartDate ?? payload.shiftChangeDate ?? payload.requestedDate ?? "-")} />
            {payload.shiftChangeType === "Temporária" || payload.shiftChangeEndDate ? (
              <InfoLine label="Data final" value={String(payload.shiftChangeEndDate ?? "-")} />
            ) : null}
            <InfoLine label="Turno atual" value={String(payload.currentShift ?? "-")} />
            <InfoLine label="Novo turno solicitado" value={String(payload.desiredShift ?? "-")} />
            <InfoLine label="Motivo" value={String(payload.shiftChangeReason ?? payload.reason ?? selected.description ?? "-")} />
            <InfoLine label="Observação" value={String(payload.shiftChangeObservation ?? "-")} />
          </div>
        ) : payload.requestedDate ? (
          <p className="mt-3"><strong>Data desejada:</strong> {String(payload.requestedDate)}</p>
        ) : null}
      </div>

      {dayOffKind ? <CoverageImpactBlock impact={selected.coverageImpact} /> : null}

      {dayOffKind === "DAY_OFF_SELL" && canWfmFinal && !isApproved && !isProcessed ? (
        <div className="rounded-lg border border-blue-100 bg-blue-50 p-4">
          <p className="mb-3 text-sm font-bold text-navy-950">Definição final do aprovador</p>
          <div className="grid gap-3 md:grid-cols-3">
            <FormSelect label="Turno final" value={approvalData.finalApprovedShift} options={Array.from(standardShiftNames)} onChange={(value) => {
              const times = timesForShift(value);
              setApprovalData({ finalApprovedShift: value, finalApprovedStartTime: times.startsAt, finalApprovedEndTime: times.endsAt });
            }} />
            <FormInput label="Entrada final" value={approvalData.finalApprovedStartTime} onChange={(value) => setApprovalData({ ...approvalData, finalApprovedStartTime: value })} />
            <FormInput label="Saída final" value={approvalData.finalApprovedEndTime} onChange={(value) => setApprovalData({ ...approvalData, finalApprovedEndTime: value })} />
          </div>
        </div>
      ) : null}

      <div className="rounded-lg border border-border bg-white p-4 text-sm text-muted">
        <p className="mb-2 font-bold text-navy-950">Histórico</p>
        {(selected.history ?? []).length ? (
          (selected.history ?? []).map((item) => (
            <p key={`${item.at}-${item.action}-${item.reason ?? ""}`} className="mb-2 last:mb-0">
              {item.at} • {item.actor}: {item.action}{item.reason ? ` (${item.reason})` : ""}
            </p>
          ))
        ) : (
          <p>Sem histórico registrado.</p>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-bold text-navy-950">Comentários</p>
        {(selected.comments ?? []).map((item) => (
          <div key={`${item.at}-${item.author}-${item.body}`} className="rounded-lg border border-border p-3 text-sm text-muted">
            <p className="font-bold text-navy-950">{item.author} <span className="font-normal text-muted">• {item.at}</span></p>
            <p className="mt-1">{item.body}</p>
          </div>
        ))}
        <div className="flex gap-2">
          <input value={comment} onChange={(event) => setComment(event.target.value)} className="h-11 flex-1 rounded-lg border border-border px-3 text-sm outline-none" placeholder="Adicionar comentário" />
          <button onClick={() => onComment(selected.id)} className="rounded-lg bg-blue-600 px-4 text-sm font-bold text-white">Enviar</button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-slate-50 p-3">
        <label className="block">
          <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-muted">Motivo/comentário da ação</span>
          <textarea value={actionReason} onChange={(event) => setActionReason(event.target.value)} className="min-h-20 w-full rounded-lg border border-border p-3 text-sm outline-none" placeholder="Obrigatório para recusar" />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {canSupervisorStep || canWfmFinal ? <button disabled={buttonsDisabled} onClick={() => onMove(selected.id, "Aprovado", actionInput)} className="rounded-lg bg-emerald-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-60">{actionPending.endsWith(":Aprovado") ? "Aprovando..." : canWfmFinal ? "Aprovar final" : "Aprovar etapa"}</button> : null}
        {canReject ? <button disabled={buttonsDisabled} onClick={() => onMove(selected.id, "Recusado")} className="rounded-lg bg-red-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-60">{actionPending.endsWith(":Recusado") ? "Recusando..." : "Recusar"}</button> : null}
        {canConclude ? <button disabled={Boolean(actionPending)} onClick={() => onMove(selected.id, "Concluído")} className="rounded-lg border border-border bg-white px-4 py-3 text-sm font-bold disabled:opacity-60">{actionPending.endsWith(":Concluído") ? "Concluindo..." : "Concluir"}</button> : null}
        {canCancel ? <button disabled={buttonsDisabled} onClick={() => onMove(selected.id, "Cancelado")} className="rounded-lg border border-border bg-white px-4 py-3 text-sm font-bold disabled:opacity-60">{actionPending.endsWith(":Cancelado") ? "Cancelando..." : "Cancelar"}</button> : null}
      </div>
    </div>
  );
}


export function InfoLine({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-white p-3">
      <p className="text-xs font-bold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 font-bold text-navy-950">{value}</p>
    </div>
  );
}


export function normalizePerformanceSheetName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}


export function coverageTerminology(value: string) {
  return value
    .replace(/Requerido/g, "Necessidade")
    .replace(/requerido/g, "necessidade")
    .replace(/Disponível/g, "Programado")
    .replace(/disponível/g, "programado");
}
