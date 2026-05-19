"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import * as XLSX from "xlsx";
import {
  AlertTriangle,
  Award,
  CalendarCheck,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock,
  ClipboardList,
  Coins,
  Copy,
  Download,
  FileJson,
  FileSpreadsheet,
  FileText,
  Headphones,
  HeartPulse,
  KanbanSquare,
  Laptop,
  LockKeyhole,
  Megaphone,
  MessageCircle,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Star,
  Target,
  Trophy,
  UserPlus,
  Upload,
  UserCheck,
  Users,
  UsersRound,
  Wrench,
  XCircle
} from "lucide-react";

import { TopActions } from "@/components/layout/app-shell";
import {
  DonutLegend,
  EmptyState,
  MetricPill,
  MiniAlertList,
  PageHeader,
  Panel,
  PriorityBadge,
  ProgressLine,
  SimpleTable,
  StatCard,
  StatusBadge
} from "@/components/ui/primitives";
import {
  announcements,
  auditLogs,
  chatMessages,
  climateThemes,
  communicationCategories,
  coverageByShift,
  coverageMatrix,
  employees,
  notificationItems,
  performanceEvolution,
  pinnedAnnouncements,
  qualityFeedback,
  reportCards,
  rewards,
  scheduleDays,
  scheduleGridRows,
  scheduleRequests,
  settingsSections,
  teamRanking,
  tokenHistory,
  topPerformers
} from "@/lib/demo-data";
import { cn, formatCurrency, initials } from "@/lib/utils";
import { cleanShiftName, cleanShiftOptions, isBlockedShiftName, isSelectableShiftName, standardShiftNames } from "@/lib/shift-display";

const scheduleImportColumns = ["wb_login", "data", "status", "turno", "entrada", "saida", "lob"] as const;
const workHourImportColumns = ["wb_login", "data", "entrada_real", "saida_real", "pausa_minutos", "horas_realizadas", "sistema_origem", "observacao", "nome", "email", "lob", "supervisor_wb_login", "turno"] as const;
const scheduleStatusOptions = ["Escalado", "Presente", "Nesting", "Ausente", "Falta", "Atraso", "Saída antecipada", "Afastado", "Férias", "Treinamento", "Folga", "Troca aprovada", "Venda de folga aprovada", "Folga aprovada", "Sem cronograma", "Erro de cronograma"] as const;
const attendanceReasonStatuses = ["Ausente", "Falta", "Atraso", "Saída antecipada", "Afastado", "Erro de cronograma"];
const scheduleTimeRequiredStatuses = ["Escalado", "Presente", "Nesting", "Venda de folga aprovada"];
const employeeOperationalStatusOptions = ["Ativo", "Nesting", "Inativo", "Pendente de cadastro", "Afastado", "Desligado", "Em treinamento", "Suspenso", "Online", "Em Atendimento", "Offline"];
const absenceReasonOptions = ["Falta injustificada", "Atestado", "Problema de saúde", "Emergência familiar", "Problema técnico", "Falta de equipamento", "Problema de internet", "Atraso", "Saída antecipada", "Erro de cronograma", "Afastamento", "Outros"];
const timeBlockCategoryOptions = ["Administrativo", "Desenvolvimento", "Acompanhamento de operação", "Feedback", "Reunião", "Treinamento", "Suporte ao time", "Análise de indicadores", "Escalonamento / Ocorrência", "Pausa", "Outros"];
const scheduleShiftTimes: Record<string, { startsAt: string; endsAt: string }> = {
  Manhã: { startsAt: "08:00", endsAt: "14:00" },
  Tarde: { startsAt: "14:00", endsAt: "20:00" },
  Noite: { startsAt: "20:00", endsAt: "02:00" },
  Folga: { startsAt: "", endsAt: "" }
};
const dayOffKinds = ["DAY_OFF_SWAP", "DAY_OFF_SELL", "DAY_OFF_REQUEST"] as const;
type DayOffKind = (typeof dayOffKinds)[number];
const dayOffKindLabels: Record<DayOffKind, string> = {
  DAY_OFF_SWAP: "Troca de Folga",
  DAY_OFF_SELL: "Venda de Folga",
  DAY_OFF_REQUEST: "Solicitação de Dia de Folga"
};
const dayOffOptions: Array<{ kind: DayOffKind; title: string; description: string }> = [
  { kind: "DAY_OFF_SWAP", title: "Trocar folga", description: "Mover uma folga para outra data já programada." },
  { kind: "DAY_OFF_SELL", title: "Vender folga", description: "Trabalhar em um dia que hoje está como folga." },
  { kind: "DAY_OFF_REQUEST", title: "Solicitar dia de folga", description: "Pedir folga em uma data em que você está programado." }
];

type ClientRequest = {
  id: string;
  type: string;
  title?: string;
  requester: string;
  requesterEmail?: string;
  priority: string;
  status: string;
  area: string;
  assignee?: string;
  time: string;
  description?: string;
  payload?: Record<string, unknown>;
  history?: Array<{ at: string; actor: string; action: string; reason?: string }>;
  comments?: Array<{ at: string; author: string; body: string }>;
  createdAt?: string;
  updatedAt?: string;
};

type AnnouncementItem = {
  id: string;
  title: string;
  category: string;
  body: string;
  date: string;
  area: string;
  status: string;
  read?: boolean;
};

type QualityFeedbackItem = {
  id?: string;
  employee: string;
  type: string;
  theme: string;
  quality: string;
  status: string;
  message: string;
  createdAt?: string;
};

type EquipmentItem = {
  id?: string;
  code: string;
  serial?: string;
  type: string;
  model?: string;
  employeeId?: string;
  employee: string;
  employeeWbLogin?: string;
  employeeEmail?: string;
  status: string;
  delivered: string;
  deliveredAt?: string;
  impact: string;
  observation?: string;
};

type EquipmentSummary = {
  total: number;
  inUse: number;
  available: number;
  maintenance: number;
  returned: number;
  pending: number;
};

type EquipmentImportPreview = {
  success: boolean;
  message?: string;
  summary: {
    totalRows: number;
    validRows: number;
    errorRows: number;
    warningRows: number;
    createdRows: number;
    updatedRows: number;
  };
  rows: Array<{
    rowNumber: number;
    numeroSerie: string;
    type: string;
    model: string;
    status: string;
    responsible: string;
    deliveredAt: string;
    action: string;
    errors: string[];
    warnings: string[];
    normalized?: Record<string, unknown>;
  }>;
};

type RewardItem = {
  id: string;
  name: string;
  cost: number;
  stock: number;
};

type AuditItem = {
  id: string;
  dateTime: string;
  user: string;
  action: string;
  entity: string;
  entityId: string;
  reason: string;
};

type PlatformUsage = {
  activeUsers: number;
  employees: number;
  uploadedFiles: number;
  storageLabel: string;
  requests: number;
  openRequests: number;
  scheduleImports: number;
  shiftReports: number;
  auditLogs: number;
  notifications: number;
  unreadNotifications: number;
  errorLogs: number;
  pendingRegistrations: number;
  alerts: string[];
};

type ErrorLogItem = {
  id: string;
  userEmail?: string;
  code?: string;
  message: string;
  route?: string;
  action?: string;
  severity: string;
  createdAt: string;
};

type ImportPreview = {
  fileName: string;
  totalRows: number;
  validRows: number;
  errorRows: number;
  warningRows?: number;
  createdRows?: number;
  updatedRows?: number;
  foundEmployees?: number;
  missingEmployees?: number;
  rows: Array<Record<string, unknown>>;
  validation: Array<{ rowNumber: number; errors: string[]; warnings: string[]; action?: string; status?: string; employeeName?: string }>;
};

type WorkHourRow = {
  id: string;
  employeeName: string;
  wbLogin: string;
  date: string;
  lob: string;
  supervisor: string;
  shift: string;
  plannedStart: string;
  plannedEnd: string;
  plannedHours: number;
  actualStart: string;
  actualEnd: string;
  breakMinutes: number;
  actualHours: number;
  adjustedStart: string;
  adjustedEnd: string;
  adjustedBreakMinutes: number;
  adjustedHours: number;
  effectiveStart: string;
  effectiveEnd: string;
  effectiveBreakMinutes: number;
  effectiveHours: number;
  differenceMinutes: number;
  status: string;
  rawStatus?: string;
  adjustmentId?: string;
  adjustmentStatus: string;
  source: string;
  observation: string;
};

type ScheduleWorkHourCell = Pick<WorkHourRow, "id" | "plannedStart" | "plannedEnd" | "plannedHours" | "actualStart" | "actualEnd" | "breakMinutes" | "actualHours" | "effectiveStart" | "effectiveEnd" | "effectiveBreakMinutes" | "effectiveHours" | "differenceMinutes" | "status" | "rawStatus" | "source" | "observation" | "adjustmentId" | "adjustmentStatus"> & {
  updatedAt?: string;
};

type SchedulePlannedCell = {
  scheduleId: string;
  startsAt: string;
  endsAt: string;
  observation?: string;
};

type WorkHourSummary = {
  plannedHours: number;
  actualHours: number;
  differenceHours: number;
  okRecords: number;
  divergentRecords: number;
  noScheduleRecords: number;
  pendingAdjustments: number;
  approvedAdjustments: number;
  rejectedAdjustments: number;
  adjustedHours: number;
  breakMinutes: number;
};

type WorkHourPreview = {
  totalRows: number;
  validRows: number;
  errorRows: number;
  rows: Array<Record<string, unknown>>;
  warningRows: number;
  createdRows: number;
  updatedRows: number;
  foundEmployees: number;
  missingEmployees: number;
  scheduleFoundRows: number;
  noScheduleRows: number;
  validation: Array<{ rowNumber: number; wbLogin: string; employeeName: string; date: string; actualStart?: string; actualEnd?: string; actualHours?: number; breakMinutes: number; errors: string[]; warnings: string[]; action: string; status: string }>;
};

type RegistrationItem = {
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
  preferredSchedule: string;
  trainingStartDate: string;
  reviewNotes?: string;
  operationalData?: Record<string, string>;
  history: Array<{ at: string; actor: string; action: string; notes?: string }>;
};

type RegistrationSummary = {
  pending: number;
  active: number;
  adjust: number;
  refused: number;
};

type EmployeeImportPreview = {
  totalRows: number;
  validRows: number;
  errorRows: number;
  warningRows?: number;
  usuariosCriar?: number;
  colaboradoresCriar?: number;
  registrosAtualizar?: number;
  duplicidades?: number;
  rows: Array<{
    rowNumber: number;
    errors: string[];
    warnings: string[];
    action?: string;
    status?: string;
    preview: {
      name: string;
      email: string;
      cpf: string;
      wbLogin: string;
      role: string;
      lob: string;
      createUser: boolean;
      passwordProvided: boolean;
    };
  }>;
};

type AttendanceSummary = {
  planned: number;
  present: number;
  absent: number;
  absRate: number;
  late: number;
  earlyLeave: number;
  unjustified: number;
  coverageRate: number;
  gap: number;
  riskLevel: string;
  byReason: Record<string, number>;
  byShift?: Record<string, { planned: number; present: number; absent: number; gap: number }>;
};

type AttendanceItem = {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string;
  dateIso?: string;
  shift: string;
  status: string;
  absenceReason?: string;
  reasonCategory?: string;
  supervisorJustification?: string;
  isJustified?: boolean;
  impactsAbs: boolean;
  impactsCoverage: boolean;
  registeredBy: string;
  registeredAt: string;
};

type ScheduleGridRow = (typeof scheduleGridRows)[number] & {
  plannedTimes?: Array<SchedulePlannedCell | null>;
  workHours?: Array<ScheduleWorkHourCell | null>;
};

type ScheduleRangeMode = "day" | "week" | "month" | "custom";

type ScheduleImportHistory = {
  id: string;
  fileName: string;
  importedRows: number;
  totalRows?: number;
  errorRows?: number;
  warningRows?: number;
  status: string;
  createdAt: string;
  user: string;
};

type ScheduleAlertItem = {
  title: string;
  status: string;
  tone: "red" | "orange" | "blue" | "green";
  detail: string;
};

type SystemSettings = {
  users?: Array<{ id: string; name: string; email: string; status: string; roleName: string; roleLabel?: string; employeeId?: string; employeeName?: string }>;
  lobs: Array<{ id: string; name: string; label?: string; description?: string; status: "ACTIVE" | "INACTIVE"; active?: boolean; system?: boolean; isSystem?: boolean }>;
  shifts: Array<{ id: string; name: string; startsAt: string; endsAt: string; color?: string; status: "ACTIVE" | "INACTIVE" }>;
  roles: Array<{ id: string; name: string; label: string; description?: string; status?: "ACTIVE" | "INACTIVE"; essential?: boolean; permissions?: string[] }>;
  permissions?: Array<{ id: string; key: string; label: string; description?: string; status: "ACTIVE" | "INACTIVE" }>;
  requestTypes: Array<{ id: string; name: string; area: string; slaHours: number; requiresApproval: boolean; status?: "ACTIVE" | "INACTIVE"; essential?: boolean }>;
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

type EmployeeClient = (typeof employees)[number] & {
  email?: string;
  userId?: string;
  userStatus?: string;
  systemRole?: string;
  socialName?: string;
  team?: string;
  teamId?: string;
  supervisorId?: string;
  lobId?: string;
  shiftId?: string;
  admissionIso?: string;
  trainingStartDate?: string;
  trainingStartDateIso?: string;
  contractType?: string;
  siteOperation?: string;
  internalNotes?: string;
  primaryPhone?: string;
  city?: string;
  stateUf?: string;
  preferredSchedule?: string;
  canViewSensitive?: boolean;
  restrictedSections?: Record<string, boolean>;
  sensitive?: {
    cpf: string;
    rg: string;
    rgIssuer: string;
    cnpj: string;
    birthDate: string;
    address: string;
    bankData: string;
    emergencyContactData: string;
    familyData: string;
  };
  maskedSensitive?: {
    cpf: string;
    rg: string;
    bankData: string;
    emergencyContactData: string;
  };
  attendanceHistory?: AttendanceItem[];
  lastPresence?: string;
};

type EmployeeListResponse = {
  data: EmployeeClient[];
  total?: number;
  page?: number;
  limit?: number;
  totalPages?: number;
};

type ShiftReportItem = {
  id: string;
  reportDate: string;
  submittedAt: string;
  shift: string;
  lob: string;
  rta: string;
  importance: string;
  plannedHeadcount: number;
  actualHeadcount: number;
  absCount: number;
  backlogStart: number;
  backlogEnd: number;
  latencyStart: string;
  latencyEnd: string;
  occurrences: string;
  pendingTasks: string;
  generalMood: string;
  requiresFollowUp: boolean;
  followUpOwner: string;
  followUpDueDate: string;
  mainRisks: string;
  actionsTaken: string;
  nextShiftAttentionPoints: string;
  additionalComments: string;
  timeBlocks: ShiftReportTimeBlock[];
  timeSummary: Record<string, number>;
  totalTimeMinutes: number;
};

type ShiftReportTimeBlock = {
  id?: string;
  startTime: string;
  endTime: string;
  category: string;
  description: string;
  durationMinutes?: number;
};

type ShiftReportDashboard = {
  total: number;
  byShift: Record<string, number>;
  critical: number;
  absTotal: number;
  pendingFollowUps: number;
  timeByCategory: Record<string, number>;
  totalTimeMinutes: number;
  briefing: {
    title: string;
    generatedAt: string;
    whatHappened: string;
    mainRisks: string[];
    decisionsNeeded: string[];
    abs: string;
    mood: string;
    slaLatency: string;
    actionsTaken: string[];
    recommendations: string[];
  };
  recent: ShiftReportItem[];
};

class ApiRequestError extends Error {
  fields?: Record<string, string>;
  type?: string;
  status?: number;

  constructor(message: string, options?: { fields?: Record<string, string>; type?: string; status?: number }) {
    super(message);
    this.name = "ApiRequestError";
    this.fields = options?.fields;
    this.type = options?.type;
    this.status = options?.status;
  }
}

async function apiJson<T>(url: string, options?: RequestInit) {
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
      status: response.status
    });
  }
  return payload;
}

function fileNameFromDisposition(disposition: string | null, fallback: string) {
  if (!disposition) return fallback;
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) return decodeURIComponent(utf8Match[1].replace(/"/g, ""));
  const plainMatch = disposition.match(/filename="?([^";]+)"?/i);
  return plainMatch?.[1] ?? fallback;
}

async function downloadFile(url: string, fallbackFileName: string) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("Não foi possível baixar o template. Tente novamente.");
  const blob = await response.blob();
  if (!blob.size) throw new Error("Não foi possível baixar o template. Tente novamente.");
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

function statusNeedsReason(status: string) {
  return attendanceReasonStatuses.includes(status);
}

function statusNeedsTime(status: string) {
  return scheduleTimeRequiredStatuses.includes(status);
}

function timesForShift(shift: string) {
  return scheduleShiftTimes[cleanShiftName(shift)] ?? scheduleShiftTimes.Manhã;
}

function employeeOptionLabel(employee: { name: string; wb?: string; email?: string }) {
  if (employee.wb) return `${employee.name} - ${employee.wb}`;
  if (employee.email) return `${employee.name} - ${employee.email}`;
  return employee.name;
}

function minutesBetweenTimes(start: string, end: string) {
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  if ([startHour, startMinute, endHour, endMinute].some((value) => Number.isNaN(value))) return 0;
  let startTotal = startHour * 60 + startMinute;
  let endTotal = endHour * 60 + endMinute;
  if (endTotal < startTotal) endTotal += 24 * 60;
  return endTotal - startTotal;
}

function roundDecimal(value: number) {
  return Math.round(value * 100) / 100;
}

function dateInputFromUtc(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseDateInput(value: string) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

function monthRange(month: number, year: number) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  return { startDate: dateInputFromUtc(start), endDate: dateInputFromUtc(end) };
}

function anchorForSchedulePeriod(period: { month: number; year: number }, currentStartDate?: string) {
  const parsed = parseDateInput(currentStartDate ?? "");
  const day = parsed?.getUTCDate() ?? 1;
  const lastDay = new Date(Date.UTC(period.year, period.month, 0)).getUTCDate();
  return new Date(Date.UTC(period.year, period.month - 1, Math.min(day, lastDay)));
}

function rangeForScheduleMode(mode: ScheduleRangeMode, period: { month: number; year: number }, currentStartDate?: string) {
  const anchor = anchorForSchedulePeriod(period, currentStartDate);
  if (mode === "day") {
    const value = dateInputFromUtc(anchor);
    return { startDate: value, endDate: value };
  }
  if (mode === "week") {
    const weekday = anchor.getUTCDay();
    const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
    const start = new Date(anchor);
    start.setUTCDate(anchor.getUTCDate() + mondayOffset);
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 6);
    return { startDate: dateInputFromUtc(start), endDate: dateInputFromUtc(end) };
  }
  return monthRange(period.month, period.year);
}

function dateInputsBetween(startDate: string, endDate: string) {
  const start = parseDateInput(startDate);
  const end = parseDateInput(endDate);
  if (!start && !end) return [];
  const first = start ?? end!;
  const last = end ?? start!;
  const from = first <= last ? first : last;
  const to = first <= last ? last : first;
  const values: string[] = [];
  const current = new Date(from);
  while (current <= to) {
    values.push(dateInputFromUtc(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return values;
}

function isInvalidDateRange(range: { startDate: string; endDate: string }) {
  const start = parseDateInput(range.startDate);
  const end = parseDateInput(range.endDate);
  return Boolean(start && end && start > end);
}

function formatHourDifference(minutes: number) {
  if (!minutes) return "0min";
  const sign = minutes > 0 ? "+" : "-";
  const absolute = Math.abs(minutes);
  const hours = Math.floor(absolute / 60);
  const remainingMinutes = absolute % 60;
  return hours ? `${sign}${hours}h${String(remainingMinutes).padStart(2, "0")}` : `${sign}${remainingMinutes}min`;
}

function formatBreakDuration(minutes: number) {
  const safeMinutes = Math.max(0, Math.round(minutes || 0));
  const hours = Math.floor(safeMinutes / 60);
  const remainingMinutes = safeMinutes % 60;
  return hours ? `${hours}h${String(remainingMinutes).padStart(2, "0")}` : `${remainingMinutes}min`;
}

function statusFromScheduleCell(value: string) {
  if (/^(.+?)\s+(sem justificativa|justificada)$/i.test(value)) return value.replace(/\s+(sem justificativa|justificada)$/i, "");
  return ["Manhã", "Tarde", "Noite"].includes(cleanShiftName(value)) ? "Escalado" : value;
}

function dayOffKindFromRequest(request: Pick<ClientRequest, "type" | "payload"> | { type: string; payload?: Record<string, unknown> }): DayOffKind | null {
  const raw = String(request.payload?.dayOffKind ?? request.payload?.internalType ?? "");
  if ((dayOffKinds as readonly string[]).includes(raw)) return raw as DayOffKind;
  if (/venda de folga/i.test(request.type)) return "DAY_OFF_SELL";
  if (/dia de folga|folga solicitada/i.test(request.type)) return "DAY_OFF_REQUEST";
  if (/troca de folga/i.test(request.type)) return "DAY_OFF_SWAP";
  return null;
}

function primaryDayOffDate(request: ClientRequest) {
  const payload = request.payload ?? {};
  const kind = dayOffKindFromRequest(request);
  if (kind === "DAY_OFF_SWAP") return String(payload.currentDayOffDate ?? "-");
  if (kind === "DAY_OFF_SELL") return String(payload.dayOffToSellDate ?? "-");
  if (kind === "DAY_OFF_REQUEST") return String(payload.desiredDayOffRequestDate ?? payload.desiredDayOffDate ?? payload.requestedDate ?? "-");
  return String(payload.requestedDate ?? "-");
}

function getRequestIcon(type: string) {
  if (/equipamento|notebook|computador/i.test(type)) return Laptop;
  if (/qualidade/i.test(type)) return ShieldCheck;
  if (/rh|benef/i.test(type)) return HeartPulse;
  if (/suporte|acesso/i.test(type)) return Headphones;
  if (/escala|folga|ponto/i.test(type)) return CalendarCheck;
  return ClipboardList;
}

function getRewardIcon(name: string) {
  if (/day/i.test(name)) return CalendarCheck;
  if (/kit/i.test(name)) return Star;
  if (/curso/i.test(name)) return Trophy;
  return Award;
}

const registrationSteps = ["Dados pessoais", "Endereço e contato", "Documentos", "Dados bancários", "Operacional", "Revisão"];

const registrationFieldLabels: Record<string, string> = {
  cnpj: "CNPJ",
  fullName: "Nome completo",
  addressType: "Tipo de endereço",
  addressName: "Endereço",
  addressNumber: "Número",
  complement: "Complemento",
  neighborhood: "Bairro",
  city: "Cidade",
  stateUf: "UF",
  zipCode: "CEP",
  primaryPhone: "Contato principal",
  emergencyPhone: "Contato de emergência",
  emergencyContactName: "Nome do contato de emergência",
  emergencyContactRelationship: "Parentesco",
  birthDate: "Data de nascimento",
  email: "E-mail",
  password: "Senha",
  confirmPassword: "Confirmar senha",
  rg: "RG",
  rgIssuer: "Órgão expedidor e UF",
  cpf: "CPF",
  sex: "Sexo",
  maritalStatus: "Estado civil",
  educationLevel: "Escolaridade",
  trainingStartDate: "Data de início do treinamento",
  preferredSchedule: "Preferência de horário",
  requestedLob: "LOB",
  bankName: "Banco",
  bankAgency: "Agência",
  bankAccount: "Conta corrente",
  pixKey: "Chave PIX",
  pixKeyType: "Tipo de chave PIX",
  secondaryPixKey: "Chave PIX secundária",
  secondaryPixKeyType: "Tipo da chave PIX secundária",
  hasChildren: "Tem filhos?",
  childrenCount: "Quantidade de filhos",
  notes: "Observações"
};

export function EmployeeRegistrationPublicPage() {
  const [step, setStep] = useState(0);
  const [submitted, setSubmitted] = useState<RegistrationItem | null>(null);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [savingRegistration, setSavingRegistration] = useState(false);
  const [form, setForm] = useState({
    cnpj: "",
    fullName: "",
    addressType: "Rua",
    addressName: "",
    addressNumber: "",
    complement: "",
    neighborhood: "",
    city: "",
    stateUf: "",
    zipCode: "",
    primaryPhone: "",
    emergencyPhone: "",
    emergencyContactName: "",
    emergencyContactRelationship: "",
    birthDate: "",
    email: "",
    password: "",
    confirmPassword: "",
    rg: "",
    rgIssuer: "",
    cpf: "",
    sex: "Não informar",
    maritalStatus: "Solteiro(a)",
    educationLevel: "Ensino médio",
    trainingStartDate: "2026-05-04",
    preferredSchedule: "Manhã",
    requestedLob: "ALL",
    bankName: "",
    bankAgency: "",
    bankAccount: "",
    pixKey: "",
    pixKeyType: "CPF",
    secondaryPixKey: "",
    secondaryPixKeyType: "",
    socialName: "",
    hasChildren: false,
    childrenCount: 0,
    notes: ""
  });

  function updateField(name: string, value: string | boolean | number) {
    setForm((current) => ({ ...current, [name]: value }));
    setFieldErrors((current) => {
      if (!current[name]) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  }

  async function submitRegistration() {
    setError("");
    setFieldErrors({});
    setSavingRegistration(true);
    try {
      const payload = await apiJson<{ data: RegistrationItem }>("/api/employee-registrations/public", {
        method: "POST",
        body: JSON.stringify(form)
      });
      setSubmitted(payload.data);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(err.message);
        setFieldErrors(err.fields ?? {});
      } else {
        setError(err instanceof Error ? err.message : "Não foi possível enviar o cadastro.");
      }
    } finally {
      setSavingRegistration(false);
    }
  }

  const fieldError = (name: string) => fieldErrors[name];
  const fieldErrorEntries = Object.entries(fieldErrors);

  const sections = [
    <div key="personal" className="grid gap-4 md:grid-cols-2">
      <FormInput label="Nome completo" value={form.fullName} error={fieldError("fullName")} onChange={(value) => updateField("fullName", value)} />
      <FormInput label="Nome social (opcional)" value={form.socialName} error={fieldError("socialName")} onChange={(value) => updateField("socialName", value)} />
      <FormInput label="Senha" type="password" value={form.password} error={fieldError("password")} onChange={(value) => updateField("password", value)} />
      <FormInput label="Confirmar senha" type="password" value={form.confirmPassword} error={fieldError("confirmPassword")} onChange={(value) => updateField("confirmPassword", value)} />
      <FormInput label="Data de nascimento" type="date" value={form.birthDate} error={fieldError("birthDate")} onChange={(value) => updateField("birthDate", value)} />
      <FormSelect label="Sexo" value={form.sex} error={fieldError("sex")} options={["Feminino", "Masculino", "Não informar"]} onChange={(value) => updateField("sex", value)} />
      <FormSelect label="Estado civil" value={form.maritalStatus} error={fieldError("maritalStatus")} options={["Solteiro(a)", "Casado(a)", "Divorciado(a)", "União estável"]} onChange={(value) => updateField("maritalStatus", value)} />
      <FormSelect label="Escolaridade" value={form.educationLevel} error={fieldError("educationLevel")} options={["Ensino médio", "Superior cursando", "Superior completo", "Pós-graduação"]} onChange={(value) => updateField("educationLevel", value)} />
      <FormSelect label="Tem filhos?" value={form.hasChildren ? "Sim" : "Não"} error={fieldError("hasChildren")} options={["Não", "Sim"]} onChange={(value) => updateField("hasChildren", value === "Sim")} />
      {form.hasChildren ? <FormInput label="Quantidade de filhos" type="number" value={String(form.childrenCount)} error={fieldError("childrenCount")} onChange={(value) => updateField("childrenCount", Number(value))} /> : null}
    </div>,
    <div key="contact" className="grid gap-4 md:grid-cols-2">
      <FormSelect label="Tipo de endereço" value={form.addressType} error={fieldError("addressType")} options={["Rua", "Avenida", "Alameda"]} onChange={(value) => updateField("addressType", value)} />
      <FormInput label="Endereço" value={form.addressName} error={fieldError("addressName")} onChange={(value) => updateField("addressName", value)} />
      <FormInput label="Número" value={form.addressNumber} error={fieldError("addressNumber")} onChange={(value) => updateField("addressNumber", value)} />
      <FormInput label="Complemento" value={form.complement} error={fieldError("complement")} onChange={(value) => updateField("complement", value)} />
      <FormInput label="Bairro" value={form.neighborhood} error={fieldError("neighborhood")} onChange={(value) => updateField("neighborhood", value)} />
      <FormInput label="Cidade" value={form.city} error={fieldError("city")} onChange={(value) => updateField("city", value)} />
      <FormInput label="UF" value={form.stateUf} error={fieldError("stateUf")} onChange={(value) => updateField("stateUf", value.toUpperCase().slice(0, 2))} />
      <FormInput label="CEP" value={form.zipCode} error={fieldError("zipCode")} onChange={(value) => updateField("zipCode", value)} />
      <FormInput label="Contato principal" value={form.primaryPhone} error={fieldError("primaryPhone")} onChange={(value) => updateField("primaryPhone", value)} />
      <FormInput label="Contato de emergência" value={form.emergencyPhone} error={fieldError("emergencyPhone")} onChange={(value) => updateField("emergencyPhone", value)} />
      <FormInput label="Nome do contato de emergência" value={form.emergencyContactName} error={fieldError("emergencyContactName")} onChange={(value) => updateField("emergencyContactName", value)} />
      <FormInput label="Parentesco" value={form.emergencyContactRelationship} error={fieldError("emergencyContactRelationship")} onChange={(value) => updateField("emergencyContactRelationship", value)} />
    </div>,
    <div key="docs" className="grid gap-4 md:grid-cols-2">
      <FormInput label="E-mail" type="email" value={form.email} error={fieldError("email")} onChange={(value) => updateField("email", value)} />
      <FormInput label="CPF" value={form.cpf} error={fieldError("cpf")} onChange={(value) => updateField("cpf", value)} />
      <FormInput label="RG" value={form.rg} error={fieldError("rg")} onChange={(value) => updateField("rg", value)} />
      <FormInput label="Órgão expedidor e UF" value={form.rgIssuer} error={fieldError("rgIssuer")} onChange={(value) => updateField("rgIssuer", value)} />
      <FormInput label="CNPJ" value={form.cnpj} error={fieldError("cnpj")} onChange={(value) => updateField("cnpj", value)} />
    </div>,
    <div key="bank" className="grid gap-4 md:grid-cols-2">
      <FormInput label="Banco" value={form.bankName} error={fieldError("bankName")} onChange={(value) => updateField("bankName", value)} />
      <FormInput label="Agência com dígito" value={form.bankAgency} error={fieldError("bankAgency")} onChange={(value) => updateField("bankAgency", value)} />
      <FormInput label="Conta corrente com dígito" value={form.bankAccount} error={fieldError("bankAccount")} onChange={(value) => updateField("bankAccount", value)} />
      <FormInput label="Chave PIX" value={form.pixKey} error={fieldError("pixKey")} onChange={(value) => updateField("pixKey", value)} />
      <FormSelect label="Tipo de chave PIX" value={form.pixKeyType} error={fieldError("pixKeyType")} options={["CPF", "CNPJ", "E-mail", "Telefone", "Aleatória"]} onChange={(value) => updateField("pixKeyType", value)} />
      <FormInput label="Chave PIX secundária (opcional)" value={form.secondaryPixKey} error={fieldError("secondaryPixKey")} onChange={(value) => updateField("secondaryPixKey", value)} />
      <FormSelect label="Tipo de chave PIX secundária (opcional)" value={form.secondaryPixKeyType} error={fieldError("secondaryPixKeyType")} options={["", "CPF", "CNPJ", "E-mail", "Telefone", "Aleatória"]} onChange={(value) => updateField("secondaryPixKeyType", value)} />
    </div>,
    <div key="ops" className="grid gap-4 md:grid-cols-2">
      <FormInput label="Data de início do treinamento" type="date" value={form.trainingStartDate} error={fieldError("trainingStartDate")} onChange={(value) => updateField("trainingStartDate", value)} />
      <FormSelect label="Preferência de horário" value={form.preferredSchedule} error={fieldError("preferredSchedule")} options={Array.from(standardShiftNames)} onChange={(value) => updateField("preferredSchedule", value)} />
      <FormSelect label="LOB" value={form.requestedLob} error={fieldError("requestedLob")} options={["ALL", "CEC", "TNS", "ADS"]} onChange={(value) => updateField("requestedLob", value)} />
      <label className="md:col-span-2">
        <span className="mb-1.5 block text-sm font-bold text-muted">Observações adicionais</span>
        <textarea value={form.notes} onChange={(event) => updateField("notes", event.target.value)} className={cn("min-h-28 w-full rounded-lg border p-3 outline-none", fieldError("notes") ? "border-red-300 bg-red-50/40" : "border-border")} />
        {fieldError("notes") ? <span className="mt-1 block text-xs font-bold text-red-600">{fieldError("notes")}</span> : null}
      </label>
    </div>,
    <div key="review" className="grid gap-4 md:grid-cols-2">
      {[
        ["Nome", form.fullName],
        ["E-mail", form.email],
        ["CPF", form.cpf],
        ["CNPJ", form.cnpj],
        ["Cidade/UF", `${form.city}/${form.stateUf}`],
        ["Treinamento", form.trainingStartDate],
        ["Preferência", form.preferredSchedule],
        ["LOB", form.requestedLob],
        ["PIX principal", `${form.pixKeyType}: ${form.pixKey}`]
      ].map(([label, value]) => (
        <InfoLine key={label} label={label} value={value} />
      ))}
    </div>
  ];

  if (submitted) {
    return (
      <main className="min-h-screen bg-surface p-6">
        <div className="mx-auto max-w-4xl">
          <div className="card p-8 text-center">
            <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-600" />
            <h1 className="mt-4 text-3xl font-black text-navy-950">Cadastro enviado</h1>
            <p className="mt-2 text-muted">Protocolo {submitted.id}. O status atual é {submitted.status}; RH/Admin/WFM poderão aprovar, recusar ou solicitar ajuste.</p>
            <a href="/login" className="mt-6 inline-flex rounded-lg bg-blue-600 px-5 py-3 text-sm font-bold text-white">Voltar para login</a>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_84%_12%,rgba(37,99,235,.12),transparent_30rem),#F6F8FC] p-5">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-blue-600 text-white"><UserPlus className="h-6 w-6" /></div>
            <div>
              <h1 className="text-2xl font-black text-navy-950">Cadastro do Colaborador</h1>
              <p className="text-sm text-muted">Solicite seu acesso. O login só será liberado após aprovação.</p>
            </div>
          </div>
          <a href="/login" className="premium-control px-4 py-3 text-sm font-bold text-navy-950">Já tenho acesso</a>
        </div>
        <section className="card overflow-hidden">
          <div className="grid border-b border-border bg-white md:grid-cols-6">
            {registrationSteps.map((item, index) => (
              <button key={item} onClick={() => setStep(index)} className={cn("border-b-2 px-4 py-4 text-left text-sm font-extrabold", index === step ? "border-blue-600 bg-blue-50 text-blue-700" : "border-transparent text-muted")}>
                <span className="mr-2 inline-grid h-6 w-6 place-items-center rounded-full bg-white text-xs shadow-soft">{index + 1}</span>
                {item}
              </button>
            ))}
          </div>
          <div className="p-6">
            <div className="mb-5 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700">
              Dados sensíveis são protegidos por permissão e só aparecem no Mapa de Funcionários para perfis autorizados.
            </div>
            {sections[step]}
            {error ? (
              <div className="mt-5 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-600">
                <p>{error}</p>
                {fieldErrorEntries.length ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5 font-semibold">
                    {fieldErrorEntries.map(([field, message]) => (
                      <li key={field}>{registrationFieldLabels[field] ?? field}: {message}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
            <div className="mt-6 flex justify-between">
              <button type="button" disabled={step === 0 || savingRegistration} onClick={() => setStep(Math.max(0, step - 1))} className="rounded-lg border border-border bg-white px-5 py-3 text-sm font-bold disabled:opacity-50">Voltar</button>
              {step < registrationSteps.length - 1 ? (
                <button type="button" disabled={savingRegistration} onClick={() => setStep(Math.min(registrationSteps.length - 1, step + 1))} className="rounded-lg bg-blue-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-60">Continuar</button>
              ) : (
                <button type="button" disabled={savingRegistration} onClick={submitRegistration} className="rounded-lg bg-blue-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-60">{savingRegistration ? "Enviando..." : "Enviar cadastro para aprovação"}</button>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function FormInput({ label, value, onChange, type = "text", error, disabled = false }: { label: string; value: string; onChange: (value: string) => void; type?: string; error?: string; disabled?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-bold text-muted">{label}</span>
      <input type={type} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className={cn("h-11 w-full rounded-lg border px-3 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500", error ? "border-red-300 bg-red-50/40" : "border-border")} />
      {error ? <span className="mt-1 block text-xs font-bold text-red-600">{error}</span> : null}
    </label>
  );
}

function FormSelect({ label, value, options, onChange, error, disabled = false }: { label: string; value: string; options: string[]; onChange: (value: string) => void; error?: string; disabled?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-bold text-muted">{label}</span>
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className={cn("h-11 w-full rounded-lg border px-3 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500", error ? "border-red-300 bg-red-50/40" : "border-border")}>
        {options.map((option) => (
          <option key={option} value={option}>{option || "Não informado"}</option>
        ))}
      </select>
      {error ? <span className="mt-1 block text-xs font-bold text-red-600">{error}</span> : null}
    </label>
  );
}

export function OperationalCommandCenter() {
  const [attendanceSummary, setAttendanceSummary] = useState<AttendanceSummary | null>(null);
  const [dateRange, setDateRange] = useState({ startDate: "2026-05-01", endDate: "2026-05-31" });
  const [commandLobs, setCommandLobs] = useState<string[]>(["Todos"]);
  const [selectedCommandLob, setSelectedCommandLob] = useState("Todos");
  const [loadingSummary, setLoadingSummary] = useState(false);

  useEffect(() => {
    void loadCommandCenterSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange.startDate, dateRange.endDate, selectedCommandLob]);

  useEffect(() => {
    apiJson<{ data: SystemSettings }>("/api/settings")
      .then((payload) => {
        const activeLobs = payload.data.lobs.filter((lob) => lob.status !== "INACTIVE").map((lob) => lob.name);
        setCommandLobs(["Todos", ...activeLobs]);
      })
      .catch(() => setCommandLobs(["Todos"]));
  }, []);

  async function loadCommandCenterSummary() {
    setLoadingSummary(true);
    try {
      const params = new URLSearchParams({ startDate: dateRange.startDate, endDate: dateRange.endDate });
      if (selectedCommandLob !== "Todos") params.set("lob", selectedCommandLob);
      const payload = await apiJson<{ summary: AttendanceSummary }>(`/api/attendance?${params.toString()}`);
      setAttendanceSummary(payload.summary);
    } catch {
      setAttendanceSummary(null);
    } finally {
      setLoadingSummary(false);
    }
  }

  function setCommandRange(preset: "today" | "week" | "month" | "previousMonth") {
    const today = new Date();
    const base = dateRange.startDate ? new Date(`${dateRange.startDate}T00:00:00.000Z`) : today;
    if (preset === "today") {
      const value = today.toISOString().slice(0, 10);
      setDateRange({ startDate: value, endDate: value });
      return;
    }
    if (preset === "week") {
      const day = base.getUTCDay();
      const start = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() - day));
      const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + 6));
      setDateRange({ startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) });
      return;
    }
    const monthOffset = preset === "previousMonth" ? -1 : 0;
    const start = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + monthOffset, 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
    setDateRange({ startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) });
  }

  const summary = attendanceSummary ?? {
    planned: 0,
    present: 0,
    absent: 0,
    absRate: 0,
    late: 0,
    earlyLeave: 0,
    unjustified: 0,
    coverageRate: 0,
    gap: 0,
    riskLevel: "Sem dados",
    byReason: {},
    byShift: {}
  };
  const stats = [
    { title: "Pessoas Escaladas", value: summary.planned, change: summary.planned ? "100%" : "0%", helper: "base atual", icon: Users, tone: "blue" as const },
    { title: "Presentes", value: summary.present, change: `${summary.coverageRate}%`, helper: "cobertura real", icon: UserCheck, tone: "green" as const },
    { title: "Ausências", value: summary.absent, change: `${summary.absRate}%`, helper: "ABS", icon: XCircle, tone: "orange" as const },
    { title: "Pendências Justificativa", value: summary.unjustified, helper: "sem justificativa", icon: AlertTriangle, tone: summary.unjustified ? "red" as const : "green" as const },
    { title: "Atrasos", value: summary.late, helper: "turno atual", icon: Clock, tone: "gold" as const },
    { title: "Saídas antecipadas", value: summary.earlyLeave, helper: "turno atual", icon: AlertTriangle, tone: "red" as const },
    { title: "Risco de Cobertura", value: summary.riskLevel, change: `${summary.gap}`, helper: "gap real", icon: ShieldCheck, tone: summary.riskLevel === "Crítico" ? "red" as const : "purple" as const }
  ];
  const commandPresenceByShift = Object.entries(summary.byShift ?? {}).map(([shift, values]) => ({
    shift,
    escalados: values.planned,
    presentes: values.present
  }));
  const commandAbsenceReasons = Object.entries(summary.byReason)
    .filter(([, value]) => value > 0)
    .map(([name, value], index) => ({ name, value, fill: ["#071B3A", "#14B8A6", "#F59E0B", "#7C3AED", "#94A3B8"][index % 5] }));
  const commandGapByShift = Object.entries(summary.byShift ?? {}).map(([shift, values]) => ({
    shift,
    gaps: Math.max(0, Math.abs(values.gap))
  }));
  const commandAlerts = [
    ...(summary.unjustified ? [{ title: `${summary.unjustified} ausências sem justificativa`, status: "Atenção", tone: "orange" as const }] : []),
    ...(summary.gap < 0 ? [{ title: `Gap real de ${summary.gap} pessoas`, status: summary.riskLevel, tone: "red" as const }] : []),
    ...(summary.late ? [{ title: `${summary.late} atrasos registrados`, status: "Info", tone: "blue" as const }] : [])
  ];
  const commandRisks = [
    ...(summary.riskLevel === "Crítico" ? [{ title: "Cobertura abaixo do mínimo operacional", status: "Crítico", tone: "red" as const }] : []),
    ...(summary.absent ? [{ title: `${summary.absent} ausências impactando a operação`, status: "ABS", tone: "orange" as const }] : [])
  ];

  return (
    <div>
      <PageHeader
        title="Central Operacional"
        description="Visão geral da operação em tempo real"
        icon={Trophy}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <select
              value={selectedCommandLob}
              onChange={(event) => setSelectedCommandLob(event.target.value)}
              className="premium-control h-11 px-3 text-sm font-extrabold text-navy-950 outline-none"
            >
              {commandLobs.map((lob) => (
                <option key={lob} value={lob}>{lob === "Todos" ? "Todas as LOBs" : lob}</option>
              ))}
            </select>
            <label className="premium-control flex h-11 items-center gap-2 px-3 text-sm font-bold text-navy-900">
              <CalendarDays className="h-4 w-4 text-blue-600" />
              <input
                type="date"
                value={dateRange.startDate}
                onChange={(event) => setDateRange((current) => ({ ...current, startDate: event.target.value }))}
                className="border-0 bg-transparent text-sm font-bold outline-none"
              />
            </label>
            <label className="premium-control flex h-11 items-center gap-2 px-3 text-sm font-bold text-navy-900">
              <span className="text-xs text-muted">até</span>
              <input
                type="date"
                value={dateRange.endDate}
                onChange={(event) => setDateRange((current) => ({ ...current, endDate: event.target.value }))}
                className="border-0 bg-transparent text-sm font-bold outline-none"
              />
            </label>
            <button onClick={() => setCommandRange("today")} className="premium-control h-11 px-3 text-xs font-extrabold text-navy-950">Hoje</button>
            <button onClick={() => setCommandRange("week")} className="premium-control h-11 px-3 text-xs font-extrabold text-navy-950">Semana</button>
            <button onClick={() => setCommandRange("month")} className="premium-control h-11 px-3 text-xs font-extrabold text-navy-950">Mês</button>
            <button onClick={() => setCommandRange("previousMonth")} className="premium-control h-11 px-3 text-xs font-extrabold text-navy-950">Mês anterior</button>
            <button
              onClick={() => void loadCommandCenterSummary()}
              disabled={loadingSummary}
              className="flex h-11 items-center gap-2 rounded-lg bg-navy-950 px-4 text-sm font-extrabold text-white shadow-soft disabled:opacity-60"
            >
              <RefreshCw className={cn("h-4 w-4", loadingSummary && "animate-spin")} />
              Atualizar
            </button>
          </div>
        }
      />
      <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        {stats.map((stat) => (
          <StatCard key={stat.title} {...stat} />
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-[1fr_1fr_1fr]">
        <Panel title="Presença por Turno">
          {commandPresenceByShift.length ? <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={commandPresenceByShift}>
                <CartesianGrid stroke="#E8EDF5" vertical={false} />
                <XAxis dataKey="shift" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip />
                <Bar dataKey="escalados" fill="#93C5FD" radius={[8, 8, 0, 0]} />
                <Line type="monotone" dataKey="presentes" stroke="#071B3A" strokeWidth={3} />
              </BarChart>
            </ResponsiveContainer>
          </div> : <EmptyState title="Sem cronograma nesta data" description="Selecione uma data com registros reais de cronograma para visualizar presença por turno." />}
          <div className="mt-4 rounded-lg bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700">
            {summary.planned ? `Cobertura real atual: ${summary.coverageRate}%` : "Sem cronograma importado para o período de teste."}
          </div>
        </Panel>

        <Panel title="Ausências por Motivo">
          {commandAbsenceReasons.length ? <div className="grid gap-4 md:grid-cols-[220px_1fr]">
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={commandAbsenceReasons} dataKey="value" innerRadius={62} outerRadius={98} paddingAngle={2}>
                    {commandAbsenceReasons.map((entry) => (
                      <Cell key={entry.name} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-col justify-center space-y-3">
              {commandAbsenceReasons.map((reason) => (
                <div key={reason.name} className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex items-center gap-2 font-semibold text-navy-950">
                    <span className="status-dot" style={{ backgroundColor: reason.fill }} />
                    {reason.name}
                  </span>
                  <span className="font-bold text-muted">{reason.value}</span>
                </div>
              ))}
            </div>
          </div> : <EmptyState title="Sem ausências registradas" description="Os motivos aparecerão quando houver registros reais de presença ou ausência." />}
        </Panel>

        <Panel title="Gaps por Turno">
          {commandGapByShift.length ? <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={commandGapByShift}>
                <CartesianGrid stroke="#E8EDF5" vertical={false} />
                <XAxis dataKey="shift" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip />
                <Bar dataKey="gaps" fill="#EF4444" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div> : <EmptyState title="Sem gap nesta data" description="Os gaps serão exibidos quando houver cronograma real na data selecionada." />}
          <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
            {summary.gap < 0 ? `Gap real identificado: ${summary.gap}` : "Sem gap crítico identificado na base real."}
          </div>
        </Panel>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_1fr_1fr]">
        <Panel title="Alertas e Ocorrências" action="Ver todos os alertas">
          {commandAlerts.length ? <MiniAlertList items={commandAlerts} /> : <EmptyState title="Sem alertas" description="Alertas aparecerão quando houver cronograma, presença ou ausência real." />}
        </Panel>
        <Panel title="Top Performers do Dia" action="Ver ranking completo">
          <EmptyState title="Sem ranking real" description="O ranking será preenchido quando houver métricas reais de performance." />
        </Panel>
        <Panel title="Riscos do Dia" action="Ver todos os riscos">
          {commandRisks.length ? <MiniAlertList items={commandRisks} /> : <EmptyState title="Sem riscos ativos" description="Riscos serão calculados a partir de cronograma, presença e solicitações reais." />}
        </Panel>
      </div>
    </div>
  );
}

export function MySchedulePage() {
  const [days, setDays] = useState(emptyCalendarDays());
  const [scheduleInfo, setScheduleInfo] = useState<{ id: string; name: string; schedule: string; shift: string; lob: string } | null>(null);
  const [myWorkHours, setMyWorkHours] = useState<WorkHourRow[]>([]);
  const [myWorkHourSummary, setMyWorkHourSummary] = useState<WorkHourSummary | null>(null);
  const [myRequests, setMyRequests] = useState<ClientRequest[]>([]);
  const [selectedRequest, setSelectedRequest] = useState<ClientRequest | null>(null);
  const [showDayOffModal, setShowDayOffModal] = useState(false);
  const [dayOffMessage, setDayOffMessage] = useState("");
  const [savingDayOff, setSavingDayOff] = useState(false);
  const [actorRole, setActorRole] = useState("COLABORADOR");
  const [actionReason, setActionReason] = useState("");
  const [comment, setComment] = useState("");
  const [actionPending, setActionPending] = useState("");
  const [requestFilters, setRequestFilters] = useState({ status: "Todos", type: "Todos", priority: "Todos", query: "" });
  const [dayOffForm, setDayOffForm] = useState({
    kind: "DAY_OFF_SWAP" as DayOffKind,
    currentDayOffDate: "2026-05-03",
    desiredDayOffDate: "2026-05-06",
    dayOffToSellDate: "2026-05-03",
    availabilityShift: "Manhã",
    preferredStartTime: "",
    preferredEndTime: "",
    acknowledgement: false,
    desiredDayOffRequestDate: "2026-05-08",
    dayOffReason: "Pessoal",
    urgency: "Média" as ClientRequest["priority"],
    justification: "",
    attachmentUrl: ""
  });

  useEffect(() => {
    apiJson<{ data: { scheduleDays: typeof scheduleDays; ownEmployee?: { id: string; name: string; schedule: string; shift: string; lob: string } | null } }>("/api/schedules")
      .then((payload) => {
        setDays(payload.data.scheduleDays);
        setScheduleInfo(payload.data.ownEmployee ? { ...payload.data.ownEmployee, shift: cleanShiftName(payload.data.ownEmployee.shift) || "Sem turno" } : null);
      })
      .catch(() => {
        setDays(emptyCalendarDays());
        setScheduleInfo(null);
      });
    void loadMyRequests();
    void loadMyWorkHours();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadMyWorkHours() {
    try {
      const payload = await apiJson<{ data: WorkHourRow[]; summary: WorkHourSummary }>("/api/work-hours?scope=mine&startDate=2026-05-01&endDate=2026-05-31&limit=100");
      setMyWorkHours(payload.data);
      setMyWorkHourSummary(payload.summary);
    } catch {
      setMyWorkHours([]);
      setMyWorkHourSummary(null);
    }
  }

  async function loadMyRequests() {
    try {
      const payload = await apiJson<{ data: ClientRequest[]; actor?: { role: string; name: string } }>("/api/requests?scope=mine");
      setMyRequests(payload.data);
      setActorRole(payload.actor?.role ?? "COLABORADOR");
      setSelectedRequest((current) => (current ? payload.data.find((item) => item.id === current.id) ?? current : null));
    } catch {
      setMyRequests([]);
    }
  }

  function validateDayOffForm() {
    if (!dayOffForm.justification.trim()) return "Justificativa é obrigatória.";
    if (dayOffForm.kind === "DAY_OFF_SWAP") {
      if (!dayOffForm.currentDayOffDate || !dayOffForm.desiredDayOffDate) return "Informe a data atual e a nova data desejada.";
      if (dayOffForm.currentDayOffDate === dayOffForm.desiredDayOffDate) return "A nova data não pode ser igual à data atual da folga.";
    }
    if (dayOffForm.kind === "DAY_OFF_SELL") {
      if (!dayOffForm.dayOffToSellDate) return "Informe a data da folga que deseja vender.";
      if (!dayOffForm.availabilityShift && (!dayOffForm.preferredStartTime || !dayOffForm.preferredEndTime)) return "Informe o turno desejado ou disponibilidade de horário.";
      if (!dayOffForm.acknowledgement) return "Confirme a ciência de que a venda depende de aprovação.";
    }
    if (dayOffForm.kind === "DAY_OFF_REQUEST") {
      if (!dayOffForm.desiredDayOffRequestDate) return "Informe a data desejada para folga.";
      if (!dayOffForm.dayOffReason) return "Informe o motivo da solicitação.";
    }
    return "";
  }

  async function submitDayOffRequest() {
    const validation = validateDayOffForm();
    if (validation) {
      setDayOffMessage(validation);
      return;
    }
    setSavingDayOff(true);
    setDayOffMessage("");
    const type = dayOffKindLabels[dayOffForm.kind];
    try {
      const payload = await apiJson<{ data: ClientRequest }>("/api/requests", {
        method: "POST",
        body: JSON.stringify({
          type,
          title: type,
          priority: dayOffForm.kind === "DAY_OFF_REQUEST" ? dayOffForm.urgency : "Média",
          description: dayOffForm.justification,
          dayOffKind: dayOffForm.kind,
          currentDayOffDate: dayOffForm.kind === "DAY_OFF_SWAP" ? dayOffForm.currentDayOffDate : undefined,
          desiredDayOffDate: dayOffForm.kind === "DAY_OFF_SWAP" ? dayOffForm.desiredDayOffDate : undefined,
          dayOffToSellDate: dayOffForm.kind === "DAY_OFF_SELL" ? dayOffForm.dayOffToSellDate : undefined,
          availabilityShift: dayOffForm.kind === "DAY_OFF_SELL" ? dayOffForm.availabilityShift : undefined,
          preferredStartTime: dayOffForm.kind === "DAY_OFF_SELL" ? dayOffForm.preferredStartTime : undefined,
          preferredEndTime: dayOffForm.kind === "DAY_OFF_SELL" ? dayOffForm.preferredEndTime : undefined,
          acknowledgement: dayOffForm.kind === "DAY_OFF_SELL" ? dayOffForm.acknowledgement : undefined,
          desiredDayOffRequestDate: dayOffForm.kind === "DAY_OFF_REQUEST" ? dayOffForm.desiredDayOffRequestDate : undefined,
          dayOffReason: dayOffForm.kind === "DAY_OFF_REQUEST" ? dayOffForm.dayOffReason : undefined,
          urgency: dayOffForm.kind === "DAY_OFF_REQUEST" ? dayOffForm.urgency : undefined,
          justification: dayOffForm.justification,
          attachmentUrl: dayOffForm.attachmentUrl || undefined
        })
      });
      setShowDayOffModal(false);
      setMyRequests((items) => [payload.data, ...items]);
      setSelectedRequest(payload.data);
      setDayOffMessage(`Solicitação ${payload.data.id} criada com sucesso. Ela já aparece em Minhas Solicitações e na esteira.`);
      await loadMyRequests();
    } catch (error) {
      setDayOffMessage(error instanceof Error ? error.message : "Não foi possível criar a solicitação de folga.");
    } finally {
      setSavingDayOff(false);
    }
  }

  async function moveMyRequest(id: string, status: string, actionInput?: Record<string, string>) {
    if (actionPending) return;
    const reason = actionReason.trim();
    if (status === "Recusado" && !reason) {
      setDayOffMessage("Informe o motivo da recusa.");
      return;
    }

    setActionPending(`${id}:${status}`);
    try {
      const payload = await apiJson<{ data: ClientRequest; scheduleUpdated: boolean }>("/api/requests/status", {
        method: "PATCH",
        body: JSON.stringify({ id, status, reason: reason || undefined, actionInput })
      });
      setMyRequests((items) => items.map((item) => (item.id === id ? payload.data : item)));
      setSelectedRequest(payload.data);
      setActionReason("");
      setDayOffMessage(payload.scheduleUpdated ? "Solicitação aprovada e cronograma atualizado." : `Solicitação movida para ${payload.data.status}.`);
      apiJson<{ data: { scheduleDays: typeof scheduleDays } }>("/api/schedules")
        .then((schedulePayload) => setDays(schedulePayload.data.scheduleDays))
        .catch(() => undefined);
    } catch (error) {
      setDayOffMessage(error instanceof Error ? error.message : "Não foi possível atualizar a solicitação.");
    } finally {
      setActionPending("");
    }
  }

  async function submitMyComment(id: string) {
    if (!comment.trim()) {
      setDayOffMessage("Digite um comentário antes de enviar.");
      return;
    }
    try {
      const payload = await apiJson<{ data: ClientRequest }>("/api/requests/comments", {
        method: "POST",
        body: JSON.stringify({ id, body: comment })
      });
      setMyRequests((items) => items.map((item) => (item.id === id ? payload.data : item)));
      setSelectedRequest(payload.data);
      setComment("");
      setDayOffMessage("Comentário registrado.");
    } catch (error) {
      setDayOffMessage(error instanceof Error ? error.message : "Não foi possível comentar.");
    }
  }

  const filteredRequests = myRequests.filter((request) => {
    const query = requestFilters.query.toLowerCase();
    return (
      (requestFilters.status === "Todos" || request.status === requestFilters.status) &&
      (requestFilters.type === "Todos" || request.type === requestFilters.type) &&
      (requestFilters.priority === "Todos" || request.priority === requestFilters.priority) &&
      (!query || [request.title, request.description, request.type].join(" ").toLowerCase().includes(query))
    );
  });

  const requestSummary = {
    total: myRequests.length,
    open: myRequests.filter((request) => request.status === "Aberto").length,
    analysis: myRequests.filter((request) => request.status === "Em análise").length,
    approved: myRequests.filter((request) => request.status === "Aprovado").length,
    refused: myRequests.filter((request) => request.status === "Recusado").length,
    done: myRequests.filter((request) => request.status === "Concluído").length,
    canceled: myRequests.filter((request) => request.status === "Cancelado").length
  };
  const hasSchedule = days.some((day) => !day.outside && day.shift !== "Sem cronograma");
  const nextScheduleLabel = cleanShiftName(days.find((day) => !day.outside && !["Sem cronograma", "Folga", "Férias"].includes(day.label))?.label) || "";
  const workHourByDate = new Map(myWorkHours.map((row) => [row.date, row]));

  return (
    <div>
      <PageHeader
        title="Meu Cronograma"
        description="Visualize seu cronograma, folgas e solicite alterações"
        icon={CalendarDays}
        actions={
          <button onClick={() => setShowDayOffModal(true)} className="flex h-12 items-center gap-2 rounded-lg bg-blue-600 px-5 text-sm font-bold text-white shadow-soft">
            <RefreshCw className="h-4 w-4" />
            Solicitar Folga
          </button>
        }
      />
      {dayOffMessage ? (
        <div className="mb-5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700">{dayOffMessage}</div>
      ) : null}
      <div className="mb-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_520px]">
        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-5 py-4">
            <div className="flex items-center gap-3">
              <button className="grid h-10 w-10 place-items-center rounded-lg border border-border bg-white">‹</button>
              <h2 className="text-xl font-extrabold text-navy-950">Maio 2026</h2>
              <button className="grid h-10 w-10 place-items-center rounded-lg border border-border bg-white">›</button>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <MetricPill value={hasSchedule && scheduleInfo ? `${scheduleInfo.schedule} - ${scheduleInfo.shift}` : "Sem cronograma"} label="Seu Cronograma" />
              <MetricPill value={hasSchedule && nextScheduleLabel ? nextScheduleLabel : "Sem próximo turno"} label="Próximo Turno" />
              <MetricPill value={hasSchedule && scheduleInfo ? scheduleInfo.lob : "Não vinculado"} label="Local" />
            </div>
          </div>
          {!hasSchedule ? <div className="border-b border-border p-8"><EmptyState title="Nenhum cronograma encontrado" description="Seu cronograma ainda não foi importado ou vinculado ao seu cadastro." /></div> : null}
          <div className="grid grid-cols-7 border-b border-border bg-white text-center text-sm font-bold text-navy-950">
            {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((day) => (
              <div key={day} className="border-r border-border px-3 py-4 last:border-r-0">
                {day}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 bg-white">
            {days.map((day, index) => {
              const isToday = day.date === 29 && !day.outside;
              const dateKey = day.outside ? "" : `2026-05-${String(day.date).padStart(2, "0")}`;
              const workHour = dateKey ? workHourByDate.get(dateKey) : undefined;
              const dayLabel = cleanShiftName(day.label) || day.label;
              const dayShift = cleanShiftName(day.shift) || day.shift;
              return (
                <div key={index} className={cn("min-h-[98px] border-r border-t border-border p-3 last:border-r-0", day.outside && "text-slate-300")}>
                  <div className={cn("mb-2 text-base font-bold", isToday && "grid h-8 w-8 place-items-center rounded-full bg-blue-600 text-white")}>{day.date}</div>
                  {!day.outside ? (
                    <div className="space-y-1.5">
                      <span className={cn("inline-flex items-center gap-2 rounded-md px-2 py-1 text-xs font-semibold", shiftTagClass(dayLabel))}>
                        <span className={cn("status-dot", dayShift === "Manhã" ? "bg-emerald-500" : dayShift === "Tarde" ? "bg-orange-500" : dayShift === "Noite" ? "bg-violet-600" : "bg-violet-300")} />
                        {dayLabel}
                      </span>
                      {workHour ? (
                        <div className="rounded-md border border-blue-100 bg-white/80 px-2 py-1 text-[11px] font-bold text-navy-950">
                          <p>Real: {workHour.actualStart || "--"}-{workHour.actualEnd || "--"} • {workHour.effectiveHours}h</p>
                          <p className="text-muted">Pausa: {formatBreakDuration(workHour.effectiveBreakMinutes ?? workHour.breakMinutes ?? 0)}</p>
                          <p className={cn(workHour.differenceMinutes < 0 ? "text-red-600" : workHour.differenceMinutes > 0 ? "text-emerald-600" : "text-muted")}>{workHour.status} • {workHour.differenceMinutes}min</p>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-5 px-5 py-4 text-xs font-semibold text-muted">
            {Array.from(standardShiftNames).map((item, index) => (
              <span key={item} className="flex items-center gap-2">
                <span className={cn("status-dot", ["bg-emerald-500", "bg-orange-500", "bg-violet-600", "bg-violet-300"][index])} />
                {item}
              </span>
            ))}
          </div>
        </section>

        <div className="space-y-5">
          <Panel title="Minhas Solicitações">
            <div className="mb-4 grid gap-2 md:grid-cols-2">
              <select value={requestFilters.status} onChange={(event) => setRequestFilters({ ...requestFilters, status: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold outline-none">
                {["Todos", ...requestStatuses].map((status) => <option key={status}>{status}</option>)}
              </select>
              <select value={requestFilters.type} onChange={(event) => setRequestFilters({ ...requestFilters, type: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold outline-none">
                {["Todos", ...requestTypes].map((type) => <option key={type}>{type}</option>)}
              </select>
              <select value={requestFilters.priority} onChange={(event) => setRequestFilters({ ...requestFilters, priority: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold outline-none">
                {["Todos", ...requestPriorities].map((priority) => <option key={priority}>{priority}</option>)}
              </select>
              <input value={requestFilters.query} onChange={(event) => setRequestFilters({ ...requestFilters, query: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder="Buscar solicitação" />
            </div>
            {filteredRequests.length ? (
              <div className="space-y-3">
                {filteredRequests.slice(0, 6).map((request) => {
                  const Icon = getRequestIcon(request.type);
                  return (
                    <button key={request.id} onClick={() => setSelectedRequest(request)} className="flex w-full items-center gap-3 rounded-lg border border-border p-3 text-left transition hover:bg-blue-50/40">
                      <div className="grid h-11 w-11 place-items-center rounded-xl bg-amber-50 text-amber-500">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-navy-950">{request.title || request.type}</p>
                        <p className="text-xs text-muted">{request.id} • {primaryDayOffDate(request)} • Atualizada em {request.updatedAt ?? request.time}</p>
                      </div>
                      <StatusBadge status={request.status} />
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-3">
                <EmptyState title="Você ainda não possui solicitações" description="Quando você abrir uma solicitação, ela aparecerá aqui para acompanhamento." />
                <button onClick={() => setShowDayOffModal(true)} className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-bold text-white">Solicitar Folga</button>
              </div>
            )}
          </Panel>
          <Panel title="Resumo de Horas">
            {myWorkHours.length && myWorkHourSummary ? (
              <div className="grid gap-3">
                <MetricPill value={`${myWorkHourSummary.plannedHours}h`} label="Horas previstas" />
                <MetricPill value={`${myWorkHourSummary.actualHours}h`} label="Horas realizadas" />
                <MetricPill value={formatBreakDuration(myWorkHourSummary.breakMinutes ?? 0)} label="Pausas totais" />
                <MetricPill value={`${myWorkHourSummary.differenceHours}h`} label="Diferença" />
                <MetricPill value={`${myWorkHourSummary.adjustedHours}h`} label="Horas ajustadas" />
                <MetricPill value={myWorkHourSummary.pendingAdjustments} label="Ajustes pendentes" />
                <MetricPill value={myWorkHourSummary.divergentRecords} label="Dias com divergência" />
                <MetricPill value={myWorkHourSummary.noScheduleRecords} label="Dias sem cronograma vinculado" />
              </div>
            ) : (
              <EmptyState title="Horas ainda não importadas" description="Horas ainda não importadas para este período." />
            )}
          </Panel>
          <Panel title="Comunicados Recentes">
            <EmptyState title="Comunicados recentes" description="Nenhum comunicado disponível no momento." />
          </Panel>
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Status das Solicitações">
          <div className="grid grid-cols-2 divide-x divide-y divide-border rounded-lg border border-border md:grid-cols-6 md:divide-y-0">
            <MetricPill value={requestSummary.total} label="Total" />
            <MetricPill value={requestSummary.open} label="Abertas" />
            <MetricPill value={requestSummary.analysis} label="Em análise" />
            <MetricPill value={requestSummary.approved} label="Aprovadas" />
            <MetricPill value={requestSummary.refused} label="Recusadas" />
            <MetricPill value={requestSummary.done} label="Concluídas" />
          </div>
        </Panel>
        <Panel title="Meu Desempenho">
          <EmptyState title="Desempenho ainda não disponível" description="Os indicadores de desempenho serão exibidos quando houver dados reais importados ou cadastrados." />
        </Panel>
      </div>
      {showDayOffModal ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4 backdrop-blur-sm">
          <div className="card max-h-[88vh] w-full max-w-3xl overflow-y-auto p-5">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-extrabold text-navy-950">Solicitar Folga</h2>
                <p className="text-sm text-muted">Qual tipo de solicitação de folga você deseja abrir?</p>
              </div>
              <button onClick={() => setShowDayOffModal(false)} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-slate-100">×</button>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {dayOffOptions.map((option) => (
                <button key={option.kind} onClick={() => setDayOffForm({ ...dayOffForm, kind: option.kind })} className={cn("rounded-lg border p-4 text-left transition", dayOffForm.kind === option.kind ? "border-blue-500 bg-blue-50 text-blue-700" : "border-border bg-white text-navy-950 hover:bg-slate-50")}>
                  <p className="font-extrabold">{option.title}</p>
                  <p className="mt-1 text-xs text-muted">{option.description}</p>
                </button>
              ))}
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {dayOffForm.kind === "DAY_OFF_SWAP" ? (
                <>
                  <FormInput label="Data atual da folga" type="date" value={dayOffForm.currentDayOffDate} onChange={(value) => setDayOffForm({ ...dayOffForm, currentDayOffDate: value })} />
                  <FormInput label="Nova data desejada" type="date" value={dayOffForm.desiredDayOffDate} onChange={(value) => setDayOffForm({ ...dayOffForm, desiredDayOffDate: value })} />
                </>
              ) : null}
              {dayOffForm.kind === "DAY_OFF_SELL" ? (
                <>
                  <FormInput label="Data da folga que deseja vender" type="date" value={dayOffForm.dayOffToSellDate} onChange={(value) => setDayOffForm({ ...dayOffForm, dayOffToSellDate: value })} />
                  <FormSelect label="Turno desejado" value={dayOffForm.availabilityShift} options={Array.from(standardShiftNames)} onChange={(value) => setDayOffForm({ ...dayOffForm, availabilityShift: value })} />
                  <FormInput label="Horário preferencial de entrada" value={dayOffForm.preferredStartTime} onChange={(value) => setDayOffForm({ ...dayOffForm, preferredStartTime: value })} />
                  <FormInput label="Horário preferencial de saída" value={dayOffForm.preferredEndTime} onChange={(value) => setDayOffForm({ ...dayOffForm, preferredEndTime: value })} />
                  <label className="md:col-span-2 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-700">
                    <input type="checkbox" checked={dayOffForm.acknowledgement} onChange={(event) => setDayOffForm({ ...dayOffForm, acknowledgement: event.target.checked })} />
                    Estou ciente de que a venda de folga depende de aprovação da operação/WFM.
                  </label>
                </>
              ) : null}
              {dayOffForm.kind === "DAY_OFF_REQUEST" ? (
                <>
                  <FormInput label="Data desejada para folga" type="date" value={dayOffForm.desiredDayOffRequestDate} onChange={(value) => setDayOffForm({ ...dayOffForm, desiredDayOffRequestDate: value })} />
                  <FormSelect label="Motivo" value={dayOffForm.dayOffReason} options={["Pessoal", "Saúde", "Familiar", "Compromisso externo", "Estudos", "Emergência", "Outro"]} onChange={(value) => setDayOffForm({ ...dayOffForm, dayOffReason: value })} />
                  <FormSelect label="Urgência" value={dayOffForm.urgency} options={requestPriorities} onChange={(value) => setDayOffForm({ ...dayOffForm, urgency: value as ClientRequest["priority"] })} />
                  <FormInput label="Anexo/evidência opcional" value={dayOffForm.attachmentUrl} onChange={(value) => setDayOffForm({ ...dayOffForm, attachmentUrl: value })} />
                </>
              ) : null}
              <label className="md:col-span-2">
                <span className="mb-1.5 block text-sm font-bold text-muted">Justificativa</span>
                <textarea value={dayOffForm.justification} onChange={(event) => setDayOffForm({ ...dayOffForm, justification: event.target.value })} className="min-h-28 w-full rounded-lg border border-border p-3 outline-none" placeholder="Explique o motivo da solicitação" />
              </label>
            </div>
            <div className="mt-5 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700">
              Toda solicitação depende de aprovação e será registrada com histórico, auditoria e notificação interna.
            </div>
            <button disabled={savingDayOff} onClick={submitDayOffRequest} className="mt-5 w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-60">
              {savingDayOff ? "Enviando..." : "Enviar solicitação de folga"}
            </button>
          </div>
        </div>
      ) : null}
      {selectedRequest ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4 backdrop-blur-sm">
          <div className="card max-h-[88vh] w-full max-w-3xl overflow-y-auto p-5">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-extrabold text-navy-950">Detalhe da Solicitação</h2>
              <button onClick={() => setSelectedRequest(null)} className="text-2xl text-muted">×</button>
            </div>
            <RequestDetailContent selected={selectedRequest} actorRole={actorRole} actionReason={actionReason} setActionReason={setActionReason} comment={comment} setComment={setComment} onMove={moveMyRequest} onComment={submitMyComment} actionPending={actionPending} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function normalizeExcelKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeEmployeeImportSheetRow(row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [normalizeExcelKey(key), value]));
}

export function RegistrationApprovalsPage() {
  const employeeImportInputRef = useRef<HTMLInputElement | null>(null);
  const [items, setItems] = useState<RegistrationItem[]>([]);
  const [registrationPagination, setRegistrationPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1 });
  const [registrationFilters, setRegistrationFilters] = useState({ search: "", status: "Todos" });
  const [registrationSummary, setRegistrationSummary] = useState<RegistrationSummary>({ pending: 0, active: 0, adjust: 0, refused: 0 });
  const [selected, setSelected] = useState<RegistrationItem | null>(null);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [showEmployeeImport, setShowEmployeeImport] = useState(false);
  const [employeeImportRows, setEmployeeImportRows] = useState<Array<Record<string, unknown>>>([]);
  const [employeeImportPreview, setEmployeeImportPreview] = useState<EmployeeImportPreview | null>(null);
  const [employeeImportFileName, setEmployeeImportFileName] = useState("");
  const [employeeImportError, setEmployeeImportError] = useState("");
  const [registrationSettings, setRegistrationSettings] = useState<SystemSettings | null>(null);
  const [importingEmployees, setImportingEmployees] = useState(false);
  const [downloadingEmployeeTemplate, setDownloadingEmployeeTemplate] = useState(false);
  const [allowPartialEmployeeImport, setAllowPartialEmployeeImport] = useState(false);
  const [reviewingAction, setReviewingAction] = useState<"approve" | "reject" | "request_adjustment" | null>(null);
  const [deletingRegistration, setDeletingRegistration] = useState(false);
  const [reviewNotes, setReviewNotes] = useState("Dados conferidos. Aprovação liberada para ativação.");
  const [operational, setOperational] = useState({
    wbLogin: "",
    lob: "CEC",
    team: "Time Inicial",
    supervisor: "",
    shift: "Manhã",
    schedule: "6x1",
    roleTitle: "Atendente",
    employeeStatus: "Ativo",
    contractType: "PJ",
    admissionDate: "2026-05-04",
    trainingDate: "2026-05-04",
    site: "Remoto",
    internalNotes: "Complementado por RH/Admin/WFM."
  });

  useEffect(() => {
    refreshRegistrations();
    apiJson<{ data: SystemSettings }>("/api/settings")
      .then((payload) => setRegistrationSettings(payload.data))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selected) return;
    const op = selected.operationalData ?? {};
    setOperational({
      wbLogin: op.wbLogin ?? selected.email.split("@")[0],
      lob: op.lob ?? "CEC",
      team: op.team ?? "Time Inicial",
      supervisor: op.supervisor ?? "",
      shift: op.shift ?? "Manhã",
      schedule: op.schedule ?? "6x1",
      roleTitle: op.roleTitle ?? "Atendente",
      employeeStatus: op.employeeStatus === "Pendente de Cadastro" ? "Ativo" : op.employeeStatus ?? "Ativo",
      contractType: op.contractType ?? "PJ",
      admissionDate: op.admissionDate ?? "2026-05-04",
      trainingDate: op.trainingDate ?? "2026-05-04",
      site: op.site ?? "Remoto",
      internalNotes: op.internalNotes ?? "Complementado por RH/Admin/WFM."
    });
  }, [selected]);

  async function refreshRegistrations(nextPage = registrationPagination.page, nextLimit = registrationPagination.limit, nextFilters = registrationFilters) {
    const params = new URLSearchParams({
      page: String(nextPage),
      limit: String(nextLimit)
    });
    if (nextFilters.search.trim()) params.set("search", nextFilters.search.trim());
    if (nextFilters.status !== "Todos") params.set("status", nextFilters.status);
    const payload = await apiJson<{ data: RegistrationItem[]; total: number; page: number; limit: number; totalPages: number; summary?: RegistrationSummary }>(`/api/employee-registrations?${params.toString()}`);
    setItems(payload.data);
    setRegistrationPagination({ total: payload.total, page: payload.page, limit: payload.limit, totalPages: payload.totalPages });
    setRegistrationSummary(payload.summary ?? {
      pending: payload.data.filter((item) => item.status === "Pendente de Aprovação").length,
      active: payload.data.filter((item) => item.status === "Ativo" || item.status === "Aprovado").length,
      adjust: payload.data.filter((item) => item.status === "Ajuste Solicitado").length,
      refused: payload.data.filter((item) => item.status === "Recusado").length
    });
    setSelected((current) => current && payload.data.some((item) => item.id === current.id) ? current : payload.data[0] ?? null);
  }

  async function handleEmployeeImportFile(file?: File) {
    if (!file) return;
    setImportingEmployees(true);
    setMessage("");
    setEmployeeImportError("");
    setEmployeeImportPreview(null);
    setEmployeeImportRows([]);
    setEmployeeImportFileName(file.name);
    setShowEmployeeImport(true);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer);
      const sheetName = workbook.SheetNames.find((name) => normalizeExcelKey(name) === "colaboradores") ?? workbook.SheetNames[0];
      if (!sheetName) throw new Error("O arquivo não possui abas para leitura.");
      const sheet = workbook.Sheets[sheetName];
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      const rows = rawRows
        .map(normalizeEmployeeImportSheetRow)
        .filter((row) => Object.values(row).some((value) => String(value ?? "").trim() !== ""));
      if (!rows.length) throw new Error("Nenhuma linha de colaborador encontrada. Verifique se a aba colaboradores possui dados.");
      const payload = await apiJson<{ data: EmployeeImportPreview }>("/api/employee-registrations/import/preview", {
        method: "POST",
        body: JSON.stringify({ rows })
      });
      setEmployeeImportRows(rows);
      setEmployeeImportPreview(payload.data);
      setShowEmployeeImport(true);
    } catch (err) {
      setMessageTone("error");
      const errorMessage = err instanceof ApiRequestError ? err.message : err instanceof Error ? err.message : "Não foi possível ler o arquivo de colaboradores.";
      setEmployeeImportError(errorMessage);
      setMessage(errorMessage);
      setShowEmployeeImport(true);
    } finally {
      setImportingEmployees(false);
      if (employeeImportInputRef.current) employeeImportInputRef.current.value = "";
    }
  }

  async function downloadEmployeeTemplate() {
    setDownloadingEmployeeTemplate(true);
    setMessage("");
    try {
      await downloadFile("/api/employee-registrations/template", "template_colaboradores.xlsx");
    } catch (err) {
      setMessageTone("error");
      setMessage(err instanceof Error ? err.message : "Não foi possível baixar o template. Tente novamente.");
    } finally {
      setDownloadingEmployeeTemplate(false);
    }
  }

  async function confirmEmployeeImport() {
    if (!employeeImportRows.length || importingEmployees) return;
    setImportingEmployees(true);
    setMessage("");
    setEmployeeImportError("");
    try {
      const chunkSize = 25;
      const chunks = Array.from({ length: Math.ceil(employeeImportRows.length / chunkSize) }, (_, index) => employeeImportRows.slice(index * chunkSize, (index + 1) * chunkSize));
      const summary = { colaboradoresCriados: 0, usuariosCriados: 0, registrosAtualizados: 0, ignoredRows: 0 };
      let processedRows = 0;
      for (let index = 0; index < chunks.length; index += 1) {
        const chunk = chunks[index];
        setMessageTone("success");
        setMessage(`Importando colaboradores... lote ${index + 1}/${chunks.length} (${processedRows}/${employeeImportRows.length} linhas processadas).`);
        const payload = await apiJson<{ data: EmployeeImportPreview & { colaboradoresCriados: number; usuariosCriados: number; registrosAtualizados: number; ignoredRows?: number; importBatchId: string } }>("/api/employee-registrations/import/commit", {
          method: "POST",
          body: JSON.stringify({ rows: chunk, allowPartial: allowPartialEmployeeImport })
        });
        summary.colaboradoresCriados += payload.data.colaboradoresCriados;
        summary.usuariosCriados += payload.data.usuariosCriados;
        summary.registrosAtualizados += payload.data.registrosAtualizados;
        summary.ignoredRows += payload.data.ignoredRows ?? 0;
        processedRows += chunk.length;
      }
      setMessageTone("success");
      setMessage(`Importação concluída: ${summary.colaboradoresCriados} colaborador(es), ${summary.usuariosCriados} usuário(s), ${summary.registrosAtualizados} registro(s) atualizado(s), ${summary.ignoredRows} linha(s) ignorada(s).`);
      setShowEmployeeImport(false);
      await refreshRegistrations(1);
    } catch (err) {
      setMessageTone("error");
      const errorMessage = err instanceof ApiRequestError ? err.message : err instanceof Error ? err.message : "Não foi possível importar colaboradores.";
      setEmployeeImportError(errorMessage);
      setMessage(errorMessage);
      setShowEmployeeImport(true);
    } finally {
      setImportingEmployees(false);
    }
  }

  async function review(action: "approve" | "reject" | "request_adjustment") {
    if (!selected) return;
    if ((action === "reject" || action === "request_adjustment") && !reviewNotes.trim()) {
      setMessageTone("error");
      setMessage(action === "reject" ? "Informe o motivo da recusa." : "Informe o comentário do ajuste solicitado.");
      return;
    }
    if (action === "approve" && selected.hasPassword === false) {
      setMessageTone("error");
      setMessage("Este cadastro não possui senha cadastrada. Solicite ajuste ao colaborador.");
      return;
    }
    if (action === "approve") {
      const missing = [
        ["WB/Login", operational.wbLogin],
        ["LOB", operational.lob],
        ["Time", operational.team],
        ["Turno", operational.shift],
        ["Cronograma", operational.schedule],
        ["Cargo/Função", operational.roleTitle],
        ["Status", operational.employeeStatus],
        ["Admissão", operational.admissionDate],
        ["Treinamento", operational.trainingDate],
        ["Site/Operação", operational.site]
      ].filter(([, value]) => !String(value).trim()).map(([label]) => label);
      if (missing.length) {
        setMessageTone("error");
        setMessage(`Preencha os dados operacionais obrigatórios antes de aprovar: ${missing.join(", ")}.`);
        return;
      }
    }

    setReviewingAction(action);
    setMessage("");
    try {
      const payload = await apiJson<{ data: RegistrationItem }>("/api/employee-registrations/status", {
        method: "PATCH",
        body: JSON.stringify({
          id: selected.id,
          action,
          reviewNotes,
          operationalData: action === "approve" ? operational : undefined
        })
      });
      setItems((current) => current.map((item) => (item.id === payload.data.id ? payload.data : item)));
      setSelected(payload.data);
      setMessageTone("success");
      setMessage(action === "approve" ? "Cadastro aprovado, usuário liberado e Mapa de Funcionários atualizado." : action === "reject" ? "Cadastro recusado com justificativa registrada." : "Ajuste solicitado ao colaborador.");
    } catch (err) {
      setMessageTone("error");
      setMessage(err instanceof ApiRequestError ? err.message : err instanceof Error ? err.message : "Não foi possível revisar o cadastro.");
    } finally {
      setReviewingAction(null);
    }
  }

  async function deleteRegistration() {
    if (!selected || deletingRegistration) return;
    const confirmed = window.confirm("Tem certeza que deseja excluir este cadastro? Esta ação não deve ser usada para colaboradores ativos.");
    if (!confirmed) return;

    setDeletingRegistration(true);
    setMessage("");
    try {
      const payload = await apiJson<{ message: string }>("/api/employee-registrations", {
        method: "DELETE",
        body: JSON.stringify({ id: selected.id })
      });
      setMessageTone("success");
      setMessage(payload.message ?? "Cadastro removido.");
      const nextItems = items.filter((item) => item.id !== selected.id);
      setItems(nextItems);
      setSelected(nextItems[0] ?? null);
      await refreshRegistrations();
    } catch (err) {
      setMessageTone("error");
      setMessage(err instanceof ApiRequestError ? err.message : err instanceof Error ? err.message : "Não foi possível excluir o cadastro.");
    } finally {
      setDeletingRegistration(false);
    }
  }

  const counts = {
    pending: registrationSummary.pending,
    active: registrationSummary.active,
    adjust: registrationSummary.adjust,
    refused: registrationSummary.refused
  };
  const selectedReviewClosed = selected ? ["Aprovado", "Ativo", "Recusado"].includes(selected.status) : false;
  const registrationLobOptions = registrationSettings?.lobs.filter((lob) => lob.status !== "INACTIVE").map((lob) => lob.name) ?? ["ALL", "CEC", "TNS", "ADS"];
  const registrationShiftOptions = cleanShiftOptions(registrationSettings?.shifts.filter((shift) => shift.status !== "INACTIVE").map((shift) => shift.name), true);
  const registrationRoleTitleOptions = registrationSettings?.roleTitles.filter((title) => title.status !== "INACTIVE").map((title) => title.name) ?? ["Atendente", "Supervisor", "WFM", "Qualidade", "RH"];
  const registrationStart = registrationPagination.total ? (registrationPagination.page - 1) * registrationPagination.limit + 1 : 0;
  const registrationEnd = Math.min(registrationPagination.page * registrationPagination.limit, registrationPagination.total);

  return (
    <div>
      <PageHeader
        title="Cadastros de Colaboradores"
        description="Aprove, recuse, solicite ajustes e complemente dados operacionais antes de liberar acesso."
        icon={UserPlus}
        actions={
          <div className="flex flex-wrap justify-end gap-2">
            <button onClick={() => { window.location.href = "/cadastro-colaborador"; }} className="premium-control h-11 px-4 text-sm font-extrabold text-navy-950">Novo cadastro manual</button>
            <button onClick={() => employeeImportInputRef.current?.click()} className="flex h-11 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-extrabold text-white shadow-soft">
              <Upload className="h-4 w-4" />
              Importar colaboradores
            </button>
            <button type="button" disabled={downloadingEmployeeTemplate} onClick={downloadEmployeeTemplate} className="premium-control flex h-11 items-center gap-2 px-4 text-sm font-extrabold text-navy-950 disabled:cursor-not-allowed disabled:opacity-60">
              <Download className="h-4 w-4" />
              {downloadingEmployeeTemplate ? "Baixando..." : "Baixar template"}
            </button>
          </div>
        }
      />
      <input ref={employeeImportInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(event) => void handleEmployeeImportFile(event.target.files?.[0])} />
      <div className="mb-5 grid gap-4 md:grid-cols-4">
        <StatCard title="Pendentes" value={counts.pending} helper="aguardando RH/Admin/WFM" icon={Clock} tone="orange" />
        <StatCard title="Ativos" value={counts.active} helper="liberados no mapa" icon={CheckCircle2} tone="green" />
        <StatCard title="Ajustes" value={counts.adjust} helper="retorno ao colaborador" icon={RefreshCw} tone="blue" />
        <StatCard title="Recusados" value={counts.refused} helper="com justificativa" icon={XCircle} tone="red" />
      </div>
      {message ? <div className={cn("mb-5 rounded-lg border px-4 py-3 text-sm font-bold", messageTone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700")}>{message}</div> : null}
      <section className="card mb-5 p-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_140px_160px]">
          <input
            value={registrationFilters.search}
            onChange={(event) => setRegistrationFilters({ ...registrationFilters, search: event.target.value })}
            className="h-10 rounded-lg border border-border px-3 text-sm outline-none"
            placeholder="Buscar por nome, e-mail ou CPF"
          />
          <select
            value={registrationFilters.status}
            onChange={(event) => setRegistrationFilters({ ...registrationFilters, status: event.target.value })}
            className="h-10 rounded-lg border border-border px-3 text-sm font-bold outline-none"
          >
            {["Todos", "Pendente de Aprovação", "Ajuste Solicitado", "Aprovado", "Ativo", "Recusado", "Inativo"].map((status) => <option key={status}>{status}</option>)}
          </select>
          <select
            value={registrationPagination.limit}
            onChange={(event) => {
              const limit = Number(event.target.value);
              setRegistrationPagination((current) => ({ ...current, limit, page: 1 }));
              void refreshRegistrations(1, limit);
            }}
            className="h-10 rounded-lg border border-border px-3 text-sm font-bold outline-none"
          >
            {[25, 50, 100].map((limit) => <option key={limit} value={limit}>{limit}/página</option>)}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => void refreshRegistrations(1)} className="rounded-lg bg-blue-600 px-3 text-sm font-bold text-white">Filtrar</button>
            <button
              onClick={() => {
                setRegistrationFilters({ search: "", status: "Todos" });
                setRegistrationPagination((current) => ({ ...current, page: 1 }));
                void refreshRegistrations(1, registrationPagination.limit, { search: "", status: "Todos" });
              }}
              className="rounded-lg border border-border bg-white px-3 text-sm font-bold"
            >
              Limpar
            </button>
          </div>
        </div>
      </section>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_460px]">
        <Panel title="Esteira de aprovação cadastral">
          {items.length ? (
            <div className="space-y-4">
              <SimpleTable
                columns={["Protocolo", "Nome", "E-mail", "Cidade/UF", "Status", "Envio"]}
                rows={items.map((item) => [
                  <button key={item.id} onClick={() => setSelected(item)} className="font-extrabold text-blue-600">{item.id}</button>,
                  <button key={`${item.id}-name`} onClick={() => setSelected(item)} className="text-left font-extrabold text-navy-950 hover:text-blue-700">{item.fullName}</button>,
                  <button key={`${item.id}-email`} onClick={() => setSelected(item)} className="text-left text-blue-700">{item.email}</button>,
                  `${item.city}/${item.stateUf}`,
                  <StatusBadge key={`${item.id}-status`} status={item.status} />,
                  item.submittedAt
                ])}
              />
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-sm text-muted">
                <span>Exibindo {registrationStart}-{registrationEnd} de {registrationPagination.total} registros • Página {registrationPagination.page} de {registrationPagination.totalPages}</span>
                <div className="flex flex-wrap gap-2">
                  <button disabled={registrationPagination.page <= 1} onClick={() => void refreshRegistrations(1)} className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold text-navy-950 disabled:opacity-40">Primeira</button>
                  <button disabled={registrationPagination.page <= 1} onClick={() => void refreshRegistrations(registrationPagination.page - 1)} className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold text-navy-950 disabled:opacity-40">Anterior</button>
                  <button disabled={registrationPagination.page >= registrationPagination.totalPages} onClick={() => void refreshRegistrations(registrationPagination.page + 1)} className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold text-navy-950 disabled:opacity-40">Próxima</button>
                  <button disabled={registrationPagination.page >= registrationPagination.totalPages} onClick={() => void refreshRegistrations(registrationPagination.totalPages)} className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold text-navy-950 disabled:opacity-40">Última</button>
                </div>
              </div>
            </div>
          ) : <EmptyState title="Nenhum cadastro encontrado" description="Nenhum cadastro encontrado para os filtros selecionados." />}
        </Panel>
        <Panel title="Validação e dados operacionais">
          {selected ? (
            <div className="space-y-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted">{selected.id}</p>
                <h2 className="mt-1 text-xl font-black text-navy-950">{selected.fullName}</h2>
                <p className="text-sm text-muted">{selected.email} • {selected.primaryPhone}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <InfoLine label="CPF" value={selected.cpf} />
                <InfoLine label="CNPJ" value={selected.cnpj} />
                <InfoLine label="Treinamento" value={selected.trainingStartDate} />
                <InfoLine label="Preferência" value={selected.preferredSchedule} />
                <InfoLine label="Senha cadastrada" value={selected.hasPassword ? "Sim" : "Não"} />
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-700">
                <LockKeyhole className="mr-2 inline h-4 w-4" />
                Dados pessoais, bancários e familiares só aparecem para perfis autorizados.
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {[
                  ["WB/Login", "wbLogin"],
                  ["LOB", "lob"],
                  ["Time", "team"],
                  ["Supervisor", "supervisor"],
                  ["Turno", "shift"],
                  ["Cronograma", "schedule"],
                  ["Cargo/Função", "roleTitle"],
                  ["Status", "employeeStatus"],
                  ["Contrato", "contractType"],
                  ["Admissão", "admissionDate"],
                  ["Treinamento", "trainingDate"],
                  ["Site/Operação", "site"]
                ].map(([label, key]) => (
                  <label key={key} className="block">
                    <span className="mb-1 block text-xs font-bold text-muted">{label}</span>
                    {key === "lob" || key === "shift" || key === "roleTitle" || key === "employeeStatus" ? (
                      <select value={operational[key as keyof typeof operational]} onChange={(event) => setOperational({ ...operational, [key]: event.target.value })} className="h-10 w-full rounded-lg border border-border px-3 text-sm outline-none">
                        {(key === "lob" ? registrationLobOptions : key === "shift" ? registrationShiftOptions : key === "roleTitle" ? registrationRoleTitleOptions : employeeOperationalStatusOptions).map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    ) : (
                      <input value={operational[key as keyof typeof operational]} onChange={(event) => setOperational({ ...operational, [key]: event.target.value })} className="h-10 w-full rounded-lg border border-border px-3 text-sm outline-none" />
                    )}
                  </label>
                ))}
              </div>
              <label className="block">
                <span className="mb-1 block text-xs font-bold text-muted">Justificativa / observações de revisão</span>
                <textarea value={reviewNotes} onChange={(event) => setReviewNotes(event.target.value)} className="min-h-24 w-full rounded-lg border border-border p-3 text-sm outline-none" />
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button disabled={!!reviewingAction || selectedReviewClosed || selected.hasPassword === false} onClick={() => review("approve")} className="rounded-lg bg-emerald-600 px-3 py-3 text-sm font-bold text-white disabled:opacity-50">{reviewingAction === "approve" ? "Aprovando..." : "Aprovar"}</button>
                <button disabled={!!reviewingAction || selectedReviewClosed} onClick={() => review("request_adjustment")} className="rounded-lg bg-amber-500 px-3 py-3 text-sm font-bold text-white disabled:opacity-50">{reviewingAction === "request_adjustment" ? "Enviando..." : "Solicitar ajuste"}</button>
                <button disabled={!!reviewingAction || selectedReviewClosed} onClick={() => review("reject")} className="rounded-lg bg-red-600 px-3 py-3 text-sm font-bold text-white disabled:opacity-50">{reviewingAction === "reject" ? "Recusando..." : "Recusar"}</button>
              </div>
              <button disabled={deletingRegistration} onClick={deleteRegistration} className="w-full rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-sm font-bold text-red-700 disabled:opacity-50">
                {deletingRegistration ? "Removendo..." : selected.status === "Aprovado" || selected.status === "Ativo" ? "Inativar cadastro" : "Excluir cadastro"}
              </button>
              <div className="rounded-lg border border-border bg-slate-50 p-3">
                <p className="mb-2 text-sm font-bold text-navy-950">Histórico</p>
                {(selected.history ?? []).slice(0, 4).map((event) => (
                  <p key={`${event.at}-${event.action}`} className="text-xs text-muted">{event.at} • {event.actor}: {event.action}{event.notes ? ` (${event.notes})` : ""}</p>
                ))}
              </div>
            </div>
          ) : (
            <EmptyState title="Nenhum cadastro selecionado" description="Quando um colaborador enviar cadastro, a análise aparecerá aqui." />
          )}
        </Panel>
      </div>
      {showEmployeeImport ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4 backdrop-blur-sm">
          <div className="card max-h-[88vh] w-full max-w-5xl overflow-y-auto p-5">
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-extrabold text-navy-950">Importar colaboradores</h2>
                <p className="text-sm text-muted">{employeeImportFileName || "Arquivo Excel"} • preview antes de salvar</p>
              </div>
              <button onClick={() => setShowEmployeeImport(false)} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-slate-100">×</button>
            </div>
            {importingEmployees && !employeeImportPreview ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700">
                  Validando arquivo... Aguarde enquanto leio a planilha e confiro as linhas.
                </div>
                <EmptyState title="Processando importação" description="O preview aparecerá aqui assim que a validação terminar." />
              </div>
            ) : employeeImportError && !employeeImportPreview ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
                  {employeeImportError}
                </div>
                <EmptyState title="Não foi possível validar o arquivo" description="Revise a aba colaboradores e os cabeçalhos mínimos, depois selecione o arquivo novamente." />
              </div>
            ) : employeeImportPreview ? (
              <div className="space-y-5">
                <div className="grid gap-3 md:grid-cols-4">
                  <MetricPill value={employeeImportPreview.totalRows} label="Total de linhas" />
                  <MetricPill value={employeeImportPreview.validRows} label="Linhas válidas" />
                  <MetricPill value={employeeImportPreview.errorRows} label="Linhas com erro" />
                  <MetricPill value={employeeImportPreview.warningRows ?? employeeImportPreview.rows.filter((row) => !row.errors.length && row.warnings.length).length} label="Linhas com alerta" />
                  <MetricPill value={employeeImportPreview.usuariosCriar ?? employeeImportPreview.rows.filter((row) => !row.errors.length && row.preview.createUser).length} label="Usuários a criar" />
                  <MetricPill value={employeeImportPreview.colaboradoresCriar ?? employeeImportPreview.rows.filter((row) => !row.errors.length && row.action === "criar").length} label="Funcionários a criar" />
                  <MetricPill value={employeeImportPreview.registrosAtualizar ?? employeeImportPreview.rows.filter((row) => !row.errors.length && row.action === "atualizar").length} label="Atualizações" />
                  <MetricPill value={employeeImportPreview.duplicidades ?? employeeImportPreview.rows.filter((row) => [...row.errors, ...row.warnings].some((message) => /duplic|existente|uso/i.test(message))).length} label="Duplicidades" />
                </div>
                {employeeImportPreview.errorRows ? (
                  <label className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-700">
                    <input type="checkbox" checked={allowPartialEmployeeImport} onChange={(event) => setAllowPartialEmployeeImport(event.target.checked)} />
                    Importar somente linhas válidas e ignorar linhas com erro
                  </label>
                ) : null}
                <SimpleTable
                  columns={["Linha", "Nome", "WB/Login", "E-mail", "Status", "Ação", "CPF", "Role", "LOB", "Usuário", "Validação"]}
                  rows={employeeImportPreview.rows.slice(0, 80).map((row) => [
                    row.rowNumber,
                    row.preview.name || "-",
                    row.preview.wbLogin || "-",
                    row.preview.email || "-",
                    <StatusBadge key={`${row.rowNumber}-status`} status={row.status ?? (row.errors.length ? "Erro" : row.warnings.length ? "Alerta" : "Válida")} />,
                    row.action ?? (row.errors.length ? "ignorar" : "criar"),
                    row.preview.cpf || "CPF pendente",
                    row.preview.role || "-",
                    row.preview.lob || "-",
                    row.preview.createUser ? (row.preview.passwordProvided ? "Sim" : "Senha ausente") : "Não",
                    row.errors.length ? (
                      <div key={`${row.rowNumber}-errors`} className="space-y-1 text-xs font-bold text-red-600">
                        {row.errors.map((error) => <p key={error}>{error}</p>)}
                      </div>
                    ) : row.warnings.length ? (
                      <div key={`${row.rowNumber}-warnings`} className="space-y-1 text-xs font-bold text-amber-600">
                        {row.warnings.map((warning) => <p key={warning}>{warning}</p>)}
                      </div>
                    ) : <StatusBadge key={`${row.rowNumber}-ok`} status="Válida" />
                  ])}
                />
                <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700">
                  CPF vazio é permitido e aparece como CPF pendente. Quando `criar_usuario = sim`, a coluna `senha_temporaria` é obrigatória e será salva apenas como hash. O Admin deve comunicar a senha manualmente.
                </div>
                <div className="flex flex-wrap justify-end gap-3">
                  <button onClick={() => setShowEmployeeImport(false)} className="rounded-lg border border-border px-4 py-3 text-sm font-bold">Cancelar</button>
                  <button
                    disabled={importingEmployees || (!allowPartialEmployeeImport && employeeImportPreview.errorRows > 0)}
                    onClick={confirmEmployeeImport}
                    className="rounded-lg bg-blue-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-50"
                  >
                    {importingEmployees ? "Importando..." : "Confirmar importação"}
                  </button>
                </div>
              </div>
            ) : <EmptyState title="Nenhum preview disponível" description="Selecione um arquivo de colaboradores para validar antes da importação." />}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function SchedulesPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [previewRows, setPreviewRows] = useState<Array<Record<string, unknown>>>([]);
  const [previewResult, setPreviewResult] = useState<ImportPreview | null>(null);
  const [previewFileName, setPreviewFileName] = useState("upload.xlsx");
  const [showPreview, setShowPreview] = useState(false);
  const [showAttendance, setShowAttendance] = useState(false);
  const [showEditSchedule, setShowEditSchedule] = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [downloadingScheduleTemplate, setDownloadingScheduleTemplate] = useState(false);
  const [imported, setImported] = useState("");
  const [scheduleRows, setScheduleRows] = useState<ScheduleGridRow[]>([]);
  const [scheduleEmployees, setScheduleEmployees] = useState<EmployeeClient[]>([]);
  const [scheduleEmployeeSearchResults, setScheduleEmployeeSearchResults] = useState<EmployeeClient[]>([]);
  const [scheduleEmployeeSearch, setScheduleEmployeeSearch] = useState("");
  const [loadingScheduleEmployeeSearch, setLoadingScheduleEmployeeSearch] = useState(false);
  const [scheduleSettings, setScheduleSettings] = useState<SystemSettings | null>(null);
  const [importHistory, setImportHistory] = useState<ScheduleImportHistory[]>([]);
  const [showScheduleAlerts, setShowScheduleAlerts] = useState(false);
  const [showScheduleImports, setShowScheduleImports] = useState(false);
  const [showPendingJustifications, setShowPendingJustifications] = useState(false);
  const [attendanceMessage, setAttendanceMessage] = useState("");
  const [attendanceSummary, setAttendanceSummary] = useState<AttendanceSummary | null>(null);
  const [pendingJustifications, setPendingJustifications] = useState<AttendanceItem[]>([]);
  const [scheduleActorRole, setScheduleActorRole] = useState("COLABORADOR");
  const [schedulePeriod, setSchedulePeriod] = useState({ month: 5, year: 2026 });
  const [scheduleRangeMode, setScheduleRangeMode] = useState<ScheduleRangeMode>("month");
  const [scheduleDateRange, setScheduleDateRange] = useState(monthRange(5, 2026));
  const [scheduleDateError, setScheduleDateError] = useState("");
  const [scheduleDateColumns, setScheduleDateColumns] = useState<string[]>([]);
  const [schedulePagination, setSchedulePagination] = useState({ page: 1, limit: 75, total: 0, totalPages: 1 });
  const [scheduleFilters, setScheduleFilters] = useState({ collaborator: "", lob: "Todos", supervisor: "", shift: "Todos", status: "Todos", roleTitle: "" });
  const [scheduleEditForm, setScheduleEditForm] = useState({
    scheduleId: "",
    employeeId: "",
    date: "2026-05-01",
    shift: "Manhã",
    startsAt: "06:00",
    endsAt: "14:00",
    status: "Escalado",
    lob: "",
    supervisor: "",
    observation: "",
    pendingJustification: false
  });
  const [workHourForm, setWorkHourForm] = useState({
    recordId: "",
    plannedStart: "",
    plannedEnd: "",
    plannedHours: 0,
    actualStart: "",
    actualEnd: "",
    breakMinutes: "0",
    actualHours: "",
    effectiveBreakMinutes: 0,
    effectiveHours: 0,
    differenceMinutes: 0,
    status: "Sem horas",
    rawStatus: "",
    source: "",
    observation: "",
    adjustmentId: "",
    adjustmentStatus: "Sem ajuste"
  });
  const [savingWorkHour, setSavingWorkHour] = useState(false);
  const [workHourAdjustmentForm, setWorkHourAdjustmentForm] = useState({
    requestedActualStart: "",
    requestedActualEnd: "",
    requestedBreakMinutes: "0",
    requestedActualHours: "",
    reason: "Erro de apontamento",
    justification: ""
  });
  const [savingWorkHourAdjustment, setSavingWorkHourAdjustment] = useState(false);
  const [attendanceForm, setAttendanceForm] = useState({
    employeeId: "",
    date: "2026-05-15",
    shift: "Manhã",
    status: "Ausente",
    absenceReason: "Problema técnico",
    reasonCategory: "Ferramenta",
    supervisorJustification: "Impacto registrado durante o turno; aguardando normalização.",
    hasEvidence: false,
    evidenceUrl: "",
    impactsAbs: true,
    impactsCoverage: true
  });

  useEffect(() => {
    void refreshSchedules(1);
    void refreshAttendanceForSchedulePeriod();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedulePeriod.month, schedulePeriod.year, scheduleFilters.lob]);

  useEffect(() => {
    void loadScheduleSupportData();
  }, []);

  useEffect(() => {
    const query = scheduleEmployeeSearch.trim();
    if (query.length < 2) {
      setScheduleEmployeeSearchResults([]);
      setLoadingScheduleEmployeeSearch(false);
      return;
    }

    const timeout = window.setTimeout(() => {
      setLoadingScheduleEmployeeSearch(true);
      apiJson<EmployeeListResponse>(`/api/employees?search=${encodeURIComponent(query)}&limit=50`)
        .then((payload) => setScheduleEmployeeSearchResults(payload.data.filter((employee) => employee.status !== "Inativo").map((employee) => ({ ...employee, shift: cleanShiftName(employee.shift) || "Manhã" }))))
        .catch(() => setScheduleEmployeeSearchResults([]))
        .finally(() => setLoadingScheduleEmployeeSearch(false));
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [scheduleEmployeeSearch]);

  async function loadScheduleSupportData() {
    try {
      const [employeePayload, settingsPayload] = await Promise.all([
        apiJson<{ data: EmployeeClient[] }>("/api/employees"),
        apiJson<{ data: SystemSettings }>("/api/settings")
      ]);
      const activeEmployees = employeePayload.data
        .filter((employee) => employee.status !== "Inativo")
        .map((employee) => ({ ...employee, shift: cleanShiftName(employee.shift) || "Manhã" }));
      setScheduleEmployees(activeEmployees);
      setScheduleSettings(settingsPayload.data);
      if (activeEmployees.length) {
        setAttendanceForm((current) => current.employeeId ? current : { ...current, employeeId: activeEmployees[0].id, shift: activeEmployees[0].shift });
        setScheduleEditForm((current) => current.employeeId ? current : { ...current, employeeId: activeEmployees[0].id, shift: activeEmployees[0].shift, lob: activeEmployees[0].lob, supervisor: activeEmployees[0].supervisor });
      }
    } catch {
      setScheduleEmployees([]);
    }
  }

  async function refreshSchedules(pageOverride = schedulePagination.page, filtersOverride = scheduleFilters, rangeOverride = scheduleDateRange) {
    try {
      const params = new URLSearchParams({
        month: String(schedulePeriod.month),
        year: String(schedulePeriod.year),
        startDate: rangeOverride.startDate,
        endDate: rangeOverride.endDate,
        page: String(pageOverride),
        limit: String(schedulePagination.limit),
        collaborator: filtersOverride.collaborator,
        lob: filtersOverride.lob,
        supervisor: filtersOverride.supervisor,
        shift: filtersOverride.shift,
        status: filtersOverride.status,
        roleTitle: filtersOverride.roleTitle
      });
      const payload = await apiJson<{ data: { scheduleGridRows: typeof scheduleRows; imports: ScheduleImportHistory[]; attendanceSummary?: AttendanceSummary; daysInMonth?: number; dateColumns?: string[]; pagination?: { page: number; limit: number; total: number; totalPages: number } }; actor?: { role: string; name: string } }>(`/api/schedules?${params.toString()}`);
      setScheduleActorRole(payload.actor?.role ?? "COLABORADOR");
      setScheduleRows(payload.data.scheduleGridRows);
      setSchedulePagination(payload.data.pagination ?? { page: pageOverride, limit: schedulePagination.limit, total: payload.data.scheduleGridRows.length, totalPages: 1 });
      setScheduleDateColumns(payload.data.dateColumns ?? []);
      if (payload.data.scheduleGridRows.length) {
        setAttendanceForm((current) => payload.data.scheduleGridRows.some((row) => row.employee.id === current.employeeId) ? current : { ...current, employeeId: payload.data.scheduleGridRows[0].employee.id });
        setScheduleEditForm((current) => payload.data.scheduleGridRows.some((row) => row.employee.id === current.employeeId) ? current : { ...current, employeeId: payload.data.scheduleGridRows[0].employee.id, lob: payload.data.scheduleGridRows[0].employee.lob, supervisor: payload.data.scheduleGridRows[0].employee.supervisor });
      }
      setImportHistory(payload.data.imports);
      setAttendanceSummary(payload.data.attendanceSummary ?? null);
      void refreshAttendanceForSchedulePeriod(rangeOverride, filtersOverride);
    } catch {
      setScheduleRows([]);
      setScheduleDateColumns([]);
      setSchedulePagination((current) => ({ ...current, page: 1, total: 0, totalPages: 1 }));
    }
  }

  async function refreshAttendanceForSchedulePeriod(rangeOverride = scheduleDateRange, filtersOverride = scheduleFilters) {
    const params = new URLSearchParams({
      month: String(schedulePeriod.month),
      year: String(schedulePeriod.year),
      startDate: rangeOverride.startDate,
      endDate: rangeOverride.endDate
    });
    if (filtersOverride.lob !== "Todos") params.set("lob", filtersOverride.lob);
    if (filtersOverride.supervisor.trim()) params.set("supervisor", filtersOverride.supervisor.trim());
    if (filtersOverride.shift !== "Todos") params.set("shift", filtersOverride.shift);
    if (filtersOverride.collaborator.trim()) params.set("collaborator", filtersOverride.collaborator.trim());
    try {
      const payload = await apiJson<{ data: AttendanceItem[]; summary: AttendanceSummary }>(`/api/attendance?${params.toString()}`);
      setAttendanceSummary(payload.summary);
      setPendingJustifications(payload.data.filter((record) => statusNeedsReason(record.status) && record.isJustified === false));
    } catch {
      setPendingJustifications([]);
    }
  }

  function moveScheduleMonth(delta: number) {
    const next = new Date(Date.UTC(schedulePeriod.year, schedulePeriod.month - 1 + delta, 1));
    const nextPeriod = { month: next.getUTCMonth() + 1, year: next.getUTCFullYear() };
    setSchedulePeriod(nextPeriod);
    if (scheduleRangeMode !== "custom") setScheduleDateRange(rangeForScheduleMode(scheduleRangeMode, nextPeriod, scheduleDateRange.startDate));
  }

  function updateSchedulePeriod(nextPeriod: { month: number; year: number }) {
    setSchedulePeriod(nextPeriod);
    if (scheduleRangeMode !== "custom") setScheduleDateRange(rangeForScheduleMode(scheduleRangeMode, nextPeriod, scheduleDateRange.startDate));
  }

  function applyScheduleQuickRange(mode: ScheduleRangeMode) {
    const nextRange = rangeForScheduleMode(mode, schedulePeriod, scheduleDateRange.startDate);
    setScheduleRangeMode(mode);
    setScheduleDateRange(nextRange);
    setScheduleDateError("");
    void refreshSchedules(1, scheduleFilters, nextRange);
  }

  function applyScheduleDateRange() {
    if (isInvalidDateRange(scheduleDateRange)) {
      setScheduleDateError("Data inicial não pode ser maior que data final.");
      return;
    }
    setScheduleRangeMode("custom");
    setScheduleDateError("");
    void refreshSchedules(1, scheduleFilters, scheduleDateRange);
  }

  function applyScheduleFilters() {
    if (isInvalidDateRange(scheduleDateRange)) {
      setScheduleDateError("Data inicial não pode ser maior que data final.");
      return;
    }
    setScheduleDateError("");
    void refreshSchedules(1, scheduleFilters, scheduleDateRange);
  }

  function clearScheduleFilters() {
    const clearedFilters = { collaborator: "", lob: "Todos", supervisor: "", shift: "Todos", status: "Todos", roleTitle: "" };
    const clearedRange = monthRange(schedulePeriod.month, schedulePeriod.year);
    setScheduleFilters(clearedFilters);
    setScheduleRangeMode("month");
    setScheduleDateRange(clearedRange);
    setScheduleDateError("");
    void refreshSchedules(1, clearedFilters, clearedRange);
  }

  async function handleFile(file?: File) {
    if (!file) return;
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
    const formData = new FormData();
    formData.append("file", file);
    const preview = await apiJson<ImportPreview>("/api/schedules/import/preview", { method: "POST", body: formData });
    setPreviewFileName(file.name);
    setPreviewResult(preview);
    setPreviewRows(preview.rows.length ? preview.rows : rows.slice(0, 8));
    setShowPreview(true);
  }

  async function commitImport() {
    const result = await apiJson<{ data: { fileName: string; importedRows: number; status: string; createdAt: string; user: string }; preview: ImportPreview }>("/api/schedules/import/commit", {
      method: "POST",
      body: JSON.stringify({ fileName: previewFileName, allowPartial: true, rows: previewRows })
    });
    setImported(`${result.data.status}. ${result.data.importedRows} linhas registradas em auditoria.`);
    setImportHistory((items) => [result.data as (typeof importHistory)[number], ...items]);
    setShowPreview(false);
    await refreshSchedules();
  }

  function openScheduleEditor(row?: ScheduleGridRow, dayIndex = 0, value = "Escalado") {
    const targetRow = row ?? scheduleRows[0];
    const targetEmployee = targetRow?.employee ?? scheduleEmployees[0];
    if (!targetEmployee) {
      setAttendanceMessage("Nenhum colaborador ativo encontrado para receber cronograma.");
      return;
    }
    const cellStatus = statusFromScheduleCell(value);
    const employeeShift = cleanShiftName(targetEmployee.shift) || "Manhã";
    const cellShift = cleanShiftName(value);
    const shift = cellStatus === "Escalado" ? (availableShiftNames.includes(cellShift) ? cellShift : employeeShift) : employeeShift;
    const times = configuredTimesForShift(shift);
    const plannedCell = targetRow?.plannedTimes?.[dayIndex] ?? null;
    const hourCell = targetRow?.workHours?.[dayIndex] ?? null;
    const plannedStart = plannedCell?.startsAt || (statusNeedsTime(cellStatus) ? times.startsAt : "");
    const plannedEnd = plannedCell?.endsAt || (statusNeedsTime(cellStatus) ? times.endsAt : "");
    const plannedHours = plannedStart && plannedEnd ? roundDecimal(minutesBetweenTimes(plannedStart, plannedEnd) / 60) : 0;
    setScheduleEmployeeSearch(employeeOptionLabel(targetEmployee));
    setScheduleEditForm({
      scheduleId: plannedCell?.scheduleId ?? "",
      employeeId: targetEmployee.id,
      date: visibleScheduleDates[dayIndex] ?? `${schedulePeriod.year}-${String(schedulePeriod.month).padStart(2, "0")}-${String(dayIndex + 1).padStart(2, "0")}`,
      shift: cleanShiftName(shift) || "Manhã",
      startsAt: statusNeedsTime(cellStatus) ? plannedStart : "",
      endsAt: statusNeedsTime(cellStatus) ? plannedEnd : "",
      status: cellStatus,
      lob: targetEmployee.lob,
      supervisor: targetEmployee.supervisor,
      observation: plannedCell?.observation ?? "",
      pendingJustification: false
    });
    setWorkHourForm({
      recordId: hourCell?.id ?? "",
      plannedStart: hourCell?.plannedStart || plannedStart,
      plannedEnd: hourCell?.plannedEnd || plannedEnd,
      plannedHours: hourCell?.plannedHours ?? plannedHours,
      actualStart: hourCell?.actualStart ?? "",
      actualEnd: hourCell?.actualEnd ?? "",
      breakMinutes: String(hourCell?.breakMinutes ?? hourCell?.effectiveBreakMinutes ?? 0),
      actualHours: hourCell?.actualHours ? String(hourCell.actualHours) : "",
      effectiveBreakMinutes: hourCell?.effectiveBreakMinutes ?? hourCell?.breakMinutes ?? 0,
      effectiveHours: hourCell?.effectiveHours ?? 0,
      differenceMinutes: hourCell?.differenceMinutes ?? 0,
      status: hourCell?.status ?? (plannedCell ? "Sem horas" : "Sem cronograma"),
      rawStatus: hourCell?.rawStatus ?? "",
      source: hourCell?.source ?? "",
      observation: hourCell?.observation ?? "",
      adjustmentId: hourCell?.adjustmentId ?? "",
      adjustmentStatus: hourCell?.adjustmentStatus ?? "Sem ajuste"
    });
    setWorkHourAdjustmentForm({
      requestedActualStart: hourCell?.actualStart ?? "",
      requestedActualEnd: hourCell?.actualEnd ?? "",
      requestedBreakMinutes: String(hourCell?.effectiveBreakMinutes ?? hourCell?.breakMinutes ?? 0),
      requestedActualHours: hourCell?.actualHours ? String(hourCell.actualHours) : "",
      reason: "Erro de apontamento",
      justification: ""
    });
    setShowEditSchedule(true);
  }

  function closeScheduleEditor() {
    setShowEditSchedule(false);
    setScheduleEmployeeSearch("");
    setScheduleEmployeeSearchResults([]);
  }

  function openPendingJustification(record: AttendanceItem) {
    setAttendanceForm({
      ...attendanceForm,
      employeeId: record.employeeId,
      date: record.dateIso ?? record.date,
      shift: cleanShiftName(record.shift) || "Manhã",
      status: statusFromScheduleCell(record.status),
      absenceReason: record.absenceReason === "Sem justificativa" ? "" : record.absenceReason ?? "",
      reasonCategory: record.reasonCategory ?? "Operacional",
      supervisorJustification: "",
      impactsAbs: record.impactsAbs,
      impactsCoverage: record.impactsCoverage
    });
    setShowAttendance(true);
  }

  function openAttendanceJustification(row?: ScheduleGridRow, dayIndex = 0, value = "Ausente") {
    const targetRow = row ?? scheduleRows[0];
    const targetEmployee = targetRow?.employee ?? scheduleEmployees[0];
    if (!targetEmployee) {
      setAttendanceMessage("Nenhum colaborador ativo encontrado para justificar ocorrência.");
      return;
    }
    const cellStatus = statusFromScheduleCell(value);
    const safeStatus = supervisorOccurrenceStatuses.includes(cellStatus) ? cellStatus : "Ausente";
    setAttendanceForm({
      ...attendanceForm,
      employeeId: targetEmployee.id,
      date: visibleScheduleDates[dayIndex] ?? `${schedulePeriod.year}-${String(schedulePeriod.month).padStart(2, "0")}-${String(dayIndex + 1).padStart(2, "0")}`,
      shift: cleanShiftName(targetEmployee.shift) || "Manhã",
      status: safeStatus,
      absenceReason: attendanceForm.absenceReason || "Outros",
      reasonCategory: attendanceForm.reasonCategory || "Cronograma",
      supervisorJustification: "",
      impactsAbs: ["Falta", "Ausente"].includes(safeStatus),
      impactsCoverage: ["Ausente", "Falta", "Atraso", "Saída antecipada", "Afastado", "Erro de cronograma"].includes(safeStatus)
    });
    setShowAttendance(true);
  }

  async function saveScheduleEdit() {
    if (!scheduleEditForm.employeeId) {
      setAttendanceMessage("Selecione um colaborador.");
      return;
    }
    if (!scheduleEditForm.date || !scheduleEditForm.status) {
      setAttendanceMessage("Data e status são obrigatórios.");
      return;
    }
    if (statusNeedsTime(scheduleEditForm.status) && (!scheduleEditForm.shift || !scheduleEditForm.startsAt || !scheduleEditForm.endsAt)) {
      setAttendanceMessage("Turno, entrada e saída são obrigatórios para Escalado, Presente ou Nesting.");
      return;
    }
    if (statusNeedsReason(scheduleEditForm.status) && !scheduleEditForm.observation.trim() && !scheduleEditForm.pendingJustification) {
      setAttendanceMessage("Informe uma observação ou marque como sem justificativa no momento.");
      return;
    }

    setSavingSchedule(true);
    try {
      const payload = await apiJson<{ data: unknown; summary: AttendanceSummary; schedules: { scheduleGridRows: typeof scheduleGridRows; attendanceSummary?: AttendanceSummary } }>("/api/schedules", {
        method: "PATCH",
        body: JSON.stringify(scheduleEditForm)
      });
      setAttendanceSummary(payload.schedules.attendanceSummary ?? payload.summary);
      setAttendanceMessage("Cronograma atualizado com histórico, auditoria e indicadores de presença/cobertura.");
      closeScheduleEditor();
      await refreshSchedules();
    } catch (error) {
      setAttendanceMessage(error instanceof Error ? error.message : "Não foi possível editar o cronograma.");
    } finally {
      setSavingSchedule(false);
    }
  }

  async function saveManualWorkHours(confirmOverwrite = false) {
    if (!scheduleEditForm.employeeId || !scheduleEditForm.date) {
      setAttendanceMessage("Colaborador e data são obrigatórios para lançar horas.");
      return;
    }
    if (!workHourForm.actualStart || !workHourForm.actualEnd) {
      setAttendanceMessage("Entrada real e saída real são obrigatórias.");
      return;
    }
    const parsedBreakMinutes = Number(workHourForm.breakMinutes.replace(",", ".") || 0);
    if (!Number.isFinite(parsedBreakMinutes) || parsedBreakMinutes < 0) {
      setAttendanceMessage("Pausa deve ser um número válido e não pode ser negativa.");
      return;
    }
    if (parsedBreakMinutes > minutesBetweenTimes(workHourForm.actualStart, workHourForm.actualEnd)) {
      setAttendanceMessage("A pausa não pode ser maior que o período entre entrada e saída.");
      return;
    }
    if (workHourForm.recordId && workHourForm.source && !/^manual$/i.test(workHourForm.source) && !confirmOverwrite) {
      const confirmed = window.confirm("Já existe um registro de horas importado para este dia. Deseja sobrescrever manualmente?");
      if (!confirmed) return;
      return saveManualWorkHours(true);
    }

    setSavingWorkHour(true);
    try {
      const payload = await apiJson<{ data: WorkHourRow; message?: string; warning?: string }>("/api/work-hours/manual", {
        method: "POST",
        body: JSON.stringify({
          employeeId: scheduleEditForm.employeeId,
          date: scheduleEditForm.date,
          actualStart: workHourForm.actualStart,
          actualEnd: workHourForm.actualEnd,
          breakMinutes: parsedBreakMinutes,
          actualHours: workHourForm.actualHours ? Number(workHourForm.actualHours.replace(",", ".")) : undefined,
          observation: workHourForm.observation,
          source: "MANUAL",
          confirmOverwrite
        })
      });
      setWorkHourForm({
        recordId: payload.data.id,
        plannedStart: payload.data.plannedStart,
        plannedEnd: payload.data.plannedEnd,
        plannedHours: payload.data.plannedHours,
        actualStart: payload.data.actualStart,
        actualEnd: payload.data.actualEnd,
        breakMinutes: String(payload.data.breakMinutes ?? 0),
        actualHours: String(payload.data.actualHours),
        effectiveBreakMinutes: payload.data.effectiveBreakMinutes ?? payload.data.breakMinutes ?? 0,
        effectiveHours: payload.data.effectiveHours,
        differenceMinutes: payload.data.differenceMinutes,
        status: payload.data.status,
        rawStatus: payload.data.rawStatus ?? "",
        source: payload.data.source,
        observation: payload.data.observation,
        adjustmentId: payload.data.adjustmentId ?? "",
        adjustmentStatus: payload.data.adjustmentStatus
      });
      setAttendanceMessage(payload.warning ? `${payload.message ?? "Horas salvas."} ${payload.warning}` : payload.message ?? "Horas salvas.");
      await refreshSchedules();
    } catch (error) {
      setAttendanceMessage(error instanceof Error ? error.message : "Não foi possível salvar as horas.");
    } finally {
      setSavingWorkHour(false);
    }
  }

  async function requestScheduleWorkHourAdjustment() {
    if (!workHourForm.recordId) {
      setAttendanceMessage("Ainda não existe registro de horas para solicitar ajuste. WFM/Admin precisa lançar ou importar as horas primeiro.");
      return;
    }
    if (!workHourAdjustmentForm.reason.trim() || !workHourAdjustmentForm.justification.trim()) {
      setAttendanceMessage("Motivo e justificativa são obrigatórios para solicitar ajuste de horas.");
      return;
    }
    setSavingWorkHourAdjustment(true);
    try {
      await apiJson("/api/work-hours", {
        method: "POST",
        body: JSON.stringify({
          workHourRecordId: workHourForm.recordId,
          requestedActualStart: workHourAdjustmentForm.requestedActualStart || undefined,
          requestedActualEnd: workHourAdjustmentForm.requestedActualEnd || undefined,
          requestedBreakMinutes: workHourAdjustmentForm.requestedBreakMinutes ? Number(workHourAdjustmentForm.requestedBreakMinutes.replace(",", ".")) : undefined,
          requestedActualHours: workHourAdjustmentForm.requestedActualHours ? Number(workHourAdjustmentForm.requestedActualHours.replace(",", ".")) : undefined,
          reason: workHourAdjustmentForm.reason,
          justification: workHourAdjustmentForm.justification
        })
      });
      setAttendanceMessage("Ajuste de horas solicitado para análise do WFM/Admin.");
      closeScheduleEditor();
      await refreshSchedules();
    } catch (error) {
      setAttendanceMessage(error instanceof Error ? error.message : "Não foi possível solicitar ajuste de horas.");
    } finally {
      setSavingWorkHourAdjustment(false);
    }
  }

  async function removeSelectedEmployeeSchedule(scope: "month" | "all" = "month") {
    if (!scheduleEditForm.employeeId) return;
    const confirmed = window.confirm(scope === "all" ? "Isso removerá todos os cronogramas deste colaborador, mas não excluirá o cadastro. Continuar?" : "Isso removerá os registros de cronograma deste colaborador no mês selecionado, mas não excluirá o cadastro. Continuar?");
    if (!confirmed) return;

    setSavingSchedule(true);
    try {
      const payload = await apiJson<{ message: string }>("/api/schedules", {
        method: "DELETE",
        body: JSON.stringify({ employeeId: scheduleEditForm.employeeId, month: schedulePeriod.month, year: schedulePeriod.year, scope })
      });
      setAttendanceMessage(payload.message ?? "Cronograma removido.");
      closeScheduleEditor();
      await refreshSchedules();
    } catch (error) {
      setAttendanceMessage(error instanceof Error ? error.message : "Não foi possível remover o cronograma do colaborador.");
    } finally {
      setSavingSchedule(false);
    }
  }

  async function saveAttendance() {
    if (statusNeedsReason(attendanceForm.status) && !attendanceForm.absenceReason.trim() && !attendanceForm.supervisorJustification.trim()) {
      setAttendanceMessage("Motivo/observação obrigatório para ausência, falta, atraso, saída antecipada, afastado ou erro de cronograma.");
      return;
    }

    try {
      const payload = await apiJson<{ data: Partial<AttendanceItem>; summary: AttendanceSummary }>("/api/attendance", {
        method: "POST",
        body: JSON.stringify(attendanceForm)
      });
      setAttendanceSummary(payload.summary);
      const employeeName = payload.data.employeeName ?? scheduleRows.find((row) => row.employee.id === attendanceForm.employeeId)?.employee.name ?? attendanceForm.employeeId;
      setAttendanceMessage(`${employeeName}: ${payload.data.status ?? attendanceForm.status} registrado. ABS/cobertura/auditoria atualizados.`);
      setShowAttendance(false);
      await refreshSchedules();
    } catch (error) {
      setAttendanceMessage(error instanceof Error ? error.message : "Não foi possível salvar presença/ausência.");
    }
  }

  const validation = previewResult
    ? { errors: previewResult.errorRows, warnings: previewResult.validation.reduce((total, row) => total + row.warnings.length, 0) }
    : validateImportRows(previewRows);
  const attendanceRequiresReason = statusNeedsReason(attendanceForm.status);
  const scheduleEditRequiresReason = statusNeedsReason(scheduleEditForm.status);
  const scheduleEditRequiresTime = statusNeedsTime(scheduleEditForm.status);
  const scheduleCellValues = scheduleRows.flatMap((row) => row.days);
  const scheduledCells = scheduleCellValues.filter((value) => !["Folga", "Sem cronograma", "Férias"].includes(value)).length;
  const conflictCount = scheduleCellValues.filter((value) => value === "Conflito").length;
  const unscheduledCount = scheduleCellValues.filter((value) => value === "Sem cronograma" || value === "Descoberto").length;
  const scheduleAlertItems = ([
    conflictCount > 0 ? {
      title: `${conflictCount} conflitos de cronograma`,
      status: String(conflictCount),
      tone: "red" as const,
      detail: "Revise células marcadas como conflito no período selecionado."
    } : null,
    unscheduledCount > 0 ? {
      title: `${unscheduledCount} células sem cronograma/descobertas`,
      status: String(unscheduledCount),
      tone: "orange" as const,
      detail: "Há dias sem cronograma vinculado ou descoberta nos filtros atuais."
    } : null,
    pendingJustifications.length > 0 ? {
      title: `${pendingJustifications.length} justificativas pendentes`,
      status: String(pendingJustifications.length),
      tone: "orange" as const,
      detail: "Faltas, ausências ou atrasos aguardando justificativa do supervisor."
    } : null,
    ...importHistory
      .filter((file) => (file.errorRows ?? 0) > 0 || (file.warningRows ?? 0) > 0 || /erro|falha|partial|parcial/i.test(file.status))
      .map((file) => ({
        title: `Importação com alerta: ${file.fileName}`,
        status: file.status,
        tone: ((file.errorRows ?? 0) > 0 || /erro|falha/i.test(file.status) ? "red" : "orange") as "red" | "orange",
        detail: `${file.errorRows ?? 0} erro(s), ${file.warningRows ?? 0} alerta(s), ${file.importedRows} linha(s) válidas.`
      }))
  ] as Array<ScheduleAlertItem | null>).filter((item): item is ScheduleAlertItem => item !== null);
  const plannedHours = scheduledCells * 8;
  const scheduleTotalRows = schedulePagination.total || scheduleRows.length;
  const schedulePageStart = scheduleTotalRows && scheduleRows.length ? (schedulePagination.page - 1) * schedulePagination.limit + 1 : 0;
  const schedulePageEnd = scheduleTotalRows ? Math.min(schedulePagination.page * schedulePagination.limit, scheduleTotalRows) : 0;
  const monthLabel = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(schedulePeriod.year, schedulePeriod.month - 1, 1)));
  const visibleScheduleDates = scheduleDateColumns.length
    ? scheduleDateColumns
    : dateInputsBetween(scheduleDateRange.startDate, scheduleDateRange.endDate);
  const scheduleRowEmployees = scheduleRows.map((row) => row.employee as EmployeeClient);
  const employeeOptions = Array.from(
    new Map([...scheduleEmployees, ...scheduleRowEmployees, ...scheduleEmployeeSearchResults].map((employee) => [employee.id, employee])).values()
  );
  const scheduleEmployeeSearchTerm = scheduleEmployeeSearch.trim().toLowerCase();
  const filteredScheduleEmployeeOptions = employeeOptions
    .filter((employee) => {
      if (!scheduleEmployeeSearchTerm) return true;
      return [employee.name, employee.wb, employee.email].filter(Boolean).join(" ").toLowerCase().includes(scheduleEmployeeSearchTerm);
    })
    .slice(0, 60);
  const configuredLobs = scheduleSettings?.lobs.filter((lob) => lob.status !== "INACTIVE").map((lob) => lob.name) ?? [];
  const configuredShifts = scheduleSettings?.shifts.filter((shift) => shift.status !== "INACTIVE" && isSelectableShiftName(shift.name)).map((shift) => cleanShiftName(shift.name)) ?? [];
  const availableShiftNames = cleanShiftOptions(configuredShifts, true);
  const uniqueLobs = ["Todos", ...Array.from(new Set([...configuredLobs, ...scheduleRows.map((row) => row.employee.lob).filter(Boolean), ...scheduleEmployees.map((employee) => employee.lob).filter(Boolean)]))];
  const uniqueShifts = ["Todos", ...availableShiftNames];
  const normalizedScheduleActorRole = scheduleActorRole === "MANAGEMENT" ? "GESTOR" : scheduleActorRole;
  const canManageSchedules = ["ADMIN", "GESTOR", "WFM"].includes(normalizedScheduleActorRole);
  const canExportSchedules = ["ADMIN", "GESTOR", "WFM", "SUPERVISOR"].includes(normalizedScheduleActorRole);
  const isScheduleSupervisor = normalizedScheduleActorRole === "SUPERVISOR";
  const selectedScheduleEmployee = employeeOptions.find((employee) => employee.id === scheduleEditForm.employeeId);
  const selectedCellHasSchedule = Boolean(scheduleEditForm.scheduleId);
  const canEditOfficialWorkHours = canManageSchedules;
  const manualBreakMinutesPreview = Math.max(0, Number(workHourForm.breakMinutes.replace(",", ".") || 0) || 0);
  const manualGrossMinutesPreview = workHourForm.actualStart && workHourForm.actualEnd ? minutesBetweenTimes(workHourForm.actualStart, workHourForm.actualEnd) : 0;
  const manualBreakIsInvalid = Boolean(workHourForm.actualStart && workHourForm.actualEnd && manualBreakMinutesPreview > manualGrossMinutesPreview);
  const manualActualHoursPreview = workHourForm.actualStart && workHourForm.actualEnd && !manualBreakIsInvalid
    ? roundDecimal((manualGrossMinutesPreview - manualBreakMinutesPreview) / 60)
    : workHourForm.actualHours ? Number(workHourForm.actualHours.replace(",", ".")) || 0 : 0;
  const manualDifferencePreview = manualActualHoursPreview && workHourForm.plannedHours
    ? Math.round((manualActualHoursPreview - workHourForm.plannedHours) * 60)
    : workHourForm.differenceMinutes;
  const manualStatusPreview = workHourForm.plannedHours
    ? Math.abs(manualDifferencePreview) <= 5 ? "OK" : "Divergente"
    : workHourForm.recordId ? workHourForm.status : selectedCellHasSchedule ? "Sem horas" : "Sem cronograma";
  const supervisorOccurrenceStatuses = ["Ausente", "Falta", "Atraso", "Saída antecipada", "Afastado", "Erro de cronograma"];
  const attendanceStatusOptions = isScheduleSupervisor
    ? supervisorOccurrenceStatuses
    : [...scheduleStatusOptions].filter((status) => status !== "Escalado");

  function configuredTimesForShift(shift: string) {
    const cleanedShift = cleanShiftName(shift) || "Manhã";
    const configured = scheduleSettings?.shifts.find((item) => item.status !== "INACTIVE" && cleanShiftName(item.name) === cleanedShift);
    return configured ? { startsAt: configured.startsAt, endsAt: configured.endsAt } : timesForShift(cleanedShift);
  }

  function selectScheduleEmployee(employee: EmployeeClient) {
    const employeeShift = cleanShiftName(employee.shift) || scheduleEditForm.shift;
    const times = configuredTimesForShift(employeeShift);
    setScheduleEditForm((current) => ({
      ...current,
      scheduleId: "",
      employeeId: employee.id,
      shift: employeeShift || current.shift,
      startsAt: scheduleEditRequiresTime ? times.startsAt : current.startsAt,
      endsAt: scheduleEditRequiresTime ? times.endsAt : current.endsAt,
      lob: employee.lob || current.lob,
      supervisor: employee.supervisor || current.supervisor
    }));
    setWorkHourForm((current) => ({
      ...current,
      recordId: "",
      plannedStart: scheduleEditRequiresTime ? times.startsAt : "",
      plannedEnd: scheduleEditRequiresTime ? times.endsAt : "",
      plannedHours: scheduleEditRequiresTime ? roundDecimal(minutesBetweenTimes(times.startsAt, times.endsAt) / 60) : 0,
      actualStart: "",
      actualEnd: "",
      breakMinutes: "0",
      actualHours: "",
      effectiveBreakMinutes: 0,
      effectiveHours: 0,
      differenceMinutes: 0,
      status: "Sem horas",
      rawStatus: "",
      source: "",
      observation: "",
      adjustmentId: "",
      adjustmentStatus: "Sem ajuste"
    }));
    setScheduleEmployeeSearch(employeeOptionLabel(employee));
  }

  function scheduleExportUrl() {
    const params = new URLSearchParams({
      month: String(schedulePeriod.month),
      year: String(schedulePeriod.year),
      startDate: scheduleDateRange.startDate,
      endDate: scheduleDateRange.endDate
    });
    if (scheduleFilters.collaborator) params.set("collaborator", scheduleFilters.collaborator);
    if (scheduleFilters.lob !== "Todos") params.set("lob", scheduleFilters.lob);
    if (scheduleFilters.supervisor) params.set("supervisor", scheduleFilters.supervisor);
    if (scheduleFilters.shift !== "Todos") params.set("shift", scheduleFilters.shift);
    if (scheduleFilters.status !== "Todos") params.set("status", scheduleFilters.status);
    if (scheduleFilters.roleTitle) params.set("roleTitle", scheduleFilters.roleTitle);
    return `/api/schedules/export?${params.toString()}`;
  }

  async function downloadScheduleTemplate() {
    setDownloadingScheduleTemplate(true);
    setAttendanceMessage("");
    try {
      await downloadFile("/api/schedules/template", "template_cronograma_central_operacional.xlsx");
    } catch (error) {
      setAttendanceMessage(error instanceof Error ? error.message : "Não foi possível baixar o template. Tente novamente.");
    } finally {
      setDownloadingScheduleTemplate(false);
    }
  }

  function updateManualTime(field: "actualStart" | "actualEnd", value: string) {
    const nextStart = field === "actualStart" ? value : workHourForm.actualStart;
    const nextEnd = field === "actualEnd" ? value : workHourForm.actualEnd;
    const breakMinutes = Math.max(0, Number(workHourForm.breakMinutes.replace(",", ".") || 0) || 0);
    const grossMinutes = nextStart && nextEnd ? minutesBetweenTimes(nextStart, nextEnd) : 0;
    const calculatedHours = nextStart && nextEnd && breakMinutes <= grossMinutes ? String(roundDecimal((grossMinutes - breakMinutes) / 60)) : workHourForm.actualHours;
    setWorkHourForm({ ...workHourForm, [field]: value, actualHours: calculatedHours });
  }

  function updateManualBreak(value: string) {
    const breakMinutes = Math.max(0, Number(value.replace(",", ".") || 0) || 0);
    const grossMinutes = workHourForm.actualStart && workHourForm.actualEnd ? minutesBetweenTimes(workHourForm.actualStart, workHourForm.actualEnd) : 0;
    const calculatedHours = workHourForm.actualStart && workHourForm.actualEnd && breakMinutes <= grossMinutes ? String(roundDecimal((grossMinutes - breakMinutes) / 60)) : workHourForm.actualHours;
    setWorkHourForm({ ...workHourForm, breakMinutes: value, actualHours: calculatedHours });
  }

  return (
    <div>
      <PageHeader title="Cronogramas Consolidados" description="Visão consolidada dos cronogramas da operação" icon={CalendarCheck} actions={<TopActions />} />
      <div className="card mb-5 p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button onClick={() => moveScheduleMonth(-1)} className="h-10 rounded-lg border border-border bg-white px-3 text-sm font-bold">Mês anterior</button>
            <div className="premium-control h-10 px-4 text-sm font-extrabold capitalize text-navy-950">{monthLabel}</div>
            <button onClick={() => moveScheduleMonth(1)} className="h-10 rounded-lg border border-border bg-white px-3 text-sm font-bold">Próximo mês</button>
          </div>
          <div className="flex gap-2">
            <select value={schedulePeriod.month} onChange={(event) => updateSchedulePeriod({ ...schedulePeriod, month: Number(event.target.value) })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold outline-none">
              {Array.from({ length: 12 }).map((_, index) => <option key={index + 1} value={index + 1}>{String(index + 1).padStart(2, "0")}</option>)}
            </select>
            <input value={schedulePeriod.year} onChange={(event) => updateSchedulePeriod({ ...schedulePeriod, year: Number(event.target.value) || 2026 })} className="h-10 w-24 rounded-lg border border-border px-3 text-sm font-bold outline-none" />
          </div>
        </div>
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="flex rounded-lg border border-border bg-white p-1">
            {(["day", "week", "month"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => applyScheduleQuickRange(mode)}
                className={cn("h-9 rounded-md px-3 text-sm font-extrabold transition", scheduleRangeMode === mode ? "bg-blue-600 text-white shadow-soft" : "text-navy-950 hover:bg-blue-50")}
              >
                {mode === "day" ? "Dia" : mode === "week" ? "Semana" : "Mês"}
              </button>
            ))}
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-bold text-muted">Data inicial</span>
            <input
              type="date"
              value={scheduleDateRange.startDate}
              onChange={(event) => {
                setScheduleRangeMode("custom");
                setScheduleDateRange((current) => ({ ...current, startDate: event.target.value }));
              }}
              className="h-10 rounded-lg border border-border px-3 text-sm font-bold outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-bold text-muted">Data final</span>
            <input
              type="date"
              value={scheduleDateRange.endDate}
              onChange={(event) => {
                setScheduleRangeMode("custom");
                setScheduleDateRange((current) => ({ ...current, endDate: event.target.value }));
              }}
              className="h-10 rounded-lg border border-border px-3 text-sm font-bold outline-none"
            />
          </label>
          <button type="button" onClick={applyScheduleDateRange} className="h-10 rounded-lg bg-blue-600 px-4 text-sm font-bold text-white">Aplicar datas</button>
          {scheduleDateError ? <span className="text-sm font-bold text-red-600">{scheduleDateError}</span> : null}
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
          <input value={scheduleFilters.collaborator} onChange={(event) => setScheduleFilters({ ...scheduleFilters, collaborator: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder="Nome, WB ou e-mail" />
          <select value={scheduleFilters.lob} onChange={(event) => setScheduleFilters({ ...scheduleFilters, lob: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold outline-none">{uniqueLobs.map((item) => <option key={item}>{item}</option>)}</select>
          <input value={scheduleFilters.supervisor} onChange={(event) => setScheduleFilters({ ...scheduleFilters, supervisor: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder="Supervisor" />
          <select value={scheduleFilters.shift} onChange={(event) => setScheduleFilters({ ...scheduleFilters, shift: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold outline-none">{uniqueShifts.map((item) => <option key={item}>{item}</option>)}</select>
          <select value={scheduleFilters.status} onChange={(event) => setScheduleFilters({ ...scheduleFilters, status: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold outline-none">{["Todos", ...scheduleStatusOptions].map((item) => <option key={item}>{item}</option>)}</select>
          <input value={scheduleFilters.roleTitle} onChange={(event) => setScheduleFilters({ ...scheduleFilters, roleTitle: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder="Cargo/Função" />
          <div className="grid grid-cols-2 gap-2">
            <button onClick={applyScheduleFilters} className="rounded-lg bg-blue-600 px-3 text-sm font-bold text-white">Filtrar</button>
            <button
              onClick={clearScheduleFilters}
              className="rounded-lg border border-border bg-white px-3 text-sm font-bold"
            >
              Limpar
            </button>
          </div>
        </div>
      </div>
      {canManageSchedules ? <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(event) => handleFile(event.target.files?.[0])} /> : null}
      <div className="mb-5 flex flex-wrap gap-3">
        {canManageSchedules ? (
          <>
            <button onClick={() => fileInputRef.current?.click()} className="flex h-11 items-center gap-2 rounded-lg border border-border bg-white px-4 text-sm font-bold text-navy-950 shadow-soft">
              <Upload className="h-4 w-4" />
              Upload Excel
            </button>
            <button
              type="button"
              disabled={downloadingScheduleTemplate}
              onClick={downloadScheduleTemplate}
              className="flex h-11 items-center gap-2 rounded-lg border border-border bg-white px-4 text-sm font-bold text-navy-950 shadow-soft disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Download className="h-4 w-4" />
              {downloadingScheduleTemplate ? "Baixando..." : "Baixar Template"}
            </button>
            <a
              href={scheduleExportUrl()}
              className="flex h-11 items-center gap-2 rounded-lg border border-border bg-white px-4 text-sm font-bold text-navy-950 shadow-soft"
            >
              <FileSpreadsheet className="h-4 w-4" />
              Baixar Cronogramas Consolidados
            </a>
            <button onClick={() => openScheduleEditor(undefined, 0, "Escalado")} className="flex h-11 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-bold text-white shadow-soft">
              <Plus className="h-4 w-4" />
              Adicionar cronograma manual
            </button>
          </>
        ) : (
          <>
            <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700">
              Supervisor visualiza a grade e registra justificativas de ocorrência. Upload, adição manual e presença ficam com WFM/Admin.
            </div>
            {canExportSchedules ? (
              <a href={scheduleExportUrl()} className="flex h-11 items-center gap-2 rounded-lg border border-border bg-white px-4 text-sm font-bold text-navy-950 shadow-soft">
                <FileSpreadsheet className="h-4 w-4" />
                Baixar Cronogramas Consolidados
              </a>
            ) : null}
          </>
        )}
      </div>

      {imported ? (
        <div className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">
          {imported}
        </div>
      ) : null}
      {attendanceMessage ? (
        <div className="mb-5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700">
          {attendanceMessage}
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_410px]">
        <section className="card overflow-hidden">
          <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 min-[1800px]:grid-cols-7">
            <MetricPill value={scheduleTotalRows} label="Colaboradores" />
            <MetricPill value={scheduleRows.length ? "100%" : "0%"} label="Cobertura Planejada" />
            <MetricPill value={`${attendanceSummary?.coverageRate ?? 0}%`} label="Cobertura Real" />
            <MetricPill value={`${plannedHours}h`} label="Horas Programadas" />
            <MetricPill value={conflictCount} label="Conflitos" />
            <MetricPill value={`${attendanceSummary?.absRate ?? 0}%`} label="ABS" />
            <MetricPill value={attendanceSummary?.unjustified ?? 0} label="Pendências justificativa" />
          </div>
          <div className="overflow-x-auto">
            {scheduleRows.length ? <table className="w-full min-w-[1040px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-muted">
                  <th className="px-4 py-3">Colaborador</th>
                  <th className="px-4 py-3">Cargo</th>
                  <th className="px-4 py-3">LOB</th>
                  {visibleScheduleDates.map((dateIso) => {
                    const date = new Date(`${dateIso}T00:00:00.000Z`);
                    const label = `${String(date.getUTCDate()).padStart(2, "0")} ${new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" }).format(date).replace(".", "")}`;
                    return <th key={dateIso} className="px-2 py-3 text-center">{label}</th>;
                  })}
                  <th className="px-4 py-3 text-center">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70 bg-white">
                {scheduleRows.map((row) => (
                  <tr key={row.employee.id} className="hover:bg-blue-50/30">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="grid h-9 w-9 place-items-center rounded-full bg-emerald-500 text-xs font-bold text-white">{initials(row.employee.name)}</span>
                        <div>
                          <p className="font-bold text-navy-950">{row.employee.name}</p>
                          <p className="text-xs text-muted">{row.employee.role}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">{row.employee.role}</td>
                    <td className="px-4 py-3">{row.employee.lob}</td>
                    {row.days.map((value, index) => {
                      const hourCell = row.workHours?.[index] ?? null;
                      return (
                        <td key={`${row.employee.id}-${index}`} className="px-2 py-3 text-center">
                          <button onClick={() => openScheduleEditor(row, index, value)} className={cn("inline-flex min-w-[92px] flex-col items-center justify-center rounded-md px-2 py-2 text-xs font-bold transition hover:ring-2 hover:ring-blue-200", shiftTagClass(value), hourCell?.rawStatus === "DIVERGENT" && "ring-1 ring-orange-300", hourCell?.rawStatus === "ADJUSTMENT_REQUESTED" && "ring-1 ring-amber-400")}>
                            <span>{value}</span>
                            {hourCell ? (
                              <span className={cn("mt-1 rounded px-1.5 py-0.5 text-[10px]", hourCell.rawStatus === "OK" ? "bg-emerald-100 text-emerald-700" : hourCell.rawStatus === "DIVERGENT" ? "bg-orange-100 text-orange-700" : hourCell.rawStatus === "ADJUSTMENT_REQUESTED" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700")}>
                                Real: {hourCell.effectiveHours}h {hourCell.differenceMinutes ? formatHourDifference(hourCell.differenceMinutes) : ""}
                              </span>
                            ) : (
                              <span className="mt-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">Sem horas</span>
                            )}
                          </button>
                        </td>
                      );
                    })}
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => isScheduleSupervisor ? openAttendanceJustification(row, 0, row.days[0] ?? "Ausente") : openScheduleEditor(row, 0, row.days[0] ?? "Escalado")} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">
                        {isScheduleSupervisor ? "Justificar" : "Editar"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table> : <div className="p-8"><EmptyState title="Nenhum cronograma importado" description="Importe um cronograma para começar a visualizar a operação." /></div>}
          </div>
          <div className="flex flex-wrap gap-2 border-t border-border px-5 py-3">
            {scheduleStatusOptions.map((status) => (
              <span key={status} className={cn("rounded-md px-2 py-1 text-xs font-bold", shiftTagClass(status))}>{status}</span>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border px-5 py-4 text-sm text-muted">
            <span>{scheduleTotalRows ? `Exibindo ${schedulePageStart}-${schedulePageEnd} de ${scheduleTotalRows} registros` : "Nenhum registro de cronograma"}</span>
            <div className="flex flex-wrap gap-2">
              <button disabled={schedulePagination.page <= 1} onClick={() => void refreshSchedules(1)} className="h-9 rounded-lg border border-border bg-white px-3 text-xs font-bold text-navy-950 disabled:cursor-not-allowed disabled:opacity-45">Primeira</button>
              <button disabled={schedulePagination.page <= 1} onClick={() => void refreshSchedules(schedulePagination.page - 1)} className="h-9 rounded-lg border border-border bg-white px-3 text-xs font-bold text-navy-950 disabled:cursor-not-allowed disabled:opacity-45">Anterior</button>
              <span className="grid h-9 min-w-24 place-items-center rounded-lg border border-blue-100 bg-blue-50 px-3 text-xs font-extrabold text-blue-700">
                {schedulePagination.page} de {schedulePagination.totalPages}
              </span>
              <button disabled={schedulePagination.page >= schedulePagination.totalPages} onClick={() => void refreshSchedules(schedulePagination.page + 1)} className="h-9 rounded-lg border border-border bg-white px-3 text-xs font-bold text-navy-950 disabled:cursor-not-allowed disabled:opacity-45">Próxima</button>
              <button disabled={schedulePagination.page >= schedulePagination.totalPages} onClick={() => void refreshSchedules(schedulePagination.totalPages)} className="h-9 rounded-lg border border-border bg-white px-3 text-xs font-bold text-navy-950 disabled:cursor-not-allowed disabled:opacity-45">Última</button>
            </div>
          </div>
        </section>

        <div className="space-y-5">
          <Panel
            title="Pendências de Justificativa"
            action={pendingJustifications.length ? `${pendingJustifications.length} aberta(s)` : undefined}
            actionOnClick={() => setShowPendingJustifications(true)}
          >
            {pendingJustifications.length ? (
              <div className="space-y-3">
                {pendingJustifications.slice(0, 6).map((record) => (
                  <div key={record.id} className="rounded-lg border border-orange-200 bg-orange-50 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-extrabold text-navy-950">{record.employeeName}</p>
                        <p className="text-xs font-semibold text-orange-800">{record.date} • {cleanShiftName(record.shift) || "Sem turno"} • {record.status}</p>
                        <p className="mt-1 text-xs text-muted">Registrado por {record.registeredBy}</p>
                      </div>
                      <button onClick={() => openPendingJustification(record)} className="rounded-lg bg-orange-600 px-3 py-2 text-xs font-bold text-white">
                        Justificar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="Sem pendências" description="Faltas ou ausências sem justificativa aparecerão aqui." />
            )}
          </Panel>
          <Panel title="Cobertura">
            <DonutLegend
              total={`${attendanceSummary?.coverageRate ?? 0}%`}
              items={[
                { label: "Programado", value: `${plannedHours}h`, color: "#10B981" },
                { label: "Atenção", value: "0h", color: "#F59E0B" },
                { label: "Descoberto", value: `${unscheduledCount * 8}h`, color: "#EF4444" },
                { label: "Sem programação", value: `${unscheduledCount * 8}h`, color: "#CBD5E1" }
              ]}
            />
          </Panel>
          <Panel title="Alertas e Conflitos" action="Ver todos os alertas" actionOnClick={() => setShowScheduleAlerts(true)}>
            {scheduleAlertItems.length ? (
              <MiniAlertList items={scheduleAlertItems.slice(0, 3)} />
            ) : <EmptyState title="Sem alertas" description="Alertas aparecerão após importação e validação do cronograma real." />}
          </Panel>
          <Panel title="Importações Recentes" action="Ver todas" actionOnClick={() => setShowScheduleImports(true)}>
            {importHistory.length ? importHistory.slice(0, 5).map((file) => (
              <div key={file.id} className="mb-3 flex items-center gap-3 last:mb-0">
                <FileSpreadsheet className="h-8 w-8 text-emerald-600" />
                <div className="flex-1">
                  <p className="text-sm font-bold text-navy-950">{file.fileName}</p>
                  <p className="text-xs text-muted">Importado por {file.user} • {file.importedRows} linhas</p>
                </div>
                <StatusBadge status={file.status} />
              </div>
            )) : <EmptyState title="Nenhuma importação" description="Os arquivos importados aparecerão aqui." />}
          </Panel>
        </div>
      </div>

      {showPendingJustifications ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4 backdrop-blur-sm">
          <div className="card max-h-[88vh] w-full max-w-4xl overflow-y-auto p-5">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-extrabold text-navy-950">Pendências abertas do cronograma</h2>
                <p className="text-sm text-muted">Ocorrências sem justificativa dentro do período e filtros atuais.</p>
              </div>
              <button type="button" onClick={() => setShowPendingJustifications(false)} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-slate-100">×</button>
            </div>
            {pendingJustifications.length ? (
              <div className="space-y-3">
                {pendingJustifications.map((record) => (
                  <div key={record.id} className="rounded-xl border border-orange-200 bg-orange-50 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-extrabold text-navy-950" title={record.employeeName}>{record.employeeName}</p>
                        <p className="mt-1 text-xs font-semibold text-orange-800">
                          {record.date} • {cleanShiftName(record.shift) || "Sem turno"} • {record.status}
                        </p>
                        <p className="mt-1 text-xs text-muted">Motivo: {record.absenceReason || "Sem justificativa"} • Registrado por {record.registeredBy}</p>
                        <p className="mt-1 text-xs text-muted">Ação recomendada: justificar ocorrência ou corrigir o status do cronograma.</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setShowPendingJustifications(false);
                          openPendingJustification(record);
                        }}
                        className="rounded-lg bg-orange-600 px-3 py-2 text-xs font-bold text-white"
                      >
                        Regularizar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="Nenhuma pendência aberta para os filtros selecionados." description="Quando surgir falta, ausência ou atraso sem justificativa, o item aparecerá aqui." />
            )}
          </div>
        </div>
      ) : null}

      {showScheduleAlerts ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4 backdrop-blur-sm">
          <div className="card max-h-[88vh] w-full max-w-3xl overflow-y-auto p-5">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-extrabold text-navy-950">Alertas e conflitos do cronograma</h2>
                <p className="text-sm text-muted">Período atual, filtros aplicados e pendências reais carregadas da operação.</p>
              </div>
              <button type="button" onClick={() => setShowScheduleAlerts(false)} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-slate-100">×</button>
            </div>
            {scheduleAlertItems.length ? (
              <div className="space-y-3">
                {scheduleAlertItems.map((item) => (
                  <div key={`${item.title}-${item.status}`} className="rounded-xl border border-border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-extrabold text-navy-950">{item.title}</p>
                        <p className="mt-1 text-xs font-semibold text-muted">{item.detail}</p>
                      </div>
                      <StatusBadge status={item.status} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="Nenhum alerta encontrado para o período selecionado." description="Ao surgir conflito, falta pendente ou importação com erro, o item aparecerá aqui." />
            )}
          </div>
        </div>
      ) : null}

      {showScheduleImports ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4 backdrop-blur-sm">
          <div className="card max-h-[88vh] w-full max-w-4xl overflow-y-auto p-5">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-extrabold text-navy-950">Histórico de importações</h2>
                <p className="text-sm text-muted">Últimas importações reais de cronograma registradas no banco.</p>
              </div>
              <button type="button" onClick={() => setShowScheduleImports(false)} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-slate-100">×</button>
            </div>
            {importHistory.length ? (
              <div className="space-y-3">
                {importHistory.map((file) => (
                  <div key={file.id} className="rounded-xl border border-border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-extrabold text-navy-950" title={file.fileName}>{file.fileName}</p>
                        <p className="mt-1 text-xs font-semibold text-muted">Importado por {file.user} • {file.createdAt}</p>
                        <p className="mt-2 text-xs text-muted">
                          Total: {file.totalRows ?? file.importedRows} • Válidas: {file.importedRows} • Erros: {file.errorRows ?? 0} • Alertas: {file.warningRows ?? 0}
                        </p>
                      </div>
                      <StatusBadge status={file.status} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="Nenhuma importação recente encontrada." description="Quando um cronograma for importado, o histórico aparecerá aqui." />
            )}
          </div>
        </div>
      ) : null}

      {showEditSchedule ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4 backdrop-blur-sm">
          <div className="card max-h-[90vh] w-full max-w-5xl overflow-y-auto p-5">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-extrabold text-navy-950">{canManageSchedules ? "Editar cronograma e horas" : "Visualizar cronograma e horas"}</h2>
                <p className="text-sm text-muted">{selectedScheduleEmployee ? `${employeeOptionLabel(selectedScheduleEmployee)} • ${scheduleEditForm.date}` : "Atualiza histórico, auditoria e horas oficiais quando aplicável."}</p>
              </div>
              <button onClick={closeScheduleEditor} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-slate-100">×</button>
            </div>
            <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
              <section className="rounded-xl border border-border p-4">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-extrabold text-navy-950">Cronograma</h3>
                    <p className="text-xs text-muted">Planejado do dia e status da célula.</p>
                  </div>
                  <StatusBadge status={scheduleEditForm.status} />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="block md:col-span-2">
                    <span className="mb-1.5 block text-sm font-bold text-muted">Colaborador</span>
                    <div className="rounded-lg border border-border bg-white p-2">
                      <input
                        disabled={!canManageSchedules}
                        value={scheduleEmployeeSearch}
                        onChange={(event) => setScheduleEmployeeSearch(event.target.value)}
                        className="h-10 w-full rounded-md border border-border px-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
                        placeholder="Buscar por nome, WB/Login ou e-mail"
                      />
                      {selectedScheduleEmployee ? (
                        <div className="mt-2 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-800">
                          Selecionado: {employeeOptionLabel(selectedScheduleEmployee)}
                        </div>
                      ) : (
                        <div className="mt-2 rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
                          Selecione um colaborador.
                        </div>
                      )}
                      {canManageSchedules ? (
                        <div className="mt-2 max-h-52 overflow-y-auto rounded-md border border-border bg-white">
                          {loadingScheduleEmployeeSearch ? (
                            <div className="px-3 py-3 text-sm font-semibold text-muted">Buscando colaboradores...</div>
                          ) : filteredScheduleEmployeeOptions.length ? (
                            filteredScheduleEmployeeOptions.map((employee) => (
                              <button
                                type="button"
                                key={employee.id}
                                onClick={() => selectScheduleEmployee(employee)}
                                className={cn(
                                  "block w-full px-3 py-2 text-left text-sm font-semibold transition hover:bg-blue-50",
                                  employee.id === scheduleEditForm.employeeId ? "bg-blue-50 text-blue-700" : "text-navy-950"
                                )}
                              >
                                <span className="block truncate">{employeeOptionLabel(employee)}</span>
                                <span className="block truncate text-xs font-medium text-muted">{employee.lob} • {cleanShiftName(employee.shift) || "Sem turno"} • {employee.status}</span>
                              </button>
                            ))
                          ) : (
                            <div className="px-3 py-3 text-sm font-semibold text-muted">Nenhum colaborador encontrado.</div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <FormInput disabled={!canManageSchedules} label="Data" type="date" value={scheduleEditForm.date} onChange={(value) => setScheduleEditForm({ ...scheduleEditForm, scheduleId: "", date: value })} />
                  <FormSelect
                    disabled={!canManageSchedules}
                    label="Turno"
                    value={scheduleEditForm.shift}
                    options={availableShiftNames}
                    onChange={(value) => {
                      const times = configuredTimesForShift(value);
                      setScheduleEditForm({ ...scheduleEditForm, shift: value, startsAt: scheduleEditRequiresTime ? times.startsAt : scheduleEditForm.startsAt, endsAt: scheduleEditRequiresTime ? times.endsAt : scheduleEditForm.endsAt });
                    }}
                  />
                  <FormSelect
                    disabled={!canManageSchedules}
                    label="Status"
                    value={scheduleEditForm.status}
                    options={[...scheduleStatusOptions]}
                    onChange={(value) => {
                      const times = configuredTimesForShift(scheduleEditForm.shift);
                      setScheduleEditForm({
                        ...scheduleEditForm,
                        status: value,
                        startsAt: statusNeedsTime(value) ? scheduleEditForm.startsAt || times.startsAt : "",
                        endsAt: statusNeedsTime(value) ? scheduleEditForm.endsAt || times.endsAt : "",
                        observation: statusNeedsReason(value) ? scheduleEditForm.observation : scheduleEditForm.observation,
                        pendingJustification: statusNeedsReason(value) ? scheduleEditForm.pendingJustification : false
                      });
                    }}
                  />
                  <FormInput disabled={!canManageSchedules} label="Entrada prevista" value={scheduleEditForm.startsAt} onChange={(value) => setScheduleEditForm({ ...scheduleEditForm, startsAt: value })} />
                  <FormInput disabled={!canManageSchedules} label="Saída prevista" value={scheduleEditForm.endsAt} onChange={(value) => setScheduleEditForm({ ...scheduleEditForm, endsAt: value })} />
                  <FormInput disabled={!canManageSchedules} label="LOB" value={scheduleEditForm.lob} onChange={(value) => setScheduleEditForm({ ...scheduleEditForm, lob: value })} />
                  <FormInput disabled={!canManageSchedules} label="Supervisor" value={scheduleEditForm.supervisor} onChange={(value) => setScheduleEditForm({ ...scheduleEditForm, supervisor: value })} />
                  <label className="md:col-span-2">
                    <span className="mb-1.5 block text-sm font-bold text-muted">{scheduleEditRequiresReason ? "Motivo/observação obrigatória" : "Observação do cronograma"}</span>
                    <textarea disabled={!canManageSchedules} value={scheduleEditForm.observation} onChange={(event) => setScheduleEditForm({ ...scheduleEditForm, observation: event.target.value })} className="min-h-24 w-full rounded-lg border border-border p-3 outline-none disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500" placeholder={scheduleEditRequiresReason ? "Obrigatório para ausência, falta, atraso, saída antecipada, afastado ou erro de cronograma" : "Opcional para este status"} />
                  </label>
                  {scheduleEditRequiresReason && canManageSchedules ? (
                    <label className="md:col-span-2 flex items-start gap-3 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm font-semibold text-orange-800">
                      <input
                        type="checkbox"
                        checked={scheduleEditForm.pendingJustification}
                        onChange={(event) => setScheduleEditForm({ ...scheduleEditForm, pendingJustification: event.target.checked, observation: event.target.checked ? "" : scheduleEditForm.observation })}
                        className="mt-1"
                      />
                      <span>
                        Sem justificativa no momento
                        <span className="mt-1 block text-xs font-medium text-orange-700">
                          WFM registra a ocorrência agora e o Supervisor recebe uma pendência para justificar depois.
                        </span>
                      </span>
                    </label>
                  ) : null}
                </div>
                <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700">
                  {canManageSchedules ? scheduleEditForm.pendingJustification ? "A célula ficará destacada como pendente de justificativa até o Supervisor justificar." : scheduleEditRequiresTime ? "Este status exige turno, entrada e saída." : "Este status permite entrada/saída vazias." : "Supervisor visualiza o cronograma e solicita ajustes; WFM/Admin altera o planejado."}
                </div>
                {canManageSchedules ? (
                  <>
                    <button disabled={savingSchedule} onClick={saveScheduleEdit} className="mt-4 w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-60">
                      {savingSchedule ? "Salvando..." : "Salvar edição do cronograma"}
                    </button>
                    <button disabled={savingSchedule} onClick={() => removeSelectedEmployeeSchedule("month")} className="mt-3 w-full rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700 disabled:opacity-60">
                      Remover cronograma do colaborador neste mês
                    </button>
                  </>
                ) : null}
              </section>

              <section className="rounded-xl border border-border p-4">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-extrabold text-navy-950">Horas</h3>
                    <p className="text-xs text-muted">Realizado oficial conectado ao módulo Horas Operacionais.</p>
                  </div>
                  <StatusBadge status={workHourForm.recordId ? workHourForm.status : selectedCellHasSchedule ? "Sem horas" : "Sem cronograma"} />
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <MetricPill value={workHourForm.plannedHours ? `${workHourForm.plannedHours}h` : "-"} label="Previsto" />
                  <MetricPill value={formatBreakDuration(manualBreakMinutesPreview)} label="Pausa" />
                  <MetricPill value={manualActualHoursPreview ? `${manualActualHoursPreview}h` : workHourForm.effectiveHours ? `${workHourForm.effectiveHours}h` : "-"} label="Realizado" />
                  <MetricPill value={manualActualHoursPreview || workHourForm.differenceMinutes ? formatHourDifference(manualDifferencePreview) : "-"} label="Diferença" />
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <FormInput disabled label="Entrada prevista" value={workHourForm.plannedStart} onChange={() => undefined} />
                  <FormInput disabled label="Saída prevista" value={workHourForm.plannedEnd} onChange={() => undefined} />
                  <FormInput disabled={!canEditOfficialWorkHours} label="Entrada real" value={workHourForm.actualStart} onChange={(value) => updateManualTime("actualStart", value)} />
                  <FormInput disabled={!canEditOfficialWorkHours} label="Saída real" value={workHourForm.actualEnd} onChange={(value) => updateManualTime("actualEnd", value)} />
                  <FormInput disabled={!canEditOfficialWorkHours} label="Pausa/Intervalo (min)" value={workHourForm.breakMinutes} onChange={updateManualBreak} />
                  <FormInput disabled={!canEditOfficialWorkHours} label="Horas realizadas líquidas" value={workHourForm.actualHours} onChange={(value) => setWorkHourForm({ ...workHourForm, actualHours: value })} />
                  <FormInput disabled label="Origem" value={workHourForm.source || "Sem origem"} onChange={() => undefined} />
                  <label className="md:col-span-2">
                    <span className="mb-1.5 block text-sm font-bold text-muted">Observação das horas</span>
                    <textarea disabled={!canEditOfficialWorkHours} value={workHourForm.observation} onChange={(event) => setWorkHourForm({ ...workHourForm, observation: event.target.value })} className="min-h-24 w-full rounded-lg border border-border p-3 outline-none disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500" placeholder="Motivo da correção, sistema de origem ou comentário operacional" />
                  </label>
                </div>
                <div className={cn("mt-4 rounded-lg border px-4 py-3 text-sm font-semibold", manualStatusPreview === "OK" ? "border-emerald-100 bg-emerald-50 text-emerald-700" : manualStatusPreview === "Divergente" ? "border-orange-100 bg-orange-50 text-orange-700" : "border-blue-100 bg-blue-50 text-blue-700")}>
                  {manualBreakIsInvalid
                    ? "A pausa não pode ser maior que o período entre entrada e saída."
                    : workHourForm.plannedHours
                      ? `Status previsto após salvar: ${manualStatusPreview}.`
                      : selectedCellHasSchedule
                        ? "Horas ainda não lançadas para este dia."
                        : "Sem cronograma vinculado para este dia."}
                  {workHourForm.adjustmentStatus && workHourForm.adjustmentStatus !== "Sem ajuste" ? ` Ajuste: ${workHourForm.adjustmentStatus}.` : ""}
                </div>
                {canEditOfficialWorkHours ? (
                  <button disabled={savingWorkHour} onClick={() => saveManualWorkHours()} className="mt-4 w-full rounded-lg bg-emerald-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-60">
                    {savingWorkHour ? "Salvando horas..." : workHourForm.recordId ? "Salvar correção de horas" : "Lançar horas"}
                  </button>
                ) : (
                  <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600">
                    Supervisor não altera horas oficiais. Use a solicitação de ajuste abaixo.
                  </div>
                )}

                {isScheduleSupervisor ? (
                  <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
                    <div className="mb-3">
                      <h4 className="text-sm font-extrabold text-amber-900">Solicitar ajuste de horas</h4>
                      <p className="text-xs font-semibold text-amber-800">A solicitação vai para WFM/Admin e só vira hora oficial após aprovação.</p>
                    </div>
                    {workHourForm.recordId ? (
                      <div className="grid gap-4 md:grid-cols-4">
                        <FormInput label="Nova entrada" value={workHourAdjustmentForm.requestedActualStart} onChange={(value) => setWorkHourAdjustmentForm({ ...workHourAdjustmentForm, requestedActualStart: value })} />
                        <FormInput label="Nova saída" value={workHourAdjustmentForm.requestedActualEnd} onChange={(value) => setWorkHourAdjustmentForm({ ...workHourAdjustmentForm, requestedActualEnd: value })} />
                        <FormInput label="Nova pausa (min)" value={workHourAdjustmentForm.requestedBreakMinutes} onChange={(value) => setWorkHourAdjustmentForm({ ...workHourAdjustmentForm, requestedBreakMinutes: value })} />
                        <FormInput label="Novas horas líquidas" value={workHourAdjustmentForm.requestedActualHours} onChange={(value) => setWorkHourAdjustmentForm({ ...workHourAdjustmentForm, requestedActualHours: value })} />
                        <div className="md:col-span-4">
                          <FormSelect label="Motivo" value={workHourAdjustmentForm.reason} options={["Erro de apontamento", "Sistema não capturou horário", "Feedback/treinamento durante o turno", "Problema técnico", "Ajuste manual autorizado", "Erro no upload", "Atividade operacional fora do sistema", "Outro"]} onChange={(value) => setWorkHourAdjustmentForm({ ...workHourAdjustmentForm, reason: value })} />
                        </div>
                        <label className="md:col-span-4">
                          <span className="mb-1.5 block text-sm font-bold text-muted">Justificativa</span>
                          <textarea value={workHourAdjustmentForm.justification} onChange={(event) => setWorkHourAdjustmentForm({ ...workHourAdjustmentForm, justification: event.target.value })} className="min-h-24 w-full rounded-lg border border-border bg-white p-3 outline-none" />
                        </label>
                        <button disabled={savingWorkHourAdjustment} onClick={requestScheduleWorkHourAdjustment} className="md:col-span-4 rounded-lg bg-amber-500 px-4 py-3 text-sm font-bold text-white disabled:opacity-60">
                          {savingWorkHourAdjustment ? "Enviando..." : "Solicitar ajuste para WFM/Admin"}
                        </button>
                      </div>
                    ) : (
                      <p className="text-sm font-semibold text-amber-800">Ainda não existe registro de horas para este dia. WFM/Admin precisa lançar ou importar as horas antes da solicitação de ajuste.</p>
                    )}
                  </div>
                ) : null}
              </section>
            </div>
          </div>
        </div>
      ) : null}

      {showAttendance ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-2xl p-5">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-extrabold text-navy-950">{isScheduleSupervisor ? "Justificar ocorrência" : "Marcar presença/ausência"}</h2>
                <p className="text-sm text-muted">
                  {isScheduleSupervisor ? "Registra justificativa e AttendanceRecord sem alterar turno, entrada, saída ou marcar presença." : "Atualiza cronograma, mapa, cobertura, indicadores de ABS e auditoria."}
                </p>
              </div>
              <button onClick={() => setShowAttendance(false)} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-slate-100">×</button>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-sm font-bold text-muted">Colaborador</span>
                <select value={attendanceForm.employeeId} onChange={(event) => setAttendanceForm({ ...attendanceForm, employeeId: event.target.value })} className="h-11 w-full rounded-lg border border-border px-3 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100">
                  {employeeOptions.map((employee) => <option key={employee.id} value={employee.id}>{employeeOptionLabel(employee)}</option>)}
                </select>
              </label>
              <FormInput label="Data" type="date" value={attendanceForm.date} onChange={(value) => setAttendanceForm({ ...attendanceForm, date: value })} />
              <FormSelect label="Turno" value={attendanceForm.shift} options={availableShiftNames} onChange={(value) => setAttendanceForm({ ...attendanceForm, shift: value })} />
              <FormSelect
                label="Status"
                value={attendanceForm.status}
                options={attendanceStatusOptions}
                onChange={(value) => {
                  const reasonRequired = statusNeedsReason(value);
                  setAttendanceForm({
                    ...attendanceForm,
                    status: value,
                    absenceReason: reasonRequired ? attendanceForm.absenceReason : "",
                    supervisorJustification: reasonRequired ? attendanceForm.supervisorJustification : "",
                    impactsAbs: ["Falta", "Ausente"].includes(value),
                    impactsCoverage: ["Ausente", "Falta", "Atraso", "Saída antecipada", "Afastado", "Sem cronograma"].includes(value)
                  });
                }}
              />
              <FormSelect label={attendanceRequiresReason ? "Motivo obrigatório" : "Motivo (opcional)"} value={attendanceForm.absenceReason} options={["", ...absenceReasonOptions]} onChange={(value) => setAttendanceForm({ ...attendanceForm, absenceReason: value })} />
              <FormSelect label="Categoria" value={attendanceForm.reasonCategory} options={["Pessoas", "Sistema", "Ferramenta", "Equipamento", "Cronograma", "Treinamento", "Outros"]} onChange={(value) => setAttendanceForm({ ...attendanceForm, reasonCategory: value })} />
              <FormInput label="Anexo/evidência (opcional)" value={attendanceForm.evidenceUrl} onChange={(value) => setAttendanceForm({ ...attendanceForm, hasEvidence: Boolean(value), evidenceUrl: value })} />
              <div className="rounded-lg border border-border bg-slate-50 p-3">
                <p className="mb-2 text-sm font-bold text-muted">Impactos</p>
                <div className="flex flex-wrap gap-4 text-sm font-semibold text-navy-950">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={attendanceForm.impactsAbs} onChange={(event) => setAttendanceForm({ ...attendanceForm, impactsAbs: event.target.checked })} />
                    Impacta ABS
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={attendanceForm.impactsCoverage} onChange={(event) => setAttendanceForm({ ...attendanceForm, impactsCoverage: event.target.checked })} />
                    Impacta cobertura
                  </label>
                </div>
              </div>
              <label className="md:col-span-2">
                <span className="mb-1.5 block text-sm font-bold text-muted">{attendanceRequiresReason ? "Justificativa do supervisor obrigatória se não houver motivo" : "Justificativa do supervisor (opcional)"}</span>
                <textarea value={attendanceForm.supervisorJustification} onChange={(event) => setAttendanceForm({ ...attendanceForm, supervisorJustification: event.target.value })} className="min-h-24 w-full rounded-lg border border-border p-3 outline-none" />
              </label>
            </div>
            <div className="mt-5 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700">
              {isScheduleSupervisor ? "Supervisor não pode marcar Presente nem alterar o cronograma planejado. A validação/correção final fica com WFM/Admin." : attendanceRequiresReason ? "Este status exige motivo ou observação antes de salvar." : "Este status não exige motivo obrigatório."}
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <MetricPill value={`${attendanceSummary?.coverageRate ?? 0}%`} label="Cobertura atual" />
              <MetricPill value={attendanceSummary?.absent ?? 0} label="Ausências" />
              <MetricPill value={attendanceSummary?.riskLevel ?? "Adequado"} label="Risco" />
            </div>
            <button onClick={saveAttendance} className="mt-5 w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-bold text-white">Salvar registro</button>
          </div>
        </div>
      ) : null}

      {showPreview ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4 backdrop-blur-sm">
          <div className="card max-h-[84vh] w-full max-w-5xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h2 className="text-lg font-extrabold text-navy-950">Preview da importação</h2>
                <p className="text-sm text-muted">{previewResult?.totalRows ?? previewRows.length} linhas carregadas para validação visual.</p>
              </div>
              <button onClick={() => setShowPreview(false)} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-slate-100">×</button>
            </div>
            <div className="grid gap-4 p-5 lg:grid-cols-[1fr_280px]">
              <div className="overflow-auto rounded-lg border border-border">
                <table className="w-full min-w-[820px] text-left text-xs">
                  <thead className="bg-slate-50 font-bold text-muted">
                    <tr>
                      {[...scheduleImportColumns, "validacao"].map((column) => (
                        <th key={column} className="px-3 py-2">{column}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {((previewRows.length ? previewRows : templateRows) as Array<Record<string, unknown>>).slice(0, 300).map((row, index) => (
                      <tr key={index}>
                        {scheduleImportColumns.map((column) => (
                          <td key={column} className="px-3 py-2">{String(row[column] ?? "")}</td>
                        ))}
                        <td className="px-3 py-2">
                          {previewResult?.validation?.[index]
                            ? [...previewResult.validation[index].errors, ...previewResult.validation[index].warnings].join(" | ") || previewResult.validation[index].action || "OK"
                            : "OK"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="space-y-3">
                <StatusBadge status={validation.errors ? `${validation.errors} erros` : "Sem erros críticos"} />
                <StatusBadge status={`${validation.warnings} alertas`} />
                <MetricPill value={previewResult?.createdRows ?? 0} label="Novos cronogramas" />
                <MetricPill value={previewResult?.updatedRows ?? 0} label="Atualizações" />
                <MetricPill value={previewResult?.missingEmployees ?? 0} label="WB/Login não encontrados" />
                <p className="text-sm text-muted">Validações: WB/Login existente, data, status válido, turno, entrada, saída, LOB e conflito por pessoa/dia.</p>
                {(previewRows.length > 300 || (previewResult?.validation.length ?? 0) > 300) ? <p className="text-xs font-semibold text-muted">Exibindo as primeiras 300 linhas no preview para manter a tela rápida. O commit processa todas as linhas válidas.</p> : null}
                <button
                  onClick={commitImport}
                  className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-bold text-white"
                >
                  Confirmar importação
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function WorkHoursPage() {
  const { data: session } = useSession();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [rows, setRows] = useState<WorkHourRow[]>([]);
  const [summary, setSummary] = useState<WorkHourSummary | null>(null);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1 });
  const [filters, setFilters] = useState({
    startDate: "2026-05-01",
    endDate: "2026-05-31",
    lob: "Todos",
    supervisor: "",
    shift: "Todos",
    collaborator: "",
    status: "Todos",
    source: "Todos",
    divergentOnly: false,
    pendingOnly: false,
    noScheduleOnly: false
  });
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<(WorkHourPreview & { fileName: string }) | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [savingImport, setSavingImport] = useState(false);
  const [downloadingWorkHourTemplate, setDownloadingWorkHourTemplate] = useState(false);
  const [selectedRow, setSelectedRow] = useState<WorkHourRow | null>(null);
  const [showAdjustment, setShowAdjustment] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [adjustmentAction, setAdjustmentAction] = useState<"approve" | "reject">("approve");
  const [savingAdjustment, setSavingAdjustment] = useState(false);
  const [adjustmentForm, setAdjustmentForm] = useState({
    requestedActualStart: "",
    requestedActualEnd: "",
    requestedBreakMinutes: "0",
    requestedActualHours: "",
    reason: "Erro de apontamento",
    justification: "",
    rejectionReason: ""
  });

  const actorRole = session?.user?.role ?? "COLABORADOR";
  const normalizedRole = actorRole === "MANAGEMENT" ? "GESTOR" : actorRole;
  const canUpload = ["ADMIN", "GESTOR", "WFM"].includes(normalizedRole);
  const canApprove = ["ADMIN", "GESTOR", "WFM"].includes(normalizedRole);
  const canRequestAdjustment = ["ADMIN", "GESTOR", "WFM", "SUPERVISOR"].includes(normalizedRole);
  const statusOptions = ["Todos", "OK", "Divergente", "Sem cronograma", "Ajuste solicitado", "Ajuste aprovado", "Ajuste recusado", "Importado", "Corrigido manualmente"];
  const sourceOptions = ["Todos", "MANUAL", "upload-horas"];
  const lobOptions = ["Todos", ...(settings?.lobs.filter((lob) => lob.status !== "INACTIVE").map((lob) => lob.name) ?? Array.from(new Set(rows.map((row) => row.lob).filter(Boolean))))];
  const shiftOptions = ["Todos", ...cleanShiftOptions(settings?.shifts.filter((shift) => shift.status !== "INACTIVE").map((shift) => shift.name) ?? rows.map((row) => row.shift), true)];

  useEffect(() => {
    apiJson<{ data: SystemSettings }>("/api/settings").then((payload) => setSettings(payload.data)).catch(() => undefined);
    void loadWorkHours();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadWorkHours(nextPage = pagination.page) {
    setLoading(true);
    setMessage("");
    try {
      const params = new URLSearchParams({
        startDate: filters.startDate,
        endDate: filters.endDate,
        page: String(nextPage),
        limit: String(pagination.limit)
      });
      if (filters.lob !== "Todos") params.set("lob", filters.lob);
      if (filters.supervisor) params.set("supervisor", filters.supervisor);
      if (filters.shift !== "Todos") params.set("shift", filters.shift);
      if (filters.collaborator) params.set("collaborator", filters.collaborator);
      if (filters.status !== "Todos") params.set("status", filters.status);
      if (filters.source !== "Todos") params.set("source", filters.source);
      if (filters.divergentOnly) params.set("divergentOnly", "true");
      if (filters.pendingOnly) params.set("pendingOnly", "true");
      if (filters.noScheduleOnly) params.set("noScheduleOnly", "true");
      const payload = await apiJson<{ data: WorkHourRow[]; summary: WorkHourSummary; pagination: typeof pagination }>(`/api/work-hours?${params.toString()}`);
      setRows(payload.data);
      setSummary(payload.summary);
      setPagination(payload.pagination);
    } catch (error) {
      setRows([]);
      setSummary(null);
      setMessage(error instanceof Error ? error.message : "Não foi possível carregar horas operacionais.");
    } finally {
      setLoading(false);
    }
  }

  async function handleWorkHourFile(file?: File) {
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    setMessage("");
    try {
      const payload = await apiJson<WorkHourPreview & { fileName: string }>("/api/work-hours/import/preview", {
        method: "POST",
        body: formData
      });
      setPreview(payload);
      setShowPreview(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível validar o arquivo de horas.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function downloadWorkHourTemplate() {
    setDownloadingWorkHourTemplate(true);
    setMessage("");
    try {
      await downloadFile("/api/work-hours/template", "template_horas_operacionais.xlsx");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível baixar o template. Tente novamente.");
    } finally {
      setDownloadingWorkHourTemplate(false);
    }
  }

  async function commitWorkHourImport() {
    if (!preview) return;
    setSavingImport(true);
    try {
      const payload = await apiJson<{ data: { importedRows: number; createdRows: number; updatedRows: number } }>("/api/work-hours/import/commit", {
        method: "POST",
        body: JSON.stringify({ fileName: preview.fileName, allowPartial: true, rows: preview.rows })
      });
      setShowPreview(false);
      setPreview(null);
      setMessage(`${payload.data.importedRows} registro(s) importado(s). Criados: ${payload.data.createdRows}. Atualizados: ${payload.data.updatedRows}.`);
      await loadWorkHours(1);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível importar horas.");
    } finally {
      setSavingImport(false);
    }
  }

  function openAdjustment(row: WorkHourRow) {
    setSelectedRow(row);
    setAdjustmentForm({
      requestedActualStart: row.effectiveHours ? row.actualStart : "",
      requestedActualEnd: row.effectiveHours ? row.actualEnd : "",
      requestedBreakMinutes: String(row.effectiveBreakMinutes ?? row.breakMinutes ?? 0),
      requestedActualHours: row.effectiveHours ? String(row.effectiveHours).replace(".", ",") : "",
      reason: "Erro de apontamento",
      justification: "",
      rejectionReason: ""
    });
    setShowAdjustment(true);
  }

  function openReview(row: WorkHourRow, action: "approve" | "reject") {
    setSelectedRow(row);
    setAdjustmentAction(action);
    setAdjustmentForm({ ...adjustmentForm, requestedBreakMinutes: String(row.effectiveBreakMinutes ?? row.breakMinutes ?? 0), rejectionReason: "" });
    setShowReview(true);
  }

  async function submitAdjustment() {
    if (!selectedRow) return;
    setSavingAdjustment(true);
    setMessage("");
    try {
      await apiJson("/api/work-hours", {
        method: "POST",
        body: JSON.stringify({
          workHourRecordId: selectedRow.id,
          requestedActualStart: adjustmentForm.requestedActualStart || undefined,
          requestedActualEnd: adjustmentForm.requestedActualEnd || undefined,
          requestedBreakMinutes: adjustmentForm.requestedBreakMinutes ? Number(adjustmentForm.requestedBreakMinutes.replace(",", ".")) : undefined,
          requestedActualHours: Number(adjustmentForm.requestedActualHours.replace(",", ".")) || undefined,
          reason: adjustmentForm.reason,
          justification: adjustmentForm.justification
        })
      });
      setShowAdjustment(false);
      setMessage("Ajuste de horas solicitado e enviado para WFM/Admin.");
      await loadWorkHours();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível solicitar ajuste.");
    } finally {
      setSavingAdjustment(false);
    }
  }

  async function reviewAdjustment() {
    if (!selectedRow?.adjustmentId) return;
    setSavingAdjustment(true);
    try {
      await apiJson("/api/work-hours/adjustments", {
        method: "PATCH",
        body: JSON.stringify({ id: selectedRow.adjustmentId, action: adjustmentAction, rejectionReason: adjustmentForm.rejectionReason })
      });
      setShowReview(false);
      setMessage(adjustmentAction === "approve" ? "Ajuste aprovado e horas efetivas atualizadas." : "Ajuste recusado.");
      await loadWorkHours();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível processar ajuste.");
    } finally {
      setSavingAdjustment(false);
    }
  }

  function exportUrl() {
    const params = new URLSearchParams({ startDate: filters.startDate, endDate: filters.endDate });
    if (filters.lob !== "Todos") params.set("lob", filters.lob);
    if (filters.supervisor) params.set("supervisor", filters.supervisor);
    if (filters.shift !== "Todos") params.set("shift", filters.shift);
    if (filters.collaborator) params.set("collaborator", filters.collaborator);
    if (filters.status !== "Todos") params.set("status", filters.status);
    if (filters.source !== "Todos") params.set("source", filters.source);
    return `/api/work-hours/export?${params.toString()}`;
  }

  return (
    <div>
      <PageHeader
        title="Horas Operacionais"
        description="Upload, conferência e ajuste das horas realizadas versus cronograma planejado"
        icon={Clock}
        actions={
          <div className="flex flex-wrap gap-2">
            {canUpload ? <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(event) => handleWorkHourFile(event.target.files?.[0])} /> : null}
            {canUpload ? (
              <button onClick={() => fileInputRef.current?.click()} className="flex h-11 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-bold text-white shadow-soft">
                <Upload className="h-4 w-4" />
                Upload horas
              </button>
            ) : null}
            <button type="button" disabled={downloadingWorkHourTemplate} onClick={downloadWorkHourTemplate} className="flex h-11 items-center gap-2 rounded-lg border border-border bg-white px-4 text-sm font-bold text-navy-950 shadow-soft disabled:cursor-not-allowed disabled:opacity-60">
              <Download className="h-4 w-4" />
              {downloadingWorkHourTemplate ? "Baixando..." : "Baixar template"}
            </button>
            {["ADMIN", "GESTOR", "WFM", "SUPERVISOR"].includes(normalizedRole) ? (
              <a href={exportUrl()} className="flex h-11 items-center gap-2 rounded-lg border border-border bg-white px-4 text-sm font-bold text-navy-950 shadow-soft">
                <FileText className="h-4 w-4" />
                Exportar CSV
              </a>
            ) : null}
          </div>
        }
      />

      {message ? <div className="mb-5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700">{message}</div> : null}

      <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Horas previstas" value={`${summary?.plannedHours ?? 0}h`} helper="cronograma planejado" icon={Clock} tone="blue" />
        <StatCard title="Horas realizadas" value={`${summary?.actualHours ?? 0}h`} helper="apontamento importado" icon={CheckCircle2} tone="green" />
        <StatCard title="Diferença total" value={`${summary?.differenceHours ?? 0}h`} helper="realizado - previsto" icon={AlertTriangle} tone={(summary?.differenceHours ?? 0) < 0 ? "orange" : "cyan"} />
        <StatCard title="Ajustes pendentes" value={summary?.pendingAdjustments ?? 0} helper="aguardando WFM/Admin" icon={ClipboardList} tone={(summary?.pendingAdjustments ?? 0) ? "orange" : "green"} />
      </div>
      <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricPill value={summary?.okRecords ?? 0} label="Registros OK" />
        <MetricPill value={summary?.divergentRecords ?? 0} label="Divergentes" />
        <MetricPill value={summary?.noScheduleRecords ?? 0} label="Sem cronograma vinculado" />
        <MetricPill value={formatBreakDuration(summary?.breakMinutes ?? 0)} label="Pausas totais" />
        <MetricPill value={`${summary?.adjustedHours ?? 0}h`} label="Horas ajustadas" />
      </div>

      <section className="card mb-5 p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-9">
          <FormInput label="Data inicial" type="date" value={filters.startDate} onChange={(value) => setFilters({ ...filters, startDate: value })} />
          <FormInput label="Data final" type="date" value={filters.endDate} onChange={(value) => setFilters({ ...filters, endDate: value })} />
          <FormSelect label="LOB" value={filters.lob} options={lobOptions} onChange={(value) => setFilters({ ...filters, lob: value })} />
          <FormInput label="Supervisor" value={filters.supervisor} onChange={(value) => setFilters({ ...filters, supervisor: value })} />
          <FormSelect label="Turno" value={filters.shift} options={shiftOptions} onChange={(value) => setFilters({ ...filters, shift: value })} />
          <FormInput label="Colaborador/WB" value={filters.collaborator} onChange={(value) => setFilters({ ...filters, collaborator: value })} />
          <FormSelect label="Status" value={filters.status} options={statusOptions} onChange={(value) => setFilters({ ...filters, status: value })} />
          <FormSelect label="Origem" value={filters.source} options={sourceOptions} onChange={(value) => setFilters({ ...filters, source: value })} />
          <div className="flex items-end gap-2">
            <button onClick={() => loadWorkHours(1)} className="h-11 flex-1 rounded-lg bg-blue-600 px-3 text-sm font-bold text-white">Filtrar</button>
            <button onClick={() => { setFilters({ startDate: "2026-05-01", endDate: "2026-05-31", lob: "Todos", supervisor: "", shift: "Todos", collaborator: "", status: "Todos", source: "Todos", divergentOnly: false, pendingOnly: false, noScheduleOnly: false }); setTimeout(() => void loadWorkHours(1), 0); }} className="h-11 rounded-lg border border-border bg-white px-3 text-sm font-bold">Limpar</button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-sm font-semibold text-navy-950">
          <label className="flex items-center gap-2"><input type="checkbox" checked={filters.divergentOnly} onChange={(event) => setFilters({ ...filters, divergentOnly: event.target.checked, pendingOnly: false, noScheduleOnly: false })} /> Apenas divergentes</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={filters.pendingOnly} onChange={(event) => setFilters({ ...filters, pendingOnly: event.target.checked, divergentOnly: false, noScheduleOnly: false })} /> Ajuste pendente</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={filters.noScheduleOnly} onChange={(event) => setFilters({ ...filters, noScheduleOnly: event.target.checked, divergentOnly: false, pendingOnly: false })} /> Sem cronograma</label>
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-lg font-extrabold text-navy-950">Painel de horas</h2>
            <p className="text-sm text-muted">{loading ? "Carregando..." : `${pagination.total} registro(s) no período`}</p>
          </div>
          {!canUpload && normalizedRole === "SUPERVISOR" ? <StatusBadge status="Supervisor solicita ajuste; WFM aprova" /> : null}
        </div>
        <div className="overflow-x-auto">
          {rows.length ? (
            <table className="w-full min-w-[1360px] text-left text-sm">
              <thead className="border-b border-border bg-slate-50 text-xs font-bold uppercase tracking-wide text-muted">
                <tr>
                  {["Data", "Colaborador", "WB/Login", "LOB", "Supervisor", "Turno", "Previsto", "Realizado", "Pausa", "Efetivo", "Dif.", "Status", "Origem", "Ajuste", "Ações"].map((column) => <th key={column} className="px-4 py-3">{column}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-white">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-blue-50/30">
                    <td className="px-4 py-3 font-bold text-navy-950">{row.date}</td>
                    <td className="px-4 py-3">{row.employeeName}</td>
                    <td className="px-4 py-3">{row.wbLogin}</td>
                    <td className="px-4 py-3">{row.lob}</td>
                    <td className="px-4 py-3">{row.supervisor || "-"}</td>
                    <td className="px-4 py-3">{cleanShiftName(row.shift) || "-"}</td>
                    <td className="px-4 py-3">{row.plannedStart || "--"} às {row.plannedEnd || "--"} • {row.plannedHours || 0}h</td>
                    <td className="px-4 py-3">{row.actualStart || "--"} às {row.actualEnd || "--"} • {row.actualHours}h</td>
                    <td className="px-4 py-3">{formatBreakDuration(row.effectiveBreakMinutes ?? row.breakMinutes ?? 0)}</td>
                    <td className="px-4 py-3">{row.effectiveHours}h</td>
                    <td className={cn("px-4 py-3 font-bold", row.differenceMinutes < 0 ? "text-red-600" : row.differenceMinutes > 0 ? "text-emerald-600" : "text-muted")}>{row.differenceMinutes}min</td>
                    <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                    <td className="px-4 py-3">{row.source || "-"}</td>
                    <td className="px-4 py-3"><StatusBadge status={row.adjustmentStatus} /></td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {canRequestAdjustment && !["Ajuste solicitado", "Ajuste aprovado"].includes(row.status) ? (
                          <button onClick={() => openAdjustment(row)} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">Solicitar ajuste</button>
                        ) : null}
                        {canApprove && row.adjustmentId && row.adjustmentStatus === "Em análise" ? (
                          <>
                            <button onClick={() => openReview(row, "approve")} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white">Aprovar</button>
                            <button onClick={() => openReview(row, "reject")} className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">Recusar</button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-8"><EmptyState title="Nenhum registro de horas" description="Importe horas realizadas ou ajuste os filtros do período." /></div>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-border px-5 py-4 text-sm text-muted">
          <span>Página {pagination.page} de {pagination.totalPages}</span>
          <div className="flex gap-2">
            <button disabled={pagination.page <= 1} onClick={() => loadWorkHours(pagination.page - 1)} className="rounded-lg border border-border bg-white px-3 py-2 font-bold disabled:opacity-40">Anterior</button>
            <button disabled={pagination.page >= pagination.totalPages} onClick={() => loadWorkHours(pagination.page + 1)} className="rounded-lg border border-border bg-white px-3 py-2 font-bold disabled:opacity-40">Próxima</button>
          </div>
        </div>
      </section>

      {showPreview && preview ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4 backdrop-blur-sm">
          <div className="card max-h-[86vh] w-full max-w-6xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h2 className="text-lg font-extrabold text-navy-950">Preview do upload de horas</h2>
                <p className="text-sm text-muted">{preview.fileName} • {preview.totalRows} linha(s)</p>
              </div>
              <button onClick={() => setShowPreview(false)} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-slate-100">×</button>
            </div>
            <div className="grid gap-4 p-5 lg:grid-cols-[1fr_300px]">
              <div className="max-h-[58vh] overflow-auto rounded-lg border border-border">
                <table className="w-full min-w-[980px] text-left text-xs">
                  <thead className="bg-slate-50 font-bold text-muted">
                    <tr>
                      <th className="px-3 py-2">Linha</th>
                      <th className="px-3 py-2">WB/Login</th>
                      <th className="px-3 py-2">Colaborador</th>
                      <th className="px-3 py-2">Data</th>
                      <th className="px-3 py-2">Entrada</th>
                      <th className="px-3 py-2">Saída</th>
                      <th className="px-3 py-2">Pausa</th>
                      <th className="px-3 py-2">Horas</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Ação</th>
                      <th className="px-3 py-2">Erros/alertas</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border bg-white">
                    {preview.validation.slice(0, 300).map((row) => (
                      <tr key={row.rowNumber}>
                        <td className="px-3 py-2 font-bold">{row.rowNumber}</td>
                        <td className="px-3 py-2">{row.wbLogin}</td>
                        <td className="px-3 py-2">{row.employeeName || "-"}</td>
                        <td className="px-3 py-2">{row.date || "-"}</td>
                        <td className="px-3 py-2">{row.actualStart || "-"}</td>
                        <td className="px-3 py-2">{row.actualEnd || "-"}</td>
                        <td className="px-3 py-2">{formatBreakDuration(row.breakMinutes ?? 0)}</td>
                        <td className="px-3 py-2">{row.actualHours ?? "-"}</td>
                        <td className="px-3 py-2"><StatusBadge status={row.status} /></td>
                        <td className="px-3 py-2">{row.action}</td>
                        <td className="px-3 py-2">
                          {[...row.errors, ...row.warnings].length ? [...row.errors, ...row.warnings].join(" | ") : "OK"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="space-y-3">
                <MetricPill value={preview.validRows} label="Linhas válidas" />
                <MetricPill value={preview.errorRows} label="Linhas com erro" />
                <MetricPill value={preview.warningRows} label="Alertas" />
                <MetricPill value={preview.createdRows} label="Novos registros" />
                <MetricPill value={preview.updatedRows} label="Atualizações" />
                <p className="text-sm text-muted">WB/Login inexistente bloqueia a linha. Sem cronograma vinculado vira alerta e pode ser importado.</p>
                {preview.validation.length > 300 ? <p className="text-xs font-semibold text-muted">Exibindo as primeiras 300 linhas no preview para manter a tela rápida. O commit processa todas as linhas válidas.</p> : null}
                <button disabled={savingImport} onClick={commitWorkHourImport} className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-60">
                  {savingImport ? "Importando..." : "Confirmar importação"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showAdjustment && selectedRow ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-2xl p-5">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-extrabold text-navy-950">Solicitar ajuste de horas</h2>
                <p className="text-sm text-muted">{selectedRow.employeeName} • {selectedRow.date} • {selectedRow.wbLogin}</p>
              </div>
              <button onClick={() => setShowAdjustment(false)} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-slate-100">×</button>
            </div>
            <div className="grid gap-4 md:grid-cols-4">
              <FormInput label="Nova entrada" value={adjustmentForm.requestedActualStart} onChange={(value) => setAdjustmentForm({ ...adjustmentForm, requestedActualStart: value })} />
              <FormInput label="Nova saída" value={adjustmentForm.requestedActualEnd} onChange={(value) => setAdjustmentForm({ ...adjustmentForm, requestedActualEnd: value })} />
              <FormInput label="Nova pausa (min)" value={adjustmentForm.requestedBreakMinutes} onChange={(value) => setAdjustmentForm({ ...adjustmentForm, requestedBreakMinutes: value })} />
              <FormInput label="Novas horas líquidas" value={adjustmentForm.requestedActualHours} onChange={(value) => setAdjustmentForm({ ...adjustmentForm, requestedActualHours: value })} />
              <div className="md:col-span-4">
                <FormSelect label="Motivo" value={adjustmentForm.reason} options={["Erro de apontamento", "Sistema não capturou horário", "Feedback/treinamento durante o turno", "Problema técnico", "Ajuste manual autorizado", "Erro no upload", "Atividade operacional fora do sistema", "Outro"]} onChange={(value) => setAdjustmentForm({ ...adjustmentForm, reason: value })} />
              </div>
              <label className="md:col-span-4">
                <span className="mb-1.5 block text-sm font-bold text-muted">Justificativa</span>
                <textarea value={adjustmentForm.justification} onChange={(event) => setAdjustmentForm({ ...adjustmentForm, justification: event.target.value })} className="min-h-28 w-full rounded-lg border border-border p-3 outline-none" />
              </label>
            </div>
            <button disabled={savingAdjustment} onClick={submitAdjustment} className="mt-5 w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-60">
              {savingAdjustment ? "Enviando..." : "Enviar para WFM/Admin"}
            </button>
          </div>
        </div>
      ) : null}

      {showReview && selectedRow ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-xl p-5">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-extrabold text-navy-950">{adjustmentAction === "approve" ? "Aprovar ajuste" : "Recusar ajuste"}</h2>
                <p className="text-sm text-muted">{selectedRow.employeeName} • {selectedRow.date}</p>
              </div>
              <button onClick={() => setShowReview(false)} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-slate-100">×</button>
            </div>
            {adjustmentAction === "reject" ? (
              <label>
                <span className="mb-1.5 block text-sm font-bold text-muted">Motivo da recusa</span>
                <textarea value={adjustmentForm.rejectionReason} onChange={(event) => setAdjustmentForm({ ...adjustmentForm, rejectionReason: event.target.value })} className="min-h-28 w-full rounded-lg border border-border p-3 outline-none" />
              </label>
            ) : (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">
                Ao aprovar, as horas ajustadas passam a valer como horas efetivas oficiais.
              </div>
            )}
            <button disabled={savingAdjustment} onClick={reviewAdjustment} className={cn("mt-5 w-full rounded-lg px-4 py-3 text-sm font-bold text-white disabled:opacity-60", adjustmentAction === "approve" ? "bg-emerald-600" : "bg-red-600")}>
              {savingAdjustment ? "Processando..." : adjustmentAction === "approve" ? "Aprovar ajuste" : "Recusar ajuste"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const templateRows = [
  {
    wb_login: "WB1001",
    data: "2026-05-15",
    status: "Escalado",
    turno: "Manhã",
    entrada: "06:00",
    saida: "14:00",
    lob: "CEC"
  }
];

function validateImportRows(rows: Array<Record<string, unknown>>) {
  if (!rows.length) return { errors: 0, warnings: 0 };
  const required = ["wb_login", "data", "status", "turno", "entrada", "saida", "lob"];
  const errors = rows.reduce((acc, row) => acc + required.filter((field) => !row[field]).length, 0);
  const warnings = rows.filter((row) => row.lob && !["CEC", "TNS", "ADS"].includes(String(row.lob))).length;
  return { errors, warnings };
}

function emptyCalendarDays() {
  return Array.from({ length: 42 }).map((_, index) => {
    const dayNumber = index - 4;
    const outside = dayNumber < 1 || dayNumber > 31;
    const date = outside ? (dayNumber < 1 ? 30 + dayNumber : dayNumber - 31) : dayNumber;
    return { date, outside, shift: "Sem cronograma", label: "Sem cronograma" };
  });
}

function shiftTagClass(value: string) {
  const map: Record<string, string> = {
    Manhã: "bg-blue-50 text-blue-700",
    Tarde: "bg-blue-50 text-blue-700",
    Noite: "bg-blue-50 text-blue-700",
    Escalado: "bg-blue-50 text-blue-700",
    Presente: "bg-emerald-50 text-emerald-700",
    Ausente: "bg-red-50 text-red-700",
    Falta: "bg-red-100 text-red-800",
    "Falta sem justificativa": "border border-red-300 bg-red-100 text-red-900 shadow-sm shadow-red-100",
    "Ausente sem justificativa": "border border-orange-300 bg-orange-100 text-orange-900 shadow-sm shadow-orange-100",
    "Atraso sem justificativa": "border border-orange-300 bg-orange-100 text-orange-900 shadow-sm shadow-orange-100",
    "Saída antecipada sem justificativa": "border border-orange-300 bg-orange-100 text-orange-900 shadow-sm shadow-orange-100",
    "Afastado sem justificativa": "border border-violet-300 bg-violet-100 text-violet-900 shadow-sm shadow-violet-100",
    "Erro de cronograma sem justificativa": "border border-red-300 bg-red-100 text-red-900 shadow-sm shadow-red-100",
    "Falta justificada": "bg-amber-50 text-amber-800",
    "Ausente justificada": "bg-amber-50 text-amber-800",
    "Atraso justificada": "bg-amber-50 text-amber-800",
    "Saída antecipada justificada": "bg-amber-50 text-amber-800",
    "Afastado justificada": "bg-amber-50 text-amber-800",
    "Erro de cronograma justificada": "bg-amber-50 text-amber-800",
    Atraso: "bg-orange-50 text-orange-700",
    "Saída antecipada": "bg-orange-100 text-orange-800",
    Afastado: "bg-violet-50 text-violet-700",
    Férias: "bg-sky-50 text-sky-700",
    Treinamento: "bg-purple-50 text-purple-700",
    Nesting: "bg-fuchsia-50 text-fuchsia-700",
    Folga: "bg-slate-100 text-slate-600",
    "Troca aprovada": "bg-teal-50 text-teal-700",
    "Venda de folga aprovada": "bg-amber-50 text-amber-700",
    "Folga aprovada": "bg-emerald-50 text-emerald-700",
    "Sem cronograma": "bg-slate-50 text-slate-400",
    "Erro de cronograma": "bg-red-50 text-red-700",
    Feriado: "bg-pink-50 text-pink-700",
    Conflito: "bg-red-50 text-red-600",
    Descoberto: "border border-dashed border-red-400 text-red-600"
  };
  return map[value] ?? "bg-slate-100 text-slate-600";
}

const requestTypes = ["Troca de Folga", "Venda de Folga", "Solicitação de Dia de Folga", "Ajuste de cronograma", "Correção de cronograma", "Equipamento", "Acesso", "RH", "Qualidade", "WFM", "Operação", "Suporte geral"];
const requestPriorities = ["Baixa", "Média", "Alta", "Crítica"];
const requestStatuses = ["Aberto", "Em análise", "Aprovado", "Recusado", "Concluído", "Cancelado"];
const requestColumns = ["Aberto", "Em análise", "Aprovado", "Recusado", "Concluído", "Cancelado"];

function isDayOffRequest(type: string) {
  return /troca de folga|venda de folga|dia de folga/i.test(type);
}

function RequestDetailContent({
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
  const isAdminLike = ["ADMIN", "GESTOR"].includes(actorRole);
  const canSupervisorStep = selected.status === "Aberto" && (actorRole === "SUPERVISOR" || isAdminLike);
  const canWfmFinal = selected.status === "Em análise" && (actorRole === "WFM" || isAdminLike);
  const canReject = canSupervisorStep || canWfmFinal;
  const canConclude = selected.status === "Aprovado" && (actorRole === "WFM" || isAdminLike);
  const canCancel = !isProcessed && !isApproved && ((actorRole === "COLABORADOR" && selected.status === "Aberto") || actorRole === "WFM" || isAdminLike);
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
        ) : payload.requestedDate ? (
          <p className="mt-3"><strong>Data desejada:</strong> {String(payload.requestedDate)}</p>
        ) : null}
      </div>

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

export function RequestsPage() {
  const [requests, setRequests] = useState<ClientRequest[]>([]);
  const [selected, setSelected] = useState<ClientRequest | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [actorRole, setActorRole] = useState("ADMIN");
  const [actionReason, setActionReason] = useState("");
  const [comment, setComment] = useState("");
  const [actionPending, setActionPending] = useState("");
  const [filters, setFilters] = useState({ type: "Todos", status: "Todos", priority: "Todos", requester: "", assignee: "", date: "" });
  const [newRequest, setNewRequest] = useState({
    type: "Troca de Folga",
    title: "Troca de Folga",
    priority: "Média",
    requestedDate: "",
    dayOffKind: "DAY_OFF_SWAP" as DayOffKind,
    currentDayOffDate: "2026-05-03",
    desiredDayOffDate: "2026-05-06",
    dayOffToSellDate: "2026-05-03",
    availabilityShift: "Manhã",
    preferredStartTime: "",
    preferredEndTime: "",
    acknowledgement: false,
    desiredDayOffRequestDate: "2026-05-08",
    dayOffReason: "Pessoal",
    urgency: "Média",
    justification: "",
    description: "",
    attachmentUrl: ""
  });

  useEffect(() => {
    void loadRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadRequests(nextFilters = filters) {
    const params = new URLSearchParams();
    Object.entries(nextFilters).forEach(([key, value]) => {
      if (value && value !== "Todos") params.set(key, value);
    });

    apiJson<{ data: ClientRequest[]; actor?: { role: string; name: string } }>(`/api/requests?${params.toString()}`)
      .then((payload) => {
        setRequests(payload.data);
        setSelected((current) => payload.data.find((item) => item.id === current?.id) ?? payload.data[0] ?? null);
        setActorRole(payload.actor?.role ?? "ADMIN");
      })
      .catch(() => setRequests([]));
  }

  async function moveStatus(id: string, status: string, actionInput?: Record<string, string>) {
    if (actionPending) return;
    const reason = actionReason.trim();
    if (status === "Recusado" && !reason) {
      setActionMessage("Informe o motivo da recusa antes de continuar.");
      return;
    }

    setActionPending(`${id}:${status}`);
    try {
      const payload = await apiJson<{ data: ClientRequest; scheduleUpdated: boolean }>("/api/requests/status", {
        method: "PATCH",
        body: JSON.stringify({ id, status, reason: reason || `Movido para ${status}.`, actionInput })
      });
      setRequests((items) => items.map((item) => (item.id === id ? payload.data : item)));
      setSelected((item) => (item?.id === id ? payload.data : item));
      setActionReason("");
      setActionMessage(payload.scheduleUpdated ? "Troca de folga aprovada e cronograma atualizado automaticamente." : `Solicitação ${payload.data.id} movida para ${payload.data.status}.`);
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Não foi possível atualizar a solicitação.");
    } finally {
      setActionPending("");
    }
  }

  async function submitRequest() {
    const dayOffKind = isDayOffRequest(newRequest.type) ? newRequest.dayOffKind : null;
    if (dayOffKind) {
      if (!newRequest.justification.trim()) {
        setActionMessage("Informe a justificativa da solicitação de folga.");
        return;
      }
      if (dayOffKind === "DAY_OFF_SWAP") {
        if (!newRequest.currentDayOffDate || !newRequest.desiredDayOffDate) {
          setActionMessage("Para troca de folga, informe data atual e nova data desejada.");
          return;
        }
        if (newRequest.currentDayOffDate === newRequest.desiredDayOffDate) {
          setActionMessage("A nova data não pode ser igual à data atual da folga.");
          return;
        }
      }
      if (dayOffKind === "DAY_OFF_SELL") {
        if (!newRequest.dayOffToSellDate) {
          setActionMessage("Informe a data da folga que deseja vender.");
          return;
        }
        if (!newRequest.availabilityShift && (!newRequest.preferredStartTime || !newRequest.preferredEndTime)) {
          setActionMessage("Informe o turno desejado ou a disponibilidade de horário.");
          return;
        }
        if (!newRequest.acknowledgement) {
          setActionMessage("Confirme a ciência de que a venda depende de aprovação.");
          return;
        }
      }
      if (dayOffKind === "DAY_OFF_REQUEST" && (!newRequest.desiredDayOffRequestDate || !newRequest.dayOffReason)) {
        setActionMessage("Informe a data desejada e o motivo da folga.");
        return;
      }
    }

    try {
      const payload = await apiJson<{ data: ClientRequest }>("/api/requests", {
        method: "POST",
        body: JSON.stringify({
          type: newRequest.type,
          title: newRequest.title || newRequest.type,
          priority: dayOffKind === "DAY_OFF_REQUEST" ? newRequest.urgency : newRequest.priority,
          description: newRequest.description || newRequest.justification || "Solicitação criada pelo portal operacional.",
          requestedDate: newRequest.requestedDate || undefined,
          dayOffKind: dayOffKind ?? undefined,
          currentDayOffDate: dayOffKind === "DAY_OFF_SWAP" ? newRequest.currentDayOffDate : undefined,
          desiredDayOffDate: dayOffKind === "DAY_OFF_SWAP" ? newRequest.desiredDayOffDate : undefined,
          dayOffToSellDate: dayOffKind === "DAY_OFF_SELL" ? newRequest.dayOffToSellDate : undefined,
          availabilityShift: dayOffKind === "DAY_OFF_SELL" ? newRequest.availabilityShift : undefined,
          preferredStartTime: dayOffKind === "DAY_OFF_SELL" ? newRequest.preferredStartTime : undefined,
          preferredEndTime: dayOffKind === "DAY_OFF_SELL" ? newRequest.preferredEndTime : undefined,
          acknowledgement: dayOffKind === "DAY_OFF_SELL" ? newRequest.acknowledgement : undefined,
          desiredDayOffRequestDate: dayOffKind === "DAY_OFF_REQUEST" ? newRequest.desiredDayOffRequestDate : undefined,
          dayOffReason: dayOffKind === "DAY_OFF_REQUEST" ? newRequest.dayOffReason : undefined,
          urgency: dayOffKind === "DAY_OFF_REQUEST" ? newRequest.urgency : undefined,
          justification: newRequest.justification || undefined,
          attachmentUrl: newRequest.attachmentUrl || undefined
        })
      });
      setRequests((items) => [payload.data, ...items]);
      setSelected(payload.data);
      setShowCreate(false);
      setActionMessage(`Solicitação ${payload.data.id} criada com sucesso e enviada para a esteira.`);
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Não foi possível criar a solicitação.");
    }
  }

  async function submitComment(id: string) {
    if (!comment.trim()) {
      setActionMessage("Digite um comentário antes de enviar.");
      return;
    }

    try {
      const payload = await apiJson<{ data: ClientRequest }>("/api/requests/comments", {
        method: "POST",
        body: JSON.stringify({ id, body: comment })
      });
      setRequests((items) => items.map((item) => (item.id === id ? payload.data : item)));
      setSelected(payload.data);
      setComment("");
      setActionMessage("Comentário registrado na solicitação.");
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Não foi possível comentar.");
    }
  }

  return (
    <div>
      <PageHeader
        title="Solicitações"
        description="Crie, acompanhe, aprove e conclua solicitações operacionais"
        icon={ClipboardList}
        actions={
          <button onClick={() => setShowCreate(true)} className="flex h-11 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-bold text-white">
            <Plus className="h-4 w-4" />
            Nova solicitação
          </button>
        }
      />
      <div className="card mb-5 grid gap-3 p-4 md:grid-cols-3 xl:grid-cols-6">
        <select value={filters.type} onChange={(event) => setFilters({ ...filters, type: event.target.value })} className="h-11 rounded-lg border border-border px-3 text-sm font-bold outline-none">
          {["Todos", ...requestTypes].map((type) => <option key={type}>{type}</option>)}
        </select>
        <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })} className="h-11 rounded-lg border border-border px-3 text-sm font-bold outline-none">
          {["Todos", ...requestStatuses].map((status) => <option key={status}>{status}</option>)}
        </select>
        <select value={filters.priority} onChange={(event) => setFilters({ ...filters, priority: event.target.value })} className="h-11 rounded-lg border border-border px-3 text-sm font-bold outline-none">
          {["Todos", ...requestPriorities].map((priority) => <option key={priority}>{priority}</option>)}
        </select>
        <input value={filters.requester} onChange={(event) => setFilters({ ...filters, requester: event.target.value })} className="h-11 rounded-lg border border-border px-3 text-sm outline-none" placeholder="Solicitante" />
        <input type="date" value={filters.date} onChange={(event) => setFilters({ ...filters, date: event.target.value })} className="h-11 rounded-lg border border-border px-3 text-sm outline-none" />
        <button onClick={() => loadRequests(filters)} className="h-11 rounded-lg bg-navy-950 px-4 text-sm font-extrabold text-white">Atualizar</button>
      </div>
      {actionMessage ? (
        <div className="mb-5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700">{actionMessage}</div>
      ) : null}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_430px]">
        <Panel title="Lista de Solicitações">
          {requests.length ? (
            <SimpleTable
              columns={["Código", "Tipo", "Solicitante", "Prioridade", "Status", "Área", "Data"]}
              rows={requests.map((request) => [
                <button key={request.id} onClick={() => setSelected(request)} className="font-extrabold text-blue-600">{request.id}</button>,
                <div key={`${request.id}-type`}><p className="font-bold text-navy-950">{request.type}</p><p className="text-xs text-muted">{request.title}</p></div>,
                request.requester,
                <PriorityBadge key={`${request.id}-p`} priority={request.priority} />,
                <StatusBadge key={`${request.id}-s`} status={request.status} />,
                request.area,
                request.time
              ])}
            />
          ) : <EmptyState title="Nenhuma solicitação encontrada" description="As solicitações criadas pelos colaboradores aparecerão aqui." />}
        </Panel>
        <Panel title="Detalhe da Solicitação">
          <RequestDetailContent selected={selected} actorRole={actorRole} actionReason={actionReason} setActionReason={setActionReason} comment={comment} setComment={setComment} onMove={moveStatus} onComment={submitComment} actionPending={actionPending} />
        </Panel>
      </div>
      {showCreate ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-xl p-5">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-extrabold text-navy-950">Nova solicitação</h2>
              <button onClick={() => setShowCreate(false)} className="text-2xl text-muted">×</button>
            </div>
            <div className="space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-muted">Tipo</span>
                <select
                  value={newRequest.type}
                  onChange={(event) => {
                    const type = event.target.value;
                    const dayOffKind = dayOffKindFromRequest({ type });
                    setNewRequest({ ...newRequest, type, title: type, dayOffKind: dayOffKind ?? newRequest.dayOffKind });
                  }}
                  className="h-11 w-full rounded-lg border border-border px-3 outline-none"
                >
                  {requestTypes.map((type) => (
                    <option key={type}>{type}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-muted">Título</span>
                <input value={newRequest.title} onChange={(event) => setNewRequest({ ...newRequest, title: event.target.value })} className="h-11 w-full rounded-lg border border-border px-3 outline-none" placeholder="Resumo da solicitação" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-muted">Prioridade</span>
                <select value={newRequest.priority} onChange={(event) => setNewRequest({ ...newRequest, priority: event.target.value })} className="h-11 w-full rounded-lg border border-border px-3 outline-none">
                  {requestPriorities.map((priority) => (
                    <option key={priority}>{priority}</option>
                  ))}
                </select>
              </label>
              {isDayOffRequest(newRequest.type) ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {newRequest.dayOffKind === "DAY_OFF_SWAP" ? (
                    <>
                      <label className="block">
                        <span className="mb-1.5 block text-sm font-semibold text-muted">Data atual da folga</span>
                        <input type="date" value={newRequest.currentDayOffDate} onChange={(event) => setNewRequest({ ...newRequest, currentDayOffDate: event.target.value })} className="h-11 w-full rounded-lg border border-border px-3 outline-none" />
                      </label>
                      <label className="block">
                        <span className="mb-1.5 block text-sm font-semibold text-muted">Nova data desejada</span>
                        <input type="date" value={newRequest.desiredDayOffDate} onChange={(event) => setNewRequest({ ...newRequest, desiredDayOffDate: event.target.value })} className="h-11 w-full rounded-lg border border-border px-3 outline-none" />
                      </label>
                    </>
                  ) : null}
                  {newRequest.dayOffKind === "DAY_OFF_SELL" ? (
                    <>
                      <label className="block">
                        <span className="mb-1.5 block text-sm font-semibold text-muted">Data da folga que deseja vender</span>
                        <input type="date" value={newRequest.dayOffToSellDate} onChange={(event) => setNewRequest({ ...newRequest, dayOffToSellDate: event.target.value })} className="h-11 w-full rounded-lg border border-border px-3 outline-none" />
                      </label>
                      <FormSelect label="Turno desejado" value={newRequest.availabilityShift} options={Array.from(standardShiftNames)} onChange={(value) => setNewRequest({ ...newRequest, availabilityShift: value })} />
                      <FormInput label="Entrada preferencial" value={newRequest.preferredStartTime} onChange={(value) => setNewRequest({ ...newRequest, preferredStartTime: value })} />
                      <FormInput label="Saída preferencial" value={newRequest.preferredEndTime} onChange={(value) => setNewRequest({ ...newRequest, preferredEndTime: value })} />
                      <label className="md:col-span-2 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-700">
                        <input type="checkbox" checked={newRequest.acknowledgement} onChange={(event) => setNewRequest({ ...newRequest, acknowledgement: event.target.checked })} />
                        Estou ciente de que a venda de folga depende de aprovação da operação/WFM.
                      </label>
                    </>
                  ) : null}
                  {newRequest.dayOffKind === "DAY_OFF_REQUEST" ? (
                    <>
                      <label className="block">
                        <span className="mb-1.5 block text-sm font-semibold text-muted">Data desejada para folga</span>
                        <input type="date" value={newRequest.desiredDayOffRequestDate} onChange={(event) => setNewRequest({ ...newRequest, desiredDayOffRequestDate: event.target.value })} className="h-11 w-full rounded-lg border border-border px-3 outline-none" />
                      </label>
                      <FormSelect label="Motivo" value={newRequest.dayOffReason} options={["Pessoal", "Saúde", "Familiar", "Compromisso externo", "Estudos", "Emergência", "Outro"]} onChange={(value) => setNewRequest({ ...newRequest, dayOffReason: value })} />
                      <FormSelect label="Urgência" value={newRequest.urgency} options={requestPriorities} onChange={(value) => setNewRequest({ ...newRequest, urgency: value })} />
                    </>
                  ) : null}
                </div>
              ) : (
                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold text-muted">Data desejada</span>
                  <input type="date" value={newRequest.requestedDate} onChange={(event) => setNewRequest({ ...newRequest, requestedDate: event.target.value })} className="h-11 w-full rounded-lg border border-border px-3 outline-none" />
                </label>
              )}
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-muted">Justificativa</span>
                <textarea value={newRequest.justification} onChange={(event) => setNewRequest({ ...newRequest, justification: event.target.value })} className="min-h-24 w-full rounded-lg border border-border p-3 outline-none" placeholder="Explique o motivo da solicitação" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-muted">Descrição</span>
                <textarea value={newRequest.description} onChange={(event) => setNewRequest({ ...newRequest, description: event.target.value })} className="min-h-24 w-full rounded-lg border border-border p-3 outline-none" placeholder="Detalhes adicionais" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-muted">Anexo opcional</span>
                <input value={newRequest.attachmentUrl} onChange={(event) => setNewRequest({ ...newRequest, attachmentUrl: event.target.value })} className="h-11 w-full rounded-lg border border-border px-3 outline-none" placeholder="URL ou caminho do anexo" />
              </label>
              <button
                onClick={submitRequest}
                className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-bold text-white"
              >
                Criar solicitação
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function RequestsKanbanPage() {
  const [requests, setRequests] = useState<ClientRequest[]>([]);
  const [selected, setSelected] = useState<ClientRequest | null>(null);
  const [actorRole, setActorRole] = useState("ADMIN");
  const [actionMessage, setActionMessage] = useState("");
  const [actionReason, setActionReason] = useState("");
  const [comment, setComment] = useState("");
  const [actionPending, setActionPending] = useState("");
  const countByStatus = (status: string) => requests.filter((request) => request.status === status).length;

  useEffect(() => {
    apiJson<{ data: ClientRequest[]; actor?: { role: string } }>("/api/requests")
      .then((payload) => {
        setRequests(payload.data);
        setActorRole(payload.actor?.role ?? "ADMIN");
      })
      .catch(() => setRequests([]));
  }, []);

  async function moveStatus(id: string, status: string, actionInput?: Record<string, string>) {
    if (actionPending) return;
    const reason = actionReason.trim();
    if (status === "Recusado" && !reason) {
      setActionMessage("Informe o motivo da recusa.");
      return;
    }

    setActionPending(`${id}:${status}`);
    try {
      const payload = await apiJson<{ data: ClientRequest; scheduleUpdated: boolean }>("/api/requests/status", {
        method: "PATCH",
        body: JSON.stringify({ id, status, reason: reason || `Movido para ${status} pela esteira.`, actionInput })
      });
      setRequests((items) => items.map((request) => (request.id === id ? payload.data : request)));
      setSelected(payload.data);
      setActionReason("");
      setActionMessage(payload.scheduleUpdated ? "Solicitação aprovada e cronograma atualizado." : `Solicitação ${payload.data.id} atualizada para ${payload.data.status}.`);
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Não foi possível atualizar a solicitação.");
    } finally {
      setActionPending("");
    }
  }

  async function submitComment(id: string) {
    if (!comment.trim()) {
      setActionMessage("Digite um comentário antes de enviar.");
      return;
    }

    try {
      const payload = await apiJson<{ data: ClientRequest }>("/api/requests/comments", {
        method: "POST",
        body: JSON.stringify({ id, body: comment })
      });
      setRequests((items) => items.map((request) => (request.id === id ? payload.data : request)));
      setSelected(payload.data);
      setComment("");
      setActionMessage("Comentário registrado.");
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Não foi possível comentar.");
    }
  }

  return (
    <div>
      <PageHeader title="Esteiras de Solicitações" description="Acompanhe e gerencie as solicitações do time em todas as etapas do processo." icon={KanbanSquare} actions={<TopActions />} />
      {actionMessage ? <div className="mb-5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700">{actionMessage}</div> : null}
      <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        {[
          ["Total de Solicitações", requests.length, UsersRound, "blue"],
          ["Abertas", countByStatus("Aberto"), ClipboardList, "blue"],
          ["Em análise", countByStatus("Em análise"), Clock, "orange"],
          ["Aprovadas", countByStatus("Aprovado"), CheckCircle2, "green"],
          ["Recusadas", countByStatus("Recusado"), XCircle, "red"],
          ["Concluídas", countByStatus("Concluído"), ClipboardList, "cyan"]
        ].map(([title, value, Icon, tone]) => (
          <StatCard key={String(title)} title={String(title)} value={String(value)} helper="Hoje" icon={Icon as never} tone={tone as never} />
        ))}
      </div>
      {!requests.length ? <div className="mb-5"><EmptyState title="Nenhuma solicitação encontrada" description="As solicitações criadas pelos colaboradores aparecerão aqui." /></div> : null}
      <div className="grid gap-4 xl:grid-cols-3 2xl:grid-cols-6">
        {requestColumns.map((column, columnIndex) => (
          <section key={column} className="card overflow-hidden">
            <div className={cn("h-1", ["bg-blue-600", "bg-amber-500", "bg-emerald-500", "bg-red-500", "bg-slate-500", "bg-slate-400"][columnIndex])} />
            <div className="flex items-center justify-between border-b border-border px-4 py-4">
              <h2 className="font-extrabold text-navy-950">{column}</h2>
              <span className="rounded-md bg-slate-100 px-2 py-1 text-sm font-bold text-navy-950">{requests.filter((request) => request.status === column).length}</span>
            </div>
            <div className="min-h-[440px] space-y-3 p-3">
              {requests
                .filter((request) => request.status === column)
                .map((request) => {
                  const Icon = getRequestIcon(request.type);
                  const dayOffKind = dayOffKindFromRequest(request);
                  return (
                    <button key={request.id} onClick={() => setSelected(request)} className="w-full rounded-lg border border-border bg-white p-3 text-left shadow-soft transition hover:-translate-y-0.5 hover:shadow-card">
                      <div className="flex items-start gap-3">
                        <div className="grid h-10 w-10 place-items-center rounded-lg bg-blue-50 text-blue-600">
                          <Icon className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-extrabold text-navy-950">{request.type}</p>
                          <p className="text-xs text-muted">{request.area}</p>
                        </div>
                      </div>
                      {dayOffKind ? (
                        <div className="mt-3">
                          <StatusBadge status={dayOffKindLabels[dayOffKind]} />
                        </div>
                      ) : null}
                      <p className="mt-3 line-clamp-2 text-xs font-semibold text-muted">{request.title || request.description}</p>
                      <div className="mt-4 flex items-center justify-between">
                        <PriorityBadge priority={request.priority} />
                        <span className="text-xs text-muted">{request.time}</span>
                      </div>
                      <div className="mt-4 flex items-center gap-2">
                        <span className="grid h-7 w-7 place-items-center rounded-full bg-slate-200 text-[11px] font-bold">{initials(request.requester)}</span>
                        <span className="text-xs font-semibold text-muted">{request.requester}</span>
                      </div>
                    </button>
                  );
                })}
            </div>
            <button className="w-full border-t border-border py-4 text-sm font-bold text-blue-600">+ Ver mais</button>
          </section>
        ))}
      </div>
      {selected ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4 backdrop-blur-sm">
          <div className="card max-h-[88vh] w-full max-w-3xl overflow-y-auto p-5">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-extrabold text-navy-950">Detalhe da Solicitação</h2>
              <button onClick={() => setSelected(null)} className="text-2xl text-muted">×</button>
            </div>
            <RequestDetailContent selected={selected} actorRole={actorRole} actionReason={actionReason} setActionReason={setActionReason} comment={comment} setComment={setComment} onMove={moveStatus} onComment={submitComment} actionPending={actionPending} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function EmployeeMapPage() {
  const { data: session } = useSession();
  const [query, setQuery] = useState("");
  const [employeeRows, setEmployeeRows] = useState<EmployeeClient[]>([]);
  const [employeeSettings, setEmployeeSettings] = useState<SystemSettings | null>(null);
  const [selected, setSelected] = useState<EmployeeClient | null>(null);
  const [employeeMessage, setEmployeeMessage] = useState("");
  const [employeeLoading, setEmployeeLoading] = useState(true);
  const [selectedEmployeeLoading, setSelectedEmployeeLoading] = useState(false);
  const [lobFilter, setLobFilter] = useState("Todos");
  const [statusFilter, setStatusFilter] = useState("Todos");
  const [supervisorFilter, setSupervisorFilter] = useState("Todos");
  const [shiftFilter, setShiftFilter] = useState("Todos");
  const [employeePage, setEmployeePage] = useState(1);
  const [employeePagination, setEmployeePagination] = useState({ total: 0, page: 1, limit: 50, totalPages: 1 });
  const [editingEmployee, setEditingEmployee] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [socialNameDraft, setSocialNameDraft] = useState("");
  const [emailDraft, setEmailDraft] = useState("");
  const [userStatusDraft, setUserStatusDraft] = useState("ACTIVE");
  const [wbDraft, setWbDraft] = useState("");
  const [roleTitleDraft, setRoleTitleDraft] = useState("");
  const [statusDraft, setStatusDraft] = useState("");
  const [roleDraft, setRoleDraft] = useState("");
  const [supervisorDraft, setSupervisorDraft] = useState("");
  const [lobDraft, setLobDraft] = useState("");
  const [teamDraft, setTeamDraft] = useState("");
  const [shiftDraft, setShiftDraft] = useState("");
  const [scheduleDraft, setScheduleDraft] = useState("");
  const [contractDraft, setContractDraft] = useState("");
  const [admissionDraft, setAdmissionDraft] = useState("");
  const [trainingDraft, setTrainingDraft] = useState("");
  const [siteDraft, setSiteDraft] = useState("");
  const [primaryPhoneDraft, setPrimaryPhoneDraft] = useState("");
  const [cityDraft, setCityDraft] = useState("");
  const [stateUfDraft, setStateUfDraft] = useState("");
  const [preferredScheduleDraft, setPreferredScheduleDraft] = useState("");
  const [internalNotesDraft, setInternalNotesDraft] = useState("");
  const [savingEmployee, setSavingEmployee] = useState(false);
  const [employeeFieldErrors, setEmployeeFieldErrors] = useState<Record<string, string>>({});
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetPasswordForm, setResetPasswordForm] = useState({ password: "", confirmPassword: "" });
  const [resettingPassword, setResettingPassword] = useState(false);
  const employeeMapLobs = ["Todos", ...Array.from(new Set(employeeSettings?.lobs.filter((lob) => lob.status !== "INACTIVE").map((lob) => lob.name) ?? employeeRows.map((employee) => employee.lob).filter(Boolean)))];
  const employeeStatusOptions = ["Todos", "Ativos/Aprovados", "Nesting", "Pendentes", "Inativos", "Online", "Em Atendimento", "Offline"];
  const employeeSupervisorOptions = employeeSettings?.supervisors?.filter((supervisor) => supervisor.status !== "INACTIVE") ?? [];
  const hasEmployeeFilters = Boolean(query.trim()) || lobFilter !== "Todos" || statusFilter !== "Todos" || supervisorFilter !== "Todos" || shiftFilter !== "Todos";
  const isAdmin = session?.user?.role === "ADMIN";
  const isSupervisorUser = session?.user?.role === "SUPERVISOR";
  const normalizedEmployeeMapRole = String(session?.user?.role ?? "").toUpperCase();
  const canEditEmployeeOperational = ["ADMIN", "WFM", "RH", "HR", "GESTOR", "MANAGEMENT"].includes(normalizedEmployeeMapRole);
  const canEditOperationalBindings = ["ADMIN", "WFM", "GESTOR", "MANAGEMENT"].includes(normalizedEmployeeMapRole);
  const canEditPeopleData = ["ADMIN", "RH", "HR", "GESTOR", "MANAGEMENT"].includes(normalizedEmployeeMapRole);
  const employeeLobOptions = employeeSettings?.lobs.filter((lob) => lob.status !== "INACTIVE") ?? [];
  const employeeTeamOptions = employeeSettings?.teams?.filter((team) => team.status !== "INACTIVE" && (!lobDraft || team.lobId === lobDraft || team.lob === "ALL")) ?? [];
  const employeeShiftOptions = employeeSettings?.shifts.filter((shift) => shift.status !== "INACTIVE" && isSelectableShiftName(shift.name)) ?? [];
  const employeeRoleTitleOptions = employeeSettings?.roleTitles.filter((title) => title.status !== "INACTIVE").map((title) => title.name) ?? [];
  const employeeRoleOptions = employeeSettings?.roles.filter((roleItem) => roleItem.status !== "INACTIVE").map((roleItem) => roleItem.name) ?? ["COLABORADOR", "SUPERVISOR", "WFM", "QUALIDADE", "RH", "TI", "GESTOR", "ADMIN"];
  const contractOptions = ["CLT", "PJ", "Temporário", "Estágio", "Terceiro", "Outro"];
  const operationalStatusOptions = employeeOperationalStatusOptions;

  useEffect(() => {
    void loadEmployees();
    apiJson<{ data: SystemSettings }>("/api/settings")
      .then((payload) => setEmployeeSettings(payload.data))
      .catch(() => setEmployeeSettings(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadEmployees(options?: { nextQuery?: string; nextLob?: string; nextStatus?: string; nextSupervisor?: string; nextShift?: string; nextPage?: number }) {
    setEmployeeLoading(true);
    const nextQuery = options?.nextQuery ?? query;
    const nextLob = options?.nextLob ?? lobFilter;
    const nextStatus = options?.nextStatus ?? statusFilter;
    const nextSupervisor = options?.nextSupervisor ?? supervisorFilter;
    const nextShift = options?.nextShift ?? shiftFilter;
    const nextPage = options?.nextPage ?? employeePage;
    const params = new URLSearchParams({ summary: "true", limit: "50", page: String(nextPage) });
    if (nextQuery.trim()) params.set("search", nextQuery.trim());
    if (nextLob !== "Todos") params.set("lob", nextLob);
    if (nextStatus !== "Todos") params.set("status", nextStatus);
    if (nextSupervisor !== "Todos") params.set("supervisorId", nextSupervisor);
    if (nextShift !== "Todos") params.set("shiftId", nextShift);
    try {
      const employeePayload = await apiJson<EmployeeListResponse>(`/api/employees?${params.toString()}`);
      if (!employeePayload.data?.length && Number(employeePayload.total ?? 0) > 0 && nextPage > 1) {
        setEmployeePage(1);
        await loadEmployees({ nextQuery, nextLob, nextStatus, nextSupervisor, nextShift, nextPage: 1 });
        return;
      }
      setEmployeeRows(employeePayload.data);
      setEmployeePagination({
        total: employeePayload.total ?? employeePayload.data.length,
        page: employeePayload.page ?? nextPage,
        limit: employeePayload.limit ?? 50,
        totalPages: employeePayload.totalPages ?? Math.max(1, Math.ceil((employeePayload.total ?? employeePayload.data.length) / 50))
      });
      setEmployeePage(employeePayload.page ?? nextPage);
      setSelected(null);
    } catch {
      setEmployeeRows([]);
      setEmployeePagination({ total: 0, page: 1, limit: 50, totalPages: 1 });
    } finally {
      setEmployeeLoading(false);
    }
  }

  async function selectEmployee(employee: EmployeeClient) {
    setSelected(employee);
    setSelectedEmployeeLoading(true);
    try {
      const payload = await apiJson<{ data: EmployeeClient }>(`/api/employees/${employee.id}`);
      setSelected(payload.data);
      setEmployeeRows((items) => items.map((item) => (item.id === payload.data.id ? { ...item, ...payload.data } : item)));
    } catch (error) {
      setEmployeeMessage(error instanceof Error ? error.message : "Não foi possível carregar o detalhe do colaborador.");
    } finally {
      setSelectedEmployeeLoading(false);
    }
  }

  useEffect(() => {
    if (!selected) return;
    setEditingEmployee(false);
    setNameDraft(selected.name ?? "");
    setSocialNameDraft(selected.socialName ?? "");
    setEmailDraft(selected.email ?? "");
    setUserStatusDraft(selected.userStatus ?? "ACTIVE");
    setWbDraft(selected.wb ?? "");
    setRoleTitleDraft(selected.role ?? "");
    setStatusDraft(selected.status ?? "");
    setRoleDraft(selected.systemRole ?? "COLABORADOR");
    setSupervisorDraft(selected.supervisorId ?? "");
    setLobDraft(selected.lobId ?? "");
    setTeamDraft(selected.teamId ?? "");
    setShiftDraft(selected.shiftId ?? "");
    setScheduleDraft(selected.schedule ?? "");
    setContractDraft(selected.contractType ?? "");
    setAdmissionDraft(selected.admissionIso ?? "");
    setTrainingDraft(selected.trainingStartDateIso ?? "");
    setSiteDraft(selected.siteOperation ?? "");
    setPrimaryPhoneDraft(selected.primaryPhone ?? "");
    setCityDraft(selected.city ?? "");
    setStateUfDraft(selected.stateUf ?? "");
    setPreferredScheduleDraft(selected.preferredSchedule ?? "");
    setInternalNotesDraft(selected.internalNotes ?? "");
    setEmployeeFieldErrors({});
  }, [selected]);

  async function saveEmployeeOperationalData() {
    if (!selected || savingEmployee) return;
    setSavingEmployee(true);
    setEmployeeMessage("");
    setEmployeeFieldErrors({});
    try {
      const payload = await apiJson<{ data: EmployeeClient }>("/api/employees", {
        method: "PATCH",
        body: JSON.stringify({
          id: selected.id,
          fullName: canEditPeopleData ? nameDraft : undefined,
          socialName: canEditPeopleData ? socialNameDraft : undefined,
          email: canEditPeopleData ? emailDraft : undefined,
          userStatus: isAdmin ? userStatusDraft : undefined,
          wbLogin: isAdmin ? wbDraft : undefined,
          roleTitle: roleTitleDraft,
          operationalStatus: statusDraft,
          roleName: isAdmin ? roleDraft : undefined,
          supervisorId: canEditOperationalBindings ? supervisorDraft : undefined,
          lobId: canEditOperationalBindings ? lobDraft || undefined : undefined,
          teamId: canEditOperationalBindings ? teamDraft || undefined : undefined,
          shiftId: canEditOperationalBindings ? shiftDraft || undefined : undefined,
          scheduleType: canEditOperationalBindings ? scheduleDraft : undefined,
          contractType: canEditPeopleData ? contractDraft : undefined,
          admissionDate: canEditPeopleData ? admissionDraft : undefined,
          trainingStartDate: canEditPeopleData ? trainingDraft : undefined,
          siteOperation: canEditOperationalBindings ? siteDraft : undefined,
          internalNotes: canEditEmployeeOperational ? internalNotesDraft : undefined,
          primaryPhone: canEditPeopleData ? primaryPhoneDraft : undefined,
          city: canEditPeopleData ? cityDraft : undefined,
          stateUf: canEditPeopleData ? stateUfDraft : undefined,
          preferredSchedule: canEditPeopleData ? preferredScheduleDraft : undefined
        })
      });
      setEmployeeRows((items) => items.map((employee) => (employee.id === payload.data.id ? payload.data : employee)));
      setSelected(payload.data);
      setEditingEmployee(false);
      setEmployeeMessage("Dados operacionais atualizados.");
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setEmployeeFieldErrors(error.fields ?? {});
        setEmployeeMessage(error.message);
      } else {
        setEmployeeMessage(error instanceof Error ? error.message : "Não foi possível atualizar o colaborador.");
      }
    } finally {
      setSavingEmployee(false);
    }
  }

  function exportEmployeesCsv() {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (lobFilter !== "Todos") params.set("lob", lobFilter);
    if (statusFilter !== "Todos") params.set("status", statusFilter);
    if (supervisorFilter !== "Todos") params.set("supervisorId", supervisorFilter);
    if (shiftFilter !== "Todos") params.set("shiftId", shiftFilter);
    window.location.href = `/api/employees/export${params.toString() ? `?${params.toString()}` : ""}`;
  }

  async function resetSelectedPassword() {
    if (!selected || resettingPassword) return;
    setResettingPassword(true);
    setEmployeeMessage("");
    try {
      const payload = await apiJson<{ message: string }>("/api/employees/reset-password", {
        method: "POST",
        body: JSON.stringify({ employeeId: selected.id, ...resetPasswordForm })
      });
      setEmployeeMessage(payload.message ?? "Senha redefinida com sucesso.");
      setResetPasswordForm({ password: "", confirmPassword: "" });
      setShowResetPassword(false);
    } catch (error) {
      setEmployeeMessage(error instanceof ApiRequestError ? error.message : error instanceof Error ? error.message : "Não foi possível resetar a senha.");
    } finally {
      setResettingPassword(false);
    }
  }

  return (
    <div>
      <PageHeader title="Mapa de Funcionários" description="Monitore presença, status e dados operacionais da sua equipe" icon={UsersRound} actions={<button onClick={exportEmployeesCsv} className="premium-control h-10 px-4 text-sm font-extrabold text-navy-950">Exportar CSV</button>} />
      {employeeMessage ? <div className="mb-5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700">{employeeMessage}</div> : null}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-5">
          <div className="card grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-6">
            <input value={query} onChange={(event) => setQuery(event.target.value)} className="h-10 rounded-lg border border-border px-3 text-sm outline-none xl:col-span-2" placeholder="Nome, e-mail ou WB/Login" />
            <select value={lobFilter} onChange={(event) => setLobFilter(event.target.value)} className="h-10 rounded-lg border border-border px-3 text-sm font-bold">
              {employeeMapLobs.map((lob) => <option key={lob} value={lob}>{lob === "Todos" ? "Todas as LOBs" : lob}</option>)}
            </select>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-10 rounded-lg border border-border px-3 text-sm font-bold">
              {employeeStatusOptions.map((status) => <option key={status} value={status}>{status === "Todos" ? "Todos os status" : status}</option>)}
            </select>
            <select value={supervisorFilter} onChange={(event) => setSupervisorFilter(event.target.value)} className="h-10 rounded-lg border border-border px-3 text-sm font-bold">
              <option value="Todos">Todos os supervisores</option>
              {employeeSupervisorOptions.map((supervisor) => <option key={supervisor.id} value={supervisor.id}>{supervisor.name}</option>)}
            </select>
            <select value={shiftFilter} onChange={(event) => setShiftFilter(event.target.value)} className="h-10 rounded-lg border border-border px-3 text-sm font-bold">
              <option value="Todos">Todos os turnos</option>
              {employeeShiftOptions.map((shift) => <option key={shift.id} value={shift.id}>{cleanShiftName(shift.name)}</option>)}
            </select>
            <div className="flex gap-2 md:col-span-2 xl:col-span-6 xl:justify-end">
              <button onClick={() => { setEmployeePage(1); void loadEmployees({ nextPage: 1 }); }} className="h-10 rounded-lg bg-blue-600 px-5 text-sm font-bold text-white">Buscar</button>
              <button onClick={() => { setQuery(""); setLobFilter("Todos"); setStatusFilter("Todos"); setSupervisorFilter("Todos"); setShiftFilter("Todos"); setEmployeePage(1); void loadEmployees({ nextQuery: "", nextLob: "Todos", nextStatus: "Todos", nextSupervisor: "Todos", nextShift: "Todos", nextPage: 1 }); }} className="h-10 rounded-lg border border-border px-5 text-sm font-bold">Limpar filtros</button>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricPill value={employeePagination.total} label="Total encontrado" />
            <MetricPill value={employeeRows.filter((employee) => employee.status === "Online").length} label="Online na página" />
            <MetricPill value={employeeRows.filter((employee) => employee.status === "Em Atendimento").length} label="Em atendimento na página" />
            <MetricPill value={employeeRows.filter((employee) => employee.status === "Offline").length} label="Offline na página" />
          </div>
          <Panel title="Funcionários">
            {employeeLoading ? (
              <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm font-bold text-blue-700">Carregando resumo dos colaboradores...</div>
            ) : employeeRows.length ? (
              <>
                <SimpleTable
                  columns={["Nome", "E-mail", "WB/Login", "Cargo/Função", "Role", "LOB", "Supervisor", "Turno", "Status", "Ação"]}
                  rows={employeeRows.map((employee) => [
                    <button key={employee.id} onClick={() => selectEmployee(employee)} className="max-w-[180px] truncate font-bold text-blue-700" title={employee.name}>{employee.name}</button>,
                    <span key={`${employee.id}-email`} className="block max-w-[190px] truncate" title={employee.email ?? "-"}>{employee.email ?? "-"}</span>,
                    employee.wb,
                    <span key={`${employee.id}-role`} className="block max-w-[160px] truncate" title={employee.role}>{employee.role}</span>,
                    employee.systemRole ?? "-",
                    employee.lob,
                    <span key={`${employee.id}-supervisor`} className="block max-w-[160px] truncate" title={employee.supervisor}>{employee.supervisor}</span>,
                    cleanShiftName(employee.shift) || "-",
                    <StatusBadge key={`${employee.id}-status`} status={employee.status} />,
                    <button key={`${employee.id}-action`} onClick={() => selectEmployee(employee)} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">Ver detalhes</button>
                  ])}
                />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
                  <span>Página {employeePagination.page} de {employeePagination.totalPages} • {employeePagination.total} registro(s)</span>
                  <div className="flex gap-2">
                    <button disabled={employeePagination.page <= 1 || employeeLoading} onClick={() => loadEmployees({ nextPage: employeePagination.page - 1 })} className="rounded-lg border border-border px-3 py-2 text-xs font-bold text-navy-950 disabled:opacity-45">Anterior</button>
                    <button disabled={employeePagination.page >= employeePagination.totalPages || employeeLoading} onClick={() => loadEmployees({ nextPage: employeePagination.page + 1 })} className="rounded-lg border border-border px-3 py-2 text-xs font-bold text-navy-950 disabled:opacity-45">Próxima</button>
                  </div>
                </div>
              </>
            ) : (
              <div>
                <EmptyState title={hasEmployeeFilters ? "Nenhum colaborador encontrado para os filtros selecionados" : "Nenhum colaborador encontrado"} description={hasEmployeeFilters ? "Limpe os filtros para voltar a listar a base real disponível para seu perfil." : "Aprove cadastros ou importe colaboradores para iniciar a base."} />
                {hasEmployeeFilters ? (
                  <div className="mt-3 text-center">
                    <button onClick={() => { setQuery(""); setLobFilter("Todos"); setStatusFilter("Todos"); setSupervisorFilter("Todos"); setShiftFilter("Todos"); setEmployeePage(1); void loadEmployees({ nextQuery: "", nextLob: "Todos", nextStatus: "Todos", nextSupervisor: "Todos", nextShift: "Todos", nextPage: 1 }); }} className="rounded-lg border border-border px-4 py-2 text-sm font-bold text-navy-950">Limpar filtros</button>
                  </div>
                ) : null}
              </div>
            )}
          </Panel>
        </div>
        <div className="space-y-5">
          <Panel title="Perfil do Colaborador">
            {selected ? <div className="space-y-4">
              {selectedEmployeeLoading ? <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm font-bold text-blue-700">Carregando detalhes...</div> : null}
              <div className="flex items-center gap-3">
                <span className="grid h-14 w-14 place-items-center rounded-full bg-blue-600 font-bold text-white">{initials(selected.name)}</span>
                <div>
                  <h2 className="text-lg font-extrabold text-navy-950">{selected.name}</h2>
                  <p className="text-sm text-muted">{selected.wb} • {selected.role}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <InfoLine label="LOB" value={selected.lob} />
                <InfoLine label="Supervisor" value={selected.supervisor} />
                <InfoLine label="Turno" value={cleanShiftName(selected.shift) || "-"} />
                <InfoLine label="Cronograma" value={selected.schedule} />
                <InfoLine label="Admissão" value={selected.admission} />
                <InfoLine label="Status" value={selected.status} />
              </div>
              <ProfileSection title="Dados Operacionais">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <InfoLine label="Cargo/Função" value={selected.role} />
                  <InfoLine label="LOB" value={selected.lob} />
                  <InfoLine label="Status atual" value={<StatusBadge status={selected.status} />} />
                  <InfoLine label="Supervisor vinculado" value={selected.supervisor} />
                  <InfoLine label="Última presença" value={selected.lastPresence ?? "Sem registro"} />
                  <InfoLine label="E-mail operacional" value={selected.email ?? "Restrito"} />
                </div>
                {canEditEmployeeOperational ? (
                  <div className="mt-3 grid gap-3">
                    <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm font-semibold text-blue-700">
                      Dados aprovados podem ser ajustados administrativamente. Todas as alterações ficam registradas em auditoria.
                    </div>
                    {!editingEmployee ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <button onClick={() => setEditingEmployee(true)} className="rounded-lg bg-blue-600 px-3 py-2.5 text-sm font-bold text-white">
                          Editar dados
                        </button>
                        {isAdmin ? (
                          <button onClick={() => setShowResetPassword(true)} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm font-bold text-blue-700">
                            Resetar senha
                          </button>
                        ) : null}
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {Object.keys(employeeFieldErrors).length ? (
                          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
                            Existem campos inválidos. Revise os campos destacados antes de salvar.
                          </div>
                        ) : null}
                        <ProfileSection title="Identificação">
                          <div className="grid gap-3 md:grid-cols-2">
                            <FormInput label="Nome" value={nameDraft} onChange={setNameDraft} error={employeeFieldErrors.fullName} />
                            <FormInput label="Nome social" value={socialNameDraft} onChange={setSocialNameDraft} error={employeeFieldErrors.socialName} />
                            <FormInput label="E-mail de login" type="email" value={emailDraft} onChange={setEmailDraft} error={employeeFieldErrors.email} />
                            <FormInput label="WB/Login" value={wbDraft} onChange={setWbDraft} error={employeeFieldErrors.wbLogin} />
                          </div>
                        </ProfileSection>
                        <ProfileSection title="Operacional">
                          <div className="grid gap-3 md:grid-cols-2">
                            {employeeRoleTitleOptions.length ? (
                              <FormSelect label="Cargo/Função" value={roleTitleDraft} options={employeeRoleTitleOptions} onChange={setRoleTitleDraft} error={employeeFieldErrors.roleTitle} />
                            ) : (
                              <FormInput label="Cargo/Função" value={roleTitleDraft} onChange={setRoleTitleDraft} error={employeeFieldErrors.roleTitle} />
                            )}
                            {isAdmin ? <FormSelect label="Role/Permissão" value={roleDraft} options={employeeRoleOptions} onChange={setRoleDraft} error={employeeFieldErrors.roleName} /> : null}
                            {canEditOperationalBindings ? (
                              <label className="block">
                                <span className="mb-1.5 block text-sm font-bold text-muted">LOB</span>
                                <select value={lobDraft} onChange={(event) => setLobDraft(event.target.value)} className={cn("h-11 w-full rounded-lg border px-3 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100", employeeFieldErrors.lobId ? "border-red-300 bg-red-50/40" : "border-border")}>
                                  {employeeLobOptions.map((lob) => <option key={lob.id} value={lob.id}>{lob.name}</option>)}
                                </select>
                                {employeeFieldErrors.lobId ? <span className="mt-1 block text-xs font-bold text-red-600">{employeeFieldErrors.lobId}</span> : null}
                              </label>
                            ) : null}
                            {canEditOperationalBindings ? (
                              <label className="block">
                                <span className="mb-1.5 block text-sm font-bold text-muted">Time</span>
                                <select value={teamDraft} onChange={(event) => setTeamDraft(event.target.value)} className={cn("h-11 w-full rounded-lg border px-3 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100", employeeFieldErrors.teamId ? "border-red-300 bg-red-50/40" : "border-border")}>
                                  {employeeTeamOptions.map((team) => <option key={team.id} value={team.id}>{team.name} - {team.lob}</option>)}
                                </select>
                                {employeeFieldErrors.teamId ? <span className="mt-1 block text-xs font-bold text-red-600">{employeeFieldErrors.teamId}</span> : null}
                              </label>
                            ) : null}
                            {canEditOperationalBindings ? (
                              <label className="block">
                                <span className="mb-1.5 block text-sm font-bold text-muted">Supervisor</span>
                                <select value={supervisorDraft} onChange={(event) => setSupervisorDraft(event.target.value)} className={cn("h-11 w-full rounded-lg border px-3 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100", employeeFieldErrors.supervisorId ? "border-red-300 bg-red-50/40" : "border-border")}>
                                  <option value="">Sem supervisor</option>
                                  {(employeeSettings?.supervisors ?? []).map((supervisor) => (
                                    <option key={supervisor.id} value={supervisor.id}>{supervisor.name} - {supervisor.email || supervisor.lob || "supervisor"}</option>
                                  ))}
                                </select>
                                {employeeFieldErrors.supervisorId ? <span className="mt-1 block text-xs font-bold text-red-600">{employeeFieldErrors.supervisorId}</span> : null}
                              </label>
                            ) : null}
                            {canEditOperationalBindings ? (
                              <label className="block">
                                <span className="mb-1.5 block text-sm font-bold text-muted">Turno</span>
                                <select value={shiftDraft} onChange={(event) => setShiftDraft(event.target.value)} className={cn("h-11 w-full rounded-lg border px-3 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100", employeeFieldErrors.shiftId ? "border-red-300 bg-red-50/40" : "border-border")}>
                                  {employeeShiftOptions.map((shift) => <option key={shift.id} value={shift.id}>{cleanShiftName(shift.name)}</option>)}
                                </select>
                                {employeeFieldErrors.shiftId ? <span className="mt-1 block text-xs font-bold text-red-600">{employeeFieldErrors.shiftId}</span> : null}
                              </label>
                            ) : null}
                            <FormSelect label="Status" value={statusDraft} options={operationalStatusOptions} onChange={setStatusDraft} error={employeeFieldErrors.operationalStatus} />
                            {canEditOperationalBindings ? <FormInput label="Cronograma" value={scheduleDraft} onChange={setScheduleDraft} error={employeeFieldErrors.scheduleType} /> : null}
                            {canEditOperationalBindings ? <FormInput label="Site/Operação" value={siteDraft} onChange={setSiteDraft} error={employeeFieldErrors.siteOperation} /> : null}
                          </div>
                        </ProfileSection>
                        <ProfileSection title="Contrato e Datas">
                          <div className="grid gap-3 md:grid-cols-2">
                            {canEditPeopleData ? <FormSelect label="Tipo de contrato" value={contractDraft} options={contractOptions} onChange={setContractDraft} error={employeeFieldErrors.contractType} /> : null}
                            {canEditPeopleData ? <FormInput label="Data de admissão" type="date" value={admissionDraft} onChange={setAdmissionDraft} error={employeeFieldErrors.admissionDate} /> : null}
                            {canEditPeopleData ? <FormInput label="Início do treinamento" type="date" value={trainingDraft} onChange={setTrainingDraft} error={employeeFieldErrors.trainingStartDate} /> : null}
                            {isAdmin ? <FormSelect label="Usuário ativo/inativo" value={userStatusDraft} options={["ACTIVE", "INACTIVE", "BLOCKED"]} onChange={setUserStatusDraft} error={employeeFieldErrors.userStatus} /> : null}
                          </div>
                        </ProfileSection>
                        {canEditPeopleData ? (
                          <ProfileSection title="Contato Operacional">
                            <div className="grid gap-3 md:grid-cols-2">
                              <FormInput label="Contato principal" value={primaryPhoneDraft} onChange={setPrimaryPhoneDraft} error={employeeFieldErrors.primaryPhone} />
                              <FormInput label="Cidade" value={cityDraft} onChange={setCityDraft} error={employeeFieldErrors.city} />
                              <FormInput label="Estado/UF" value={stateUfDraft} onChange={setStateUfDraft} error={employeeFieldErrors.stateUf} />
                              <FormInput label="Preferência de horário" value={preferredScheduleDraft} onChange={setPreferredScheduleDraft} error={employeeFieldErrors.preferredSchedule} />
                            </div>
                          </ProfileSection>
                        ) : null}
                        <ProfileSection title="Observações">
                          <textarea value={internalNotesDraft} onChange={(event) => setInternalNotesDraft(event.target.value)} className={cn("min-h-24 w-full rounded-lg border p-3 text-sm outline-none", employeeFieldErrors.internalNotes ? "border-red-300 bg-red-50/40" : "border-border")} placeholder="Observações internas da operação" />
                          {employeeFieldErrors.internalNotes ? <span className="mt-1 block text-xs font-bold text-red-600">{employeeFieldErrors.internalNotes}</span> : null}
                        </ProfileSection>
                        <div className="grid gap-2 sm:grid-cols-3">
                          <button disabled={savingEmployee} onClick={saveEmployeeOperationalData} className="rounded-lg bg-blue-600 px-3 py-2.5 text-sm font-bold text-white disabled:opacity-50">
                            {savingEmployee ? "Salvando..." : "Salvar alterações"}
                          </button>
                          <button disabled={savingEmployee} onClick={() => setEditingEmployee(false)} className="rounded-lg border border-border bg-white px-3 py-2.5 text-sm font-bold text-navy-950 disabled:opacity-50">
                            Cancelar
                          </button>
                          {isAdmin ? (
                            <button onClick={() => setShowResetPassword(true)} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm font-bold text-blue-700">
                              Resetar senha
                            </button>
                          ) : null}
                        </div>
                        <p className="text-xs font-semibold text-muted">Mudar cargo não muda permissão automaticamente. Role/Permissão só muda quando Admin altera explicitamente.</p>
                      </div>
                    )}
                  </div>
                ) : null}
              </ProfileSection>
              {isSupervisorUser ? (
                <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm font-semibold text-blue-700">
                  Visão operacional do Supervisor: dados pessoais, bancários, familiares, documentos e contatos de emergência ficam ocultos.
                </div>
              ) : (
                <>
                  <ProfileSection title="Dados Cadastrais">
                    {selected.restrictedSections?.cadastrais ? (
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <InfoLine label="CPF" value={selected.canViewSensitive ? selected.sensitive?.cpf : selected.maskedSensitive?.cpf} />
                        <InfoLine label="RG" value={selected.canViewSensitive ? selected.sensitive?.rg : selected.maskedSensitive?.rg} />
                        <InfoLine label="Nascimento" value={selected.canViewSensitive ? selected.sensitive?.birthDate : "Acesso restrito"} />
                        <InfoLine label="Família" value={selected.canViewSensitive ? selected.sensitive?.familyData : "Acesso restrito"} />
                      </div>
                    ) : (
                      <RestrictedSection />
                    )}
                  </ProfileSection>
                  <ProfileSection title="Dados de Contato e Emergência">
                    {selected.restrictedSections?.contato || selected.restrictedSections?.emergencia ? (
                      <div className="grid gap-3 text-sm">
                        <InfoLine label="Endereço" value={selected.canViewSensitive ? selected.sensitive?.address : "Acesso restrito"} />
                        <InfoLine label="Emergência" value={selected.maskedSensitive?.emergencyContactData ?? "Acesso restrito"} />
                      </div>
                    ) : (
                      <RestrictedSection />
                    )}
                  </ProfileSection>
                  <ProfileSection title="Dados Bancários">
                    {selected.restrictedSections?.bancarios ? <InfoLine label="Banco/PIX" value={selected.sensitive?.bankData ?? selected.maskedSensitive?.bankData} /> : <RestrictedSection />}
                  </ProfileSection>
                </>
              )}
              <ProfileSection title="Histórico de Ausências">
                {selected.attendanceHistory?.length ? (
                  <MiniAlertList
                    items={selected.attendanceHistory.map((record) => ({
                      title: `${record.date} • ${cleanShiftName(record.shift) || "Sem turno"} • ${record.absenceReason ?? record.status}`,
                      status: record.status,
                      tone: record.impactsAbs ? "orange" : "green"
                    }))}
                  />
                ) : (
                  <p className="text-sm text-muted">Sem ausência recente registrada.</p>
                )}
              </ProfileSection>
            </div> : <EmptyState title="Nenhum colaborador selecionado" description="Selecione um colaborador quando houver dados reais cadastrados." />}
          </Panel>
        </div>
      </div>
      {showResetPassword && selected ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-md p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-extrabold text-navy-950">Resetar senha</h2>
                <p className="text-sm text-muted">{selected.name}</p>
              </div>
              <button onClick={() => setShowResetPassword(false)} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-slate-100">×</button>
            </div>
            <div className="grid gap-3">
              <FormInput label="Nova senha" type="password" value={resetPasswordForm.password} onChange={(value) => setResetPasswordForm({ ...resetPasswordForm, password: value })} />
              <FormInput label="Confirmar nova senha" type="password" value={resetPasswordForm.confirmPassword} onChange={(value) => setResetPasswordForm({ ...resetPasswordForm, confirmPassword: value })} />
              <label className="flex items-center gap-2 rounded-lg border border-border bg-slate-50 p-3 text-sm font-semibold text-muted">
                <input type="checkbox" disabled />
                Solicitar troca no próximo login (preparado para fase futura)
              </label>
              <button disabled={resettingPassword} onClick={resetSelectedPassword} className="rounded-lg bg-blue-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">
                {resettingPassword ? "Salvando..." : "Salvar nova senha"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ProfileSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-slate-50/60 p-3">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-black text-navy-950">{title}</h3>
      {children}
    </div>
  );
}

function RestrictedSection() {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-700">
      <LockKeyhole className="h-4 w-4" />
      Acesso restrito por permissão.
    </div>
  );
}

function InfoLine({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-white p-3">
      <p className="text-xs font-bold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 font-bold text-navy-950">{value}</p>
    </div>
  );
}

export function MuralPage() {
  const [items, setItems] = useState<AnnouncementItem[]>(announcements.map((item, index) => ({ id: `ANN-${index + 1}`, ...item })));

  useEffect(() => {
    apiJson<{ data: AnnouncementItem[] }>("/api/announcements")
      .then((payload) => setItems(payload.data))
      .catch(() => setItems(announcements.map((item, index) => ({ id: `ANN-${index + 1}`, ...item }))));
  }, []);

  async function confirmRead(announcementId: string) {
    const payload = await apiJson<{ data: AnnouncementItem[] }>("/api/announcements/read", {
      method: "POST",
      body: JSON.stringify({ announcementId })
    });
    setItems(payload.data);
  }

  return (
    <div>
      <PageHeader title="Mural de Avisos" description="Fique por dentro das comunicações, avisos e campanhas da empresa." icon={Megaphone} actions={<TopActions />} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_430px]">
        <div className="space-y-5">
          <div className="overflow-hidden rounded-xl bg-navy-950 text-white shadow-card">
            <div className="grid min-h-[240px] gap-6 p-8 md:grid-cols-[1fr_360px] md:items-center">
              <div>
                <span className="rounded-md bg-white/14 px-3 py-1 text-xs font-bold uppercase">Campanha do mês</span>
                <h2 className="mt-5 text-3xl font-extrabold">Juntos, vamos mais longe!</h2>
                <p className="mt-3 max-w-xl text-blue-100">Participe da campanha de engajamento e concorra a prêmios incríveis. Cada ação faz a diferença.</p>
                <button className="mt-6 rounded-lg bg-blue-600 px-5 py-3 text-sm font-bold">Saiba mais</button>
              </div>
              <div className="hidden h-44 rounded-xl bg-[linear-gradient(135deg,rgba(37,99,235,.55),rgba(124,58,237,.28)),url('https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=900&q=80')] bg-cover bg-center md:block" />
            </div>
          </div>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-extrabold text-navy-950">Comunicados Importantes</h2>
                <button className="text-sm font-bold text-blue-600">Ver todos</button>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                {items.map((item) => (
                  <div key={item.id} className="card p-4">
                    <StatusBadge status={item.category} />
                    <h3 className="mt-4 font-extrabold text-navy-950">{item.title}</h3>
                    <p className="mt-2 min-h-10 text-sm text-muted">{item.body}</p>
                    <div className="mt-5 flex items-center justify-between text-xs text-muted">
                      <span>{item.date}</span>
                      <button onClick={() => confirmRead(item.id)} className={cn("rounded-lg px-3 py-2 font-bold text-white", item.read ? "bg-emerald-600" : "bg-blue-600")}>
                        {item.read ? "Lido" : "Confirmar Leitura"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
            <Panel title="Avisos Fixados" action="Ver todos">
              {pinnedAnnouncements.map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.title} className="mb-4 flex items-center gap-3 border-b border-border pb-4 last:mb-0 last:border-b-0 last:pb-0">
                    <div className={cn("grid h-11 w-11 place-items-center rounded-lg", item.tone === "red" ? "bg-red-50 text-red-500" : "bg-emerald-50 text-emerald-600")}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-bold text-navy-950">{item.title}</p>
                      <p className="text-xs text-muted">{item.subtitle}</p>
                    </div>
                  </div>
                );
              })}
            </Panel>
          </div>
          <Panel title="Categorias de Comunicação">
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
              {communicationCategories.map((category) => {
                const Icon = category.icon;
                return (
                  <div key={category.label} className="rounded-lg border border-border p-4">
                    <Icon className="h-7 w-7 text-blue-600" />
                    <p className="mt-3 text-sm font-bold text-navy-950">{category.label}</p>
                    <p className="text-xs font-bold text-blue-600">{category.count}</p>
                  </div>
                );
              })}
            </div>
          </Panel>
        </div>
        <Panel title="Notificações">
          <div className="mb-4 grid grid-cols-2 rounded-lg bg-slate-50 p-1 text-center text-sm font-bold">
            <button className="rounded-md bg-white py-2 text-blue-600 shadow-soft">Não lidas 5</button>
            <button className="py-2 text-muted">Recentes</button>
          </div>
          <div className="space-y-3">
            {notificationItems.map((item) => (
              <div key={item.title} className="rounded-lg border border-border bg-white p-4">
                <p className="font-bold text-navy-950">{item.title}</p>
                <p className="text-sm text-muted">{item.body}</p>
                <p className="mt-2 text-xs text-muted">{item.date}</p>
              </div>
            ))}
          </div>
          <button onClick={() => confirmRead("ALL")} className="mt-5 w-full rounded-lg border border-border px-4 py-3 text-sm font-bold text-blue-600">Marcar todas como lidas</button>
        </Panel>
      </div>
    </div>
  );
}

export function PerformancePage() {
  return (
    <div>
      <PageHeader title="Performance e Reconhecimento" description="Acompanhe indicadores, reconheça talentos e impulsione resultados" icon={Trophy} actions={<TopActions />} />
      <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard title="Produtividade" value="122%" change="+12,5%" helper="vs mês anterior" icon={Trophy} tone="purple" />
        <StatCard title="Qualidade" value="96,4%" change="+3,1%" helper="vs mês anterior" icon={ShieldCheck} tone="green" />
        <StatCard title="Presença" value="94,8%" change="+2,4%" helper="vs mês anterior" icon={UsersRound} tone="blue" />
        <StatCard title="Aderência" value="91,2%" change="+4,8%" helper="vs mês anterior" icon={Target} tone="orange" />
        <StatCard title="Meta Atingida" value="112%" change="+8,7%" helper="vs mês anterior" icon={Award} tone="gold" />
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr_420px]">
        <Panel title="Evolução da Performance (Mês Atual)">
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={performanceEvolution}>
                <CartesianGrid stroke="#E8EDF5" />
                <XAxis dataKey="day" />
                <YAxis />
                <Tooltip />
                <Line dataKey="produtividade" stroke="#6D28D9" strokeWidth={3} />
                <Line dataKey="qualidade" stroke="#10B981" strokeWidth={3} />
                <Line dataKey="aderencia" stroke="#F97316" strokeWidth={3} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Ranking de Equipes">
          <SimpleTable columns={["Posição", "Equipe", "Prod.", "Qual.", "Total"]} rows={teamRanking.map((row) => [row[0], row[1], row[2], row[3], row[5]])} />
        </Panel>
        <Panel title="Top Performers do Mês" action="Ver todos">
          <div className="grid gap-3 sm:grid-cols-2">
            {topPerformers.slice(0, 4).map((performer, index) => (
              <div key={performer.name} className="rounded-lg border border-border p-4 text-center">
                <span className="inline-flex rounded-md bg-blue-600 px-2 py-1 text-xs font-bold text-white">{index + 1}º</span>
                <div className="mx-auto mt-3 grid h-16 w-16 place-items-center rounded-full bg-slate-100 font-bold">{initials(performer.name)}</div>
                <p className="mt-2 font-bold text-navy-950">{performer.name}</p>
                <p className="text-xs text-muted">{performer.role}</p>
                <StatusBadge status={`${performer.performance} Performance`} />
              </div>
            ))}
          </div>
        </Panel>
      </div>
      <Panel title="Melhores do Mês" action="Ver histórico">
        <div className="grid gap-4 md:grid-cols-5">
          {["Produtividade", "Qualidade", "Presença", "Aderência", "Atitude e Colaboração"].map((category, index) => (
            <div key={category} className="rounded-lg border border-border p-5 text-center">
              <Star className="mx-auto h-9 w-9 text-amber-400" />
              <p className="mt-3 text-sm font-bold text-blue-600">{category}</p>
              <p className="mt-1 font-extrabold text-navy-950">{topPerformers[index]?.name ?? "Equipe"}</p>
              <p className="text-lg font-extrabold text-blue-600">{index === 4 ? "Votos da equipe" : topPerformers[index]?.performance}</p>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

export function QualityPage() {
  const [feedbacks, setFeedbacks] = useState<QualityFeedbackItem[]>(qualityFeedback);
  const [showFeedbackForm, setShowFeedbackForm] = useState(false);
  const [feedbackForm, setFeedbackForm] = useState({
    employeeId: employees[0]?.id ?? "EMP-1",
    type: "Positivo",
    theme: "Clareza na comunicação",
    classification: "POSITIVO",
    message: ""
  });

  useEffect(() => {
    apiJson<{ data: QualityFeedbackItem[] }>("/api/quality-feedback")
      .then((payload) => setFeedbacks(payload.data))
      .catch(() => setFeedbacks(qualityFeedback));
  }, []);

  async function submitFeedback() {
    const payload = await apiJson<{ data: QualityFeedbackItem }>("/api/quality-feedback", {
      method: "POST",
      body: JSON.stringify({ ...feedbackForm, message: feedbackForm.message || "Feedback registrado para acompanhamento individual." })
    });
    setFeedbacks((items) => [payload.data, ...items]);
    setShowFeedbackForm(false);
  }

  return (
    <div>
      <PageHeader
        title="Qualidade e Feedback"
        description="Acompanhe a qualidade do atendimento e evolua com feedbacks contínuos."
        icon={ShieldCheck}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <TopActions />
            <button onClick={() => setShowFeedbackForm(true)} className="flex h-11 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-bold text-white">
              <Plus className="h-4 w-4" />
              Enviar feedback
            </button>
          </div>
        }
      />
      <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard title="Qualidade média" value="93,2%" change="+4,6 p.p." helper="vs período anterior" icon={ShieldCheck} tone="green" />
        <StatCard title="Feedbacks enviados" value="128" change="+15,2%" helper="vs período anterior" icon={MessageCircle} tone="blue" />
        <StatCard title="Pendentes de ciência" value="17" change="-8,1%" helper="vs período anterior" icon={Clock} tone="orange" />
        <StatCard title="Temas recorrentes" value="5" helper="Principais oportunidades" icon={Target} tone="purple" />
        <Panel title="Materiais de Apoio">
          {["Guia de Boas Práticas", "Comunicação Empática", "Tratamento de Objeções", "Política de Qualidade"].map((item) => (
            <div key={item} className="mb-3 flex items-center justify-between text-sm font-bold text-navy-950 last:mb-0">
              {item}
              <ChevronRight className="h-4 w-4 text-muted" />
            </div>
          ))}
        </Panel>
      </div>
      <Panel title="Pílulas de Feedback" action="Ver todas">
        <div className="grid gap-4 md:grid-cols-5">
          {feedbacks.slice(0, 5).map((feedback) => (
            <div key={`${feedback.id ?? feedback.theme}-${feedback.employee}`} className="rounded-lg border border-border p-4">
              <StatusBadge status={feedback.type} />
              <h3 className="mt-3 font-bold text-navy-950">{feedback.theme}</h3>
              <p className="mt-2 min-h-14 text-sm text-muted">{feedback.message}</p>
              <p className="mt-3 text-xs text-muted">{feedback.employee}</p>
            </div>
          ))}
        </div>
      </Panel>
      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_330px]">
        <Panel title="Histórico de Feedbacks">
          <SimpleTable
            columns={["Data/Hora", "Colaborador", "Tipo", "Tema", "Qualidade", "Status", "Feedback"]}
            rows={feedbacks.map((feedback, index) => [
              feedback.createdAt ?? `23/05/2026 0${Math.max(4, 9 - index)}:15`,
              feedback.employee,
              feedback.type,
              feedback.theme,
              <StatusBadge key={`${feedback.theme}-q`} status={feedback.quality} />,
              <StatusBadge key={`${feedback.theme}-s`} status={feedback.status} />,
              feedback.message
            ])}
          />
        </Panel>
        <Panel title="Ações Recomendadas" action="Ver todas as ações">
          <MiniAlertList
            items={[
              { title: "Reforçar prazos de retorno", status: "Ver ação", tone: "orange" },
              { title: "Treinamento: empatia", status: "Ver ação", tone: "blue" },
              { title: "Revisar template de respostas", status: "Ver ação", tone: "blue" }
            ]}
          />
        </Panel>
      </div>
      {showFeedbackForm ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-xl p-5">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-extrabold text-navy-950">Enviar feedback de qualidade</h2>
              <button onClick={() => setShowFeedbackForm(false)} className="text-2xl text-muted">×</button>
            </div>
            <div className="space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-sm font-bold text-muted">Colaborador</span>
                <select value={feedbackForm.employeeId} onChange={(event) => setFeedbackForm({ ...feedbackForm, employeeId: event.target.value })} className="h-11 w-full rounded-lg border border-border px-3">
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>{employee.name}</option>
                  ))}
                </select>
              </label>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-sm font-bold text-muted">Classificação</span>
                  <select value={feedbackForm.classification} onChange={(event) => setFeedbackForm({ ...feedbackForm, classification: event.target.value })} className="h-11 w-full rounded-lg border border-border px-3">
                    <option value="POSITIVO">Positivo</option>
                    <option value="ATENCAO">Atenção</option>
                    <option value="CRITICO">Crítico</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-bold text-muted">Tema</span>
                  <input value={feedbackForm.theme} onChange={(event) => setFeedbackForm({ ...feedbackForm, theme: event.target.value })} className="h-11 w-full rounded-lg border border-border px-3" />
                </label>
              </div>
              <label className="block">
                <span className="mb-1.5 block text-sm font-bold text-muted">Mensagem</span>
                <textarea value={feedbackForm.message} onChange={(event) => setFeedbackForm({ ...feedbackForm, message: event.target.value })} className="min-h-28 w-full rounded-lg border border-border p-3 outline-none" />
              </label>
              <button onClick={submitFeedback} className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-bold text-white">Salvar feedback</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function EquipmentPage() {
  const equipmentFileInputRef = useRef<HTMLInputElement | null>(null);
  const [rows, setRows] = useState<EquipmentItem[]>([]);
  const [summary, setSummary] = useState<EquipmentSummary>({ total: 0, inUse: 0, available: 0, maintenance: 0, returned: 0, pending: 0 });
  const [canManage, setCanManage] = useState(false);
  const [equipmentMessage, setEquipmentMessage] = useState("");
  const [equipmentFilters, setEquipmentFilters] = useState({ search: "", status: "Todos", type: "Todos", responsible: "", model: "" });
  const [equipmentForm, setEquipmentForm] = useState({
    id: "",
    numeroSerie: "",
    tipoEquipamento: "Notebook",
    modelo: "",
    responsavel: "",
    dataEntrega: new Date().toISOString().slice(0, 10),
    status: "Disponível",
    observacao: ""
  });
  const [equipmentPreview, setEquipmentPreview] = useState<EquipmentImportPreview | null>(null);
  const [savingEquipment, setSavingEquipment] = useState(false);
  const [importingEquipment, setImportingEquipment] = useState(false);

  useEffect(() => {
    void refreshEquipment();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshEquipment(filters = equipmentFilters) {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value && value !== "Todos") params.set(key, value);
    });
    const payload = await apiJson<{ data: EquipmentItem[]; summary: EquipmentSummary; canManage: boolean }>(`/api/equipment?${params.toString()}`);
    setRows(payload.data);
    setSummary(payload.summary);
    setCanManage(payload.canManage);
  }

  async function saveEquipmentForm() {
    setSavingEquipment(true);
    try {
      const payload = await apiJson<{ message: string }>("/api/equipment", {
        method: equipmentForm.id ? "PATCH" : "POST",
        body: JSON.stringify({
          id: equipmentForm.id || undefined,
          numeroSerie: equipmentForm.numeroSerie,
          tipoEquipamento: equipmentForm.tipoEquipamento,
          modelo: equipmentForm.modelo,
          responsavelWbLogin: equipmentForm.responsavel,
          responsavelEmail: equipmentForm.responsavel,
          responsavelNome: equipmentForm.responsavel,
          dataEntrega: equipmentForm.dataEntrega,
          status: equipmentForm.status,
          observacao: equipmentForm.observacao
        })
      });
      setEquipmentMessage(payload.message);
      setEquipmentForm({ id: "", numeroSerie: "", tipoEquipamento: "Notebook", modelo: "", responsavel: "", dataEntrega: new Date().toISOString().slice(0, 10), status: "Disponível", observacao: "" });
      await refreshEquipment();
    } catch (error) {
      setEquipmentMessage(error instanceof Error ? error.message : "Não foi possível salvar o equipamento.");
    } finally {
      setSavingEquipment(false);
    }
  }

  function editEquipment(item: EquipmentItem) {
    setEquipmentForm({
      id: item.id ?? "",
      numeroSerie: item.serial ?? item.code,
      tipoEquipamento: item.type,
      modelo: item.model ?? "",
      responsavel: item.employeeWbLogin || item.employeeEmail || item.employee,
      dataEntrega: item.deliveredAt || new Date().toISOString().slice(0, 10),
      status: item.status,
      observacao: item.observation ?? ""
    });
  }

  async function removeEquipment(id?: string) {
    if (!id) return;
    if (!window.confirm("Tem certeza que deseja remover este equipamento da lista ativa?")) return;
    const payload = await apiJson<{ message: string }>(`/api/equipment?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    setEquipmentMessage(payload.message);
    await refreshEquipment();
  }

  async function previewEquipmentFile(file?: File) {
    if (!file) return;
    setEquipmentMessage(`Arquivo selecionado: ${file.name}`);
    const formData = new FormData();
    formData.append("file", file);
    setEquipmentPreview(await apiJson<EquipmentImportPreview>("/api/equipment/import/preview", { method: "POST", body: formData }));
  }

  async function commitEquipmentFile() {
    if (!equipmentPreview) return;
    setImportingEquipment(true);
    try {
      const payload = await apiJson<{ message: string; summary: { createdRows: number; updatedRows: number; skippedRows: number } }>("/api/equipment/import/commit", {
        method: "POST",
        body: JSON.stringify({ rows: equipmentPreview.rows })
      });
      setEquipmentMessage(`${payload.message} Criados: ${payload.summary.createdRows}. Atualizados: ${payload.summary.updatedRows}. Ignorados: ${payload.summary.skippedRows}.`);
      setEquipmentPreview(null);
      await refreshEquipment();
    } catch (error) {
      setEquipmentMessage(error instanceof Error ? error.message : "Não foi possível importar equipamentos.");
    } finally {
      setImportingEquipment(false);
    }
  }

  const equipmentTypes = ["Todos", "Notebook", "Desktop", "Monitor", "Headset", "Mouse", "Teclado", "Cadeira", "Celular", "Outro"];
  const equipmentStatuses = ["Todos", "Disponível", "Em uso", "Em manutenção", "Devolvido", "Extraviado", "Inativo"];
  const equipmentExportUrl = () => {
    const params = new URLSearchParams();
    Object.entries(equipmentFilters).forEach(([key, value]) => {
      if (value && value !== "Todos") params.set(key, value);
    });
    return `/api/equipment/export?${params.toString()}`;
  };

  return (
    <div>
      <PageHeader title="Equipamentos e Logística" description="Gerencie equipamentos, manutenções e logística operacional" icon={Laptop} actions={<TopActions />} />
      {equipmentMessage ? (
        <div className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">{equipmentMessage}</div>
      ) : null}
      <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard title="Total de equipamentos" value={summary.total} helper="base real cadastrada" icon={Laptop} tone="blue" />
        <StatCard title="Em uso" value={summary.inUse} helper="vinculados a responsável" icon={CheckCircle2} tone="green" />
        <StatCard title="Disponíveis" value={summary.available} helper="prontos para entrega" icon={Laptop} tone="cyan" />
        <StatCard title="Em manutenção" value={summary.maintenance} helper="atenção logística" icon={Wrench} tone="orange" />
        <StatCard title="Pendências" value={summary.pending} helper="sem responsável/inativo" icon={AlertTriangle} tone="red" />
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Panel title="Equipamentos">
          {canManage ? <input ref={equipmentFileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(event) => void previewEquipmentFile(event.target.files?.[0])} /> : null}
          <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <div className="flex h-10 items-center gap-2 rounded-lg border border-border px-3 xl:col-span-2">
              <Search className="h-4 w-4 text-muted" />
              <input value={equipmentFilters.search} onChange={(event) => setEquipmentFilters({ ...equipmentFilters, search: event.target.value })} className="min-w-0 flex-1 text-sm outline-none" placeholder="Pesquisar série, modelo ou responsável" />
            </div>
            <select value={equipmentFilters.status} onChange={(event) => setEquipmentFilters({ ...equipmentFilters, status: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold outline-none">
              {equipmentStatuses.map((status) => <option key={status}>{status}</option>)}
            </select>
            <select value={equipmentFilters.type} onChange={(event) => setEquipmentFilters({ ...equipmentFilters, type: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold outline-none">
              {equipmentTypes.map((type) => <option key={type}>{type}</option>)}
            </select>
            <button onClick={() => void refreshEquipment()} className="h-10 rounded-lg bg-blue-600 px-3 text-sm font-bold text-white">Filtrar</button>
          </div>
          <div className="mb-4 flex flex-wrap gap-2">
            <a href={equipmentExportUrl()} className="flex h-10 items-center gap-2 rounded-lg border border-border bg-white px-3 text-sm font-bold"><Download className="h-4 w-4" />Exportar CSV</a>
            {canManage ? (
              <>
                <button type="button" onClick={() => void downloadFile("/api/equipment/template", "template_equipamentos.xlsx").catch((error) => setEquipmentMessage(error.message))} className="flex h-10 items-center gap-2 rounded-lg border border-border bg-white px-3 text-sm font-bold"><FileSpreadsheet className="h-4 w-4" />Baixar template</button>
                <button type="button" onClick={() => equipmentFileInputRef.current?.click()} className="flex h-10 items-center gap-2 rounded-lg border border-border bg-white px-3 text-sm font-bold"><Upload className="h-4 w-4" />Importar</button>
              </>
            ) : null}
          </div>
          {rows.length ? (
            <SimpleTable
              columns={["Nº série", "Tipo", "Modelo", "Responsável", "WB/Login", "Entrega", "Status", "Ações"]}
              rows={rows.map((item) => [
                item.serial ?? item.code,
                item.type,
                item.model ?? "",
                item.employee,
                item.employeeWbLogin ?? "",
                item.delivered,
                <StatusBadge key={`${item.code}-s`} status={item.status} />,
                canManage ? (
                  <div key={`${item.code}-actions`} className="flex flex-wrap gap-2">
                    <button onClick={() => editEquipment(item)} className="rounded-lg border border-border px-2 py-1 text-xs font-bold">Editar</button>
                    <button onClick={() => void removeEquipment(item.id)} className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-bold text-red-600">Inativar</button>
                  </div>
                ) : "Visualização"
              ])}
            />
          ) : (
            <EmptyState title="Nenhum equipamento cadastrado." description="Cadastre ou importe equipamentos para começar." />
          )}
        </Panel>
        <div className="space-y-5">
          {canManage ? (
            <Panel title={equipmentForm.id ? "Editar equipamento" : "Cadastrar equipamento"}>
              <div className="grid gap-3">
                <FormInput label="Número de série" value={equipmentForm.numeroSerie} onChange={(value) => setEquipmentForm({ ...equipmentForm, numeroSerie: value })} />
                <FormSelect label="Tipo" value={equipmentForm.tipoEquipamento} options={equipmentTypes.filter((type) => type !== "Todos")} onChange={(value) => setEquipmentForm({ ...equipmentForm, tipoEquipamento: value })} />
                <FormInput label="Modelo" value={equipmentForm.modelo} onChange={(value) => setEquipmentForm({ ...equipmentForm, modelo: value })} />
                <FormInput label="Responsável (WB/Login, e-mail ou nome)" value={equipmentForm.responsavel} onChange={(value) => setEquipmentForm({ ...equipmentForm, responsavel: value })} />
                <FormInput label="Data de entrega" type="date" value={equipmentForm.dataEntrega} onChange={(value) => setEquipmentForm({ ...equipmentForm, dataEntrega: value })} />
                <FormSelect label="Status" value={equipmentForm.status} options={equipmentStatuses.filter((status) => status !== "Todos")} onChange={(value) => setEquipmentForm({ ...equipmentForm, status: value })} />
                <label className="block">
                  <span className="mb-1.5 block text-sm font-bold text-muted">Observação</span>
                  <textarea value={equipmentForm.observacao} onChange={(event) => setEquipmentForm({ ...equipmentForm, observacao: event.target.value })} className="min-h-24 w-full rounded-lg border border-border p-3 text-sm outline-none" />
                </label>
                <button disabled={savingEquipment} onClick={saveEquipmentForm} className="flex h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-bold text-white disabled:opacity-50">
                  <Plus className="h-4 w-4" />
                  {savingEquipment ? "Salvando..." : equipmentForm.id ? "Salvar alterações" : "Cadastrar equipamento"}
                </button>
              </div>
            </Panel>
          ) : null}
          <Panel title="Resumo logístico">
            <DonutLegend
              total={summary.total}
              items={[
                { label: "Em uso", value: String(summary.inUse), color: "#10B981" },
                { label: "Disponíveis", value: String(summary.available), color: "#2563EB" },
                { label: "Manutenção", value: String(summary.maintenance), color: "#F59E0B" },
                { label: "Pendências", value: String(summary.pending), color: "#EF4444" }
              ]}
            />
          </Panel>
        </div>
      </div>
      {equipmentPreview ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4 backdrop-blur-sm">
          <div className="card max-h-[88vh] w-full max-w-5xl overflow-y-auto p-5">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-extrabold text-navy-950">Preview da importação de equipamentos</h2>
                <p className="text-sm text-muted">Total: {equipmentPreview.summary.totalRows} • Válidas: {equipmentPreview.summary.validRows} • Erros: {equipmentPreview.summary.errorRows} • Alertas: {equipmentPreview.summary.warningRows}</p>
              </div>
              <button onClick={() => setEquipmentPreview(null)} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-slate-100">×</button>
            </div>
            <SimpleTable
              columns={["Linha", "Série", "Tipo", "Modelo", "Responsável", "Status", "Ação", "Erros/alertas"]}
              rows={equipmentPreview.rows.slice(0, 80).map((row) => [
                row.rowNumber,
                row.numeroSerie,
                row.type,
                row.model,
                row.responsible,
                <StatusBadge key={`${row.rowNumber}-status`} status={row.errors.length ? "Erro" : row.status} />,
                row.action === "update" ? "Atualizar" : row.action === "create" ? "Criar" : "Ignorar",
                [...row.errors, ...row.warnings].join(" | ") || "Linha válida"
              ])}
            />
            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <button onClick={() => setEquipmentPreview(null)} className="h-11 rounded-lg border border-border px-4 text-sm font-bold">Cancelar</button>
              <button disabled={importingEquipment || equipmentPreview.summary.errorRows > 0} onClick={commitEquipmentFile} className="h-11 rounded-lg bg-blue-600 px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
                {importingEquipment ? "Importando..." : "Confirmar importação"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function parseTimeBlockMinutes(value: string) {
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function getTimeBlockDuration(startTime: string, endTime: string) {
  const start = parseTimeBlockMinutes(startTime);
  const end = parseTimeBlockMinutes(endTime);
  if (start === null || end === null || start === end) return null;
  return end > start ? end - start : end + 24 * 60 - start;
}

function formatTimeFromMinutes(minutes: number) {
  const normalized = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${remainder}min`;
  return remainder ? `${hours}h${String(remainder).padStart(2, "0")}` : `${hours}h`;
}

function summarizeTimeBlocks(blocks: ShiftReportTimeBlock[]) {
  return blocks.reduce<Record<string, number>>((acc, block) => {
    const duration = block.durationMinutes ?? getTimeBlockDuration(block.startTime, block.endTime) ?? 0;
    acc[block.category] = (acc[block.category] ?? 0) + duration;
    return acc;
  }, {});
}

function timeBlocksOverlap(blocks: ShiftReportTimeBlock[]) {
  const sorted = blocks
    .map((block) => {
      const start = parseTimeBlockMinutes(block.startTime) ?? 0;
      const duration = block.durationMinutes ?? getTimeBlockDuration(block.startTime, block.endTime) ?? 0;
      return { start, end: start + duration };
    })
    .sort((a, b) => a.start - b.start);
  return sorted.some((block, index) => index > 0 && block.start < sorted[index - 1].end);
}

function TimeDistributionView({ blocks, summary, compact = false }: { blocks: ShiftReportTimeBlock[]; summary?: Record<string, number>; compact?: boolean }) {
  const sortedBlocks = [...blocks].sort((a, b) => a.startTime.localeCompare(b.startTime));
  const currentSummary = summary ?? summarizeTimeBlocks(sortedBlocks);
  const total = Object.values(currentSummary).reduce((sum, minutes) => sum + minutes, 0);

  if (!sortedBlocks.length) {
    return compact ? <span className="text-xs font-bold text-muted">Sem blocos</span> : <EmptyState title="Sem distribuição do tempo" description="Adicione blocos para visualizar a timeline do turno." />;
  }

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-lg border border-border bg-slate-50">
        {sortedBlocks.map((block, index) => {
          const duration = block.durationMinutes ?? getTimeBlockDuration(block.startTime, block.endTime) ?? 0;
          const width = total ? Math.max(8, Math.round((duration / total) * 100)) : 100;
          return (
            <div key={`${block.startTime}-${block.endTime}-${block.category}-${index}`} className="border-b border-white last:border-b-0">
              <div className={cn("flex items-center gap-3 px-3", compact ? "py-1.5" : "py-2")}>
                <span className="w-24 shrink-0 text-xs font-extrabold text-navy-950">{block.startTime} - {block.endTime}</span>
                <div className="h-3 flex-1 overflow-hidden rounded-full bg-white">
                  <div className="h-full rounded-full bg-blue-500" style={{ width: `${width}%` }} />
                </div>
                <span className="w-16 shrink-0 text-right text-xs font-bold text-muted">{formatDuration(duration)}</span>
              </div>
              <div className="px-3 pb-2 pl-[7.25rem] text-xs">
                <span className="font-extrabold text-navy-950">{block.category}</span>
                {block.description ? <span className="ml-2 text-muted">{block.description}</span> : null}
              </div>
            </div>
          );
        })}
      </div>
      {!compact ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {Object.entries(currentSummary).map(([category, minutes]) => (
            <div key={category} className="rounded-lg border border-border bg-white px-3 py-2">
              <p className="text-xs font-bold text-muted">{category}</p>
              <p className="text-sm font-extrabold text-navy-950">{formatDuration(minutes)}</p>
            </div>
          ))}
        </div>
      ) : null}
      <p className="text-xs font-bold text-muted">Total registrado: {formatDuration(total)}</p>
    </div>
  );
}

export function ShiftReportPage() {
  const [reports, setReports] = useState<ShiftReportItem[]>([]);
  const [dashboard, setDashboard] = useState<ShiftReportDashboard | null>(null);
  const [message, setMessage] = useState("");
  const [selectedReport, setSelectedReport] = useState<ShiftReportItem | null>(null);
  const [reportFilters, setReportFilters] = useState({ startDate: "", endDate: "", shift: "Todos", lob: "Todos", rta: "", importance: "Todos", mood: "Todos", followUp: "Todos", search: "" });
  const [form, setForm] = useState({
    reportDate: new Date().toISOString().slice(0, 10),
    shift: "Manhã",
    lob: "CEC",
    rta: "",
    importance: "Média",
    plannedHeadcount: 0,
    actualHeadcount: 0,
    absCount: 0,
    backlogStart: 0,
    backlogEnd: 0,
    latencyStart: "",
    latencyEnd: "",
    occurrences: "",
    pendingTasks: "",
    generalMood: "Neutro",
    mainRisks: "",
    actionsTaken: "",
    nextShiftAttentionPoints: "",
    requiresFollowUp: false,
    followUpOwner: "",
    followUpDueDate: "",
    additionalComments: "",
    timeBlocks: [] as ShiftReportTimeBlock[]
  });
  const [timeBlockDraft, setTimeBlockDraft] = useState<ShiftReportTimeBlock>({
    startTime: "08:00",
    endTime: "10:00",
    category: "Administrativo",
    description: ""
  });
  const [timeBlockError, setTimeBlockError] = useState("");

  useEffect(() => {
    void refreshReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshReports(filters = reportFilters) {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value && value !== "Todos") params.set(key, value);
    });
    const payload = await apiJson<{ data: ShiftReportItem[]; dashboard: ShiftReportDashboard }>(`/api/shift-reports?${params.toString()}`);
    setReports(payload.data);
    setDashboard(payload.dashboard);
  }

  async function submitReport() {
    const payload = await apiJson<{ data: ShiftReportItem; briefing: ShiftReportDashboard["briefing"] }>("/api/shift-reports", {
      method: "POST",
      body: JSON.stringify(form)
    });
    setReports((items) => [payload.data, ...items]);
    setDashboard((current) => current ? { ...current, briefing: payload.briefing, total: current.total + 1 } : current);
    setMessage(`Report ${payload.data.id} enviado e briefing atualizado.`);
    await refreshReports();
  }

  async function deleteReport(id: string) {
    if (!window.confirm("Tem certeza que deseja excluir este report de turno?")) return;
    const payload = await apiJson<{ message: string }>(`/api/shift-reports?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    setMessage(payload.message);
    if (selectedReport?.id === id) setSelectedReport(null);
    await refreshReports();
  }

  function addTimeBlock() {
    const durationMinutes = getTimeBlockDuration(timeBlockDraft.startTime, timeBlockDraft.endTime);
    if (!timeBlockDraft.startTime) {
      setTimeBlockError("Informe a hora inicial.");
      return;
    }
    if (!timeBlockDraft.endTime) {
      setTimeBlockError("Informe a hora final.");
      return;
    }
    if (!timeBlockDraft.category) {
      setTimeBlockError("Selecione uma categoria.");
      return;
    }
    if (durationMinutes === null) {
      setTimeBlockError("A hora final deve ser maior que a hora inicial.");
      return;
    }
    const nextBlocks = [...form.timeBlocks, { ...timeBlockDraft, durationMinutes }];
    if (timeBlocksOverlap(nextBlocks)) {
      setTimeBlockError("Existe sobreposição com outro bloco de tempo.");
      return;
    }
    const nextStart = timeBlockDraft.endTime;
    const nextEnd = formatTimeFromMinutes((parseTimeBlockMinutes(nextStart) ?? 0) + 60);
    setForm({ ...form, timeBlocks: nextBlocks });
    setTimeBlockDraft({ startTime: nextStart, endTime: nextEnd, category: "Administrativo", description: "" });
    setTimeBlockError("");
  }

  function editTimeBlock(index: number) {
    const block = form.timeBlocks[index];
    setTimeBlockDraft(block);
    setForm({ ...form, timeBlocks: form.timeBlocks.filter((_, currentIndex) => currentIndex !== index) });
    setTimeBlockError("");
  }

  function removeTimeBlock(index: number) {
    setForm({ ...form, timeBlocks: form.timeBlocks.filter((_, currentIndex) => currentIndex !== index) });
    setTimeBlockError("");
  }

  function copyBriefing() {
    const briefing = dashboard?.briefing;
    if (!briefing) return;
    const text = [
      briefing.title,
      `Gerado em: ${briefing.generatedAt}`,
      `O que aconteceu: ${briefing.whatHappened}`,
      `Riscos: ${briefing.mainRisks.join("; ")}`,
      `Decisões: ${briefing.decisionsNeeded.join("; ") || "Sem decisão pendente"}`,
      `ABS: ${briefing.abs}`,
      `Humor: ${briefing.mood}`,
      `SLA latência: ${briefing.slaLatency}`,
      `Recomendações: ${briefing.recommendations.join("; ")}`
    ].join("\n");
    navigator.clipboard?.writeText(text);
    setMessage("Resumo gerencial copiado para uso em IA externa.");
  }

  const timeSummary = summarizeTimeBlocks(form.timeBlocks);
  const totalTimeMinutes = Object.values(timeSummary).reduce((sum, minutes) => sum + minutes, 0);
  const timeCategoryChart = Object.entries(dashboard?.timeByCategory ?? {}).map(([name, minutes]) => ({ name, horas: Math.round((minutes / 60) * 100) / 100 }));
  const reportExportUrl = (format?: string) => {
    const params = new URLSearchParams();
    Object.entries(reportFilters).forEach(([key, value]) => {
      if (value && value !== "Todos") params.set(key, value);
    });
    if (format) params.set("format", format);
    return `/api/shift-reports/export?${params.toString()}`;
  };

  return (
    <div>
      <PageHeader title="Report de Turno" description="Registre a leitura operacional do turno e gere visão gerencial para liderança." icon={ClipboardList} actions={<TopActions />} />
      <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Reports enviados" value={dashboard?.total ?? reports.length} helper="período atual" icon={FileText} tone="blue" />
        <StatCard title="Reports críticos" value={dashboard?.critical ?? 0} helper="alta atenção" icon={AlertTriangle} tone="red" />
        <StatCard title="ABS consolidado" value={dashboard?.absTotal ?? 0} helper="agentes ausentes" icon={UsersRound} tone="orange" />
        <StatCard title="Pendências abertas" value={dashboard?.pendingFollowUps ?? 0} helper="follow-up" icon={Clock} tone="purple" />
      </div>
      {message ? <div className="mb-5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700">{message}</div> : null}
      <div className="card mb-5 grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-8">
        <FormInput label="Data inicial" type="date" value={reportFilters.startDate} onChange={(value) => setReportFilters({ ...reportFilters, startDate: value })} />
        <FormInput label="Data final" type="date" value={reportFilters.endDate} onChange={(value) => setReportFilters({ ...reportFilters, endDate: value })} />
        <FormSelect label="Turno" value={reportFilters.shift} options={["Todos", ...Array.from(standardShiftNames)]} onChange={(value) => setReportFilters({ ...reportFilters, shift: value })} />
        <FormSelect label="LOB" value={reportFilters.lob} options={["Todos", "CEC", "TNS", "ADS", "ALL"]} onChange={(value) => setReportFilters({ ...reportFilters, lob: value })} />
        <FormSelect label="Importância" value={reportFilters.importance} options={["Todos", "Baixa", "Média", "Alta", "Crítica"]} onChange={(value) => setReportFilters({ ...reportFilters, importance: value })} />
        <FormSelect label="Humor" value={reportFilters.mood} options={["Todos", "Muito bom", "Bom", "Neutro", "Ruim", "Crítico"]} onChange={(value) => setReportFilters({ ...reportFilters, mood: value })} />
        <FormInput label="RTA" value={reportFilters.rta} onChange={(value) => setReportFilters({ ...reportFilters, rta: value })} />
        <FormSelect label="Follow-up" value={reportFilters.followUp} options={["Todos", "Sim", "Não"]} onChange={(value) => setReportFilters({ ...reportFilters, followUp: value })} />
        <div className="flex items-end">
          <button onClick={() => void refreshReports()} className="h-11 w-full rounded-lg bg-blue-600 px-3 text-sm font-bold text-white">Filtrar</button>
        </div>
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_460px]">
        <div className="space-y-5">
          <Panel title="Report de turno">
            <h3 className="mb-3 text-sm font-extrabold text-navy-950">Identificação do turno</h3>
            <div className="grid gap-4 md:grid-cols-4">
              <FormInput label="Data do report" type="date" value={form.reportDate} onChange={(value) => setForm({ ...form, reportDate: value })} />
              <FormSelect label="Turno" value={form.shift} options={Array.from(standardShiftNames)} onChange={(value) => setForm({ ...form, shift: value })} />
              <FormSelect label="LOB" value={form.lob} options={["CEC", "TNS", "ADS", "ALL"]} onChange={(value) => setForm({ ...form, lob: value })} />
              <FormSelect label="Importância" value={form.importance} options={["Baixa", "Média", "Alta", "Crítica"]} onChange={(value) => setForm({ ...form, importance: value })} />
              <FormInput label="RTA responsável" value={form.rta} onChange={(value) => setForm({ ...form, rta: value })} />
            </div>
            <h3 className="mb-3 mt-5 text-sm font-extrabold text-navy-950">Headcount e operação</h3>
            <div className="grid gap-4 md:grid-cols-4">
              <FormInput label="HC escalado" type="number" value={String(form.plannedHeadcount)} onChange={(value) => setForm({ ...form, plannedHeadcount: Number(value) })} />
              <FormInput label="HC real" type="number" value={String(form.actualHeadcount)} onChange={(value) => setForm({ ...form, actualHeadcount: Number(value) })} />
              <FormInput label="ABS total" type="number" value={String(form.absCount)} onChange={(value) => setForm({ ...form, absCount: Number(value) })} />
              <FormInput label="Backlog início" type="number" value={String(form.backlogStart)} onChange={(value) => setForm({ ...form, backlogStart: Number(value) })} />
              <FormInput label="Backlog final" type="number" value={String(form.backlogEnd)} onChange={(value) => setForm({ ...form, backlogEnd: Number(value) })} />
              <FormInput label="SLA/latência início" value={form.latencyStart} onChange={(value) => setForm({ ...form, latencyStart: value })} />
              <FormInput label="SLA/latência final" value={form.latencyEnd} onChange={(value) => setForm({ ...form, latencyEnd: value })} />
              <FormSelect label="Humor geral" value={form.generalMood} options={["Muito bom", "Bom", "Neutro", "Ruim", "Crítico"]} onChange={(value) => setForm({ ...form, generalMood: value })} />
            </div>
            <div className="mt-5 rounded-lg border border-border bg-white p-4">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-sm font-extrabold text-navy-950">Distribuição do Tempo</h3>
                  <p className="text-xs font-semibold text-muted">Registre os blocos de atuação do supervisor durante o turno.</p>
                </div>
                <span className="text-xs font-extrabold text-blue-600">Total: {formatDuration(totalTimeMinutes)}</span>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-[120px_120px_minmax(0,1fr)]">
                <FormInput label="Início" type="time" value={timeBlockDraft.startTime} onChange={(value) => setTimeBlockDraft({ ...timeBlockDraft, startTime: value })} />
                <FormInput label="Fim" type="time" value={timeBlockDraft.endTime} onChange={(value) => setTimeBlockDraft({ ...timeBlockDraft, endTime: value })} />
                <FormSelect label="Atividade" value={timeBlockDraft.category} options={timeBlockCategoryOptions} onChange={(value) => setTimeBlockDraft({ ...timeBlockDraft, category: value })} />
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_150px]">
                <FormInput label="Observação do bloco" value={timeBlockDraft.description} onChange={(value) => setTimeBlockDraft({ ...timeBlockDraft, description: value })} />
                <div className="flex items-end">
                  <button onClick={addTimeBlock} className="h-11 w-full rounded-lg bg-navy-950 px-4 text-sm font-bold text-white">Adicionar bloco</button>
                </div>
              </div>
              {timeBlockError ? <p className="mt-2 text-xs font-bold text-red-600">{timeBlockError}</p> : null}
              {form.timeBlocks.length ? (
                <div className="mt-4 space-y-3">
                  <TimeDistributionView blocks={form.timeBlocks} summary={timeSummary} />
                  <div className="grid gap-2">
                    {form.timeBlocks.map((block, index) => (
                      <div key={`${block.startTime}-${block.endTime}-${block.category}-${index}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-xs">
                        <span className="font-bold text-navy-950">{block.startTime} - {block.endTime} · {block.category}</span>
                        <div className="flex gap-2">
                          <button onClick={() => editTimeBlock(index)} className="rounded-md border border-border px-2 py-1 font-bold">Editar</button>
                          <button onClick={() => removeTimeBlock(index)} className="rounded-md border border-red-200 bg-red-50 px-2 py-1 font-bold text-red-600">Excluir</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mt-4"><EmptyState title="Nenhum bloco de tempo" description="Adicione atividades como Administrativo, Desenvolvimento ou Suporte ao time." /></div>
              )}
            </div>
            <h3 className="mb-3 mt-5 text-sm font-extrabold text-navy-950">Registro operacional</h3>
            <div className="grid gap-4 md:grid-cols-2">
              {[
                ["Ocorrências", "occurrences"],
                ["Tarefas pendentes", "pendingTasks"],
                ["Principais riscos", "mainRisks"],
                ["Ações realizadas", "actionsTaken"],
                ["Pontos para próximo turno", "nextShiftAttentionPoints"],
                ["Comentários adicionais", "additionalComments"]
              ].map(([label, key]) => (
                <label key={key} className="block">
                  <span className="mb-1.5 block text-sm font-bold text-muted">{label}</span>
                  <textarea value={String(form[key as keyof typeof form])} onChange={(event) => setForm({ ...form, [key]: event.target.value })} className="min-h-20 w-full rounded-lg border border-border p-3 text-sm outline-none" />
                </label>
              ))}
            </div>
            <h3 className="mb-3 mt-5 text-sm font-extrabold text-navy-950">Follow-up</h3>
            <div className="grid gap-4 md:grid-cols-3">
              <FormSelect label="Necessita follow-up?" value={form.requiresFollowUp ? "Sim" : "Não"} options={["Sim", "Não"]} onChange={(value) => setForm({ ...form, requiresFollowUp: value === "Sim" })} />
              <FormInput label="Responsável follow-up" value={form.followUpOwner} onChange={(value) => setForm({ ...form, followUpOwner: value })} />
              <FormInput label="Prazo follow-up" type="date" value={form.followUpDueDate} onChange={(value) => setForm({ ...form, followUpDueDate: value })} />
            </div>
            <button onClick={submitReport} className="mt-5 rounded-lg bg-blue-600 px-5 py-3 text-sm font-bold text-white">Enviar report de turno</button>
          </Panel>
          <Panel title="Últimos reports enviados">
            {reports.length ? (
              <SimpleTable
                columns={["Data", "Turno", "LOB", "Importância", "RTA responsável", "HC escalado", "HC real", "ABS total", "Humor", "Tempo", "Follow-up", "Ações"]}
                rows={reports.map((report) => [
                  report.reportDate,
                  report.shift,
                  report.lob,
                  <PriorityBadge key={report.id} priority={report.importance} />,
                  report.rta || "-",
                  report.plannedHeadcount,
                  report.actualHeadcount,
                  report.absCount,
                  report.generalMood,
                  <div key={`${report.id}-tempo`} className="min-w-[220px]"><TimeDistributionView blocks={report.timeBlocks ?? []} summary={report.timeSummary} compact /></div>,
                  <StatusBadge key={`${report.id}-f`} status={report.requiresFollowUp ? "Sim" : "Não"} />,
                  <div key={`${report.id}-actions`} className="flex gap-2">
                    <button onClick={() => setSelectedReport(report)} className="rounded-lg border border-border px-2 py-1 text-xs font-bold">Ver</button>
                    <button onClick={() => void deleteReport(report.id)} className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-bold text-red-600">Excluir</button>
                  </div>
                ])}
              />
            ) : (
              <EmptyState title="Nenhum report de turno enviado." description="Reports reais aparecerão aqui após o envio." />
            )}
          </Panel>
        </div>
        <div className="space-y-5">
          <Panel title="Resumo Gerencial do Dia">
            <div className="space-y-4">
              <p className="text-sm font-semibold text-muted">{dashboard?.briefing.whatHappened}</p>
              <MiniAlertList items={(dashboard?.briefing.mainRisks ?? []).slice(0, 4).map((risk) => ({ title: risk, status: "Risco", tone: "orange" }))} />
              <div className="grid gap-2">
                <button onClick={copyBriefing} className="flex h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-bold text-white"><Copy className="h-4 w-4" />Copiar resumo para IA</button>
                <a href={reportExportUrl()} className="flex h-11 items-center justify-center gap-2 rounded-lg border border-border bg-white px-4 text-sm font-bold"><Download className="h-4 w-4" />Exportar CSV</a>
                <a href={reportExportUrl("json")} className="flex h-11 items-center justify-center gap-2 rounded-lg border border-border bg-white px-4 text-sm font-bold"><FileJson className="h-4 w-4" />Exportar JSON</a>
              </div>
            </div>
          </Panel>
          <Panel title="Tempo por atividade">
            {timeCategoryChart.length ? (
              <div className="space-y-3">
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={timeCategoryChart}>
                      <CartesianGrid stroke="#E8EDF5" vertical={false} />
                      <XAxis dataKey="name" />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="horas" fill="#0F766E" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-xs font-bold text-muted">Total registrado no período: {formatDuration(dashboard?.totalTimeMinutes ?? 0)}</p>
              </div>
            ) : (
              <EmptyState title="Sem tempo classificado" description="Os blocos adicionados no report aparecerão aqui por categoria." />
            )}
          </Panel>
          <Panel title="Briefing estruturado">
            <div className="space-y-3 text-sm text-muted">
              <p><strong className="text-navy-950">ABS:</strong> {dashboard?.briefing.abs}</p>
              <p><strong className="text-navy-950">Humor:</strong> {dashboard?.briefing.mood}</p>
              <p><strong className="text-navy-950">SLA latência:</strong> {dashboard?.briefing.slaLatency}</p>
              <p><strong className="text-navy-950">Recomendações:</strong> {(dashboard?.briefing.recommendations ?? []).join(" ")}</p>
            </div>
          </Panel>
        </div>
      </div>
      {selectedReport ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/40 p-4">
          <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-xl bg-white p-5 shadow-2xl">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-extrabold text-navy-950">Report de Turno</h2>
                <p className="text-sm font-semibold text-muted">{selectedReport.reportDate} · {selectedReport.shift} · {selectedReport.lob}</p>
              </div>
              <button onClick={() => setSelectedReport(null)} className="rounded-lg border border-border px-3 py-2 text-sm font-bold">Fechar</button>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <InfoLine label="Data do report" value={selectedReport.reportDate} />
              <InfoLine label="Turno" value={selectedReport.shift} />
              <InfoLine label="LOB" value={selectedReport.lob} />
              <InfoLine label="Importância" value={selectedReport.importance} />
              <InfoLine label="RTA responsável" value={selectedReport.rta || "-"} />
              <InfoLine label="Humor geral" value={selectedReport.generalMood} />
              <InfoLine label="HC escalado" value={selectedReport.plannedHeadcount} />
              <InfoLine label="HC real" value={selectedReport.actualHeadcount} />
              <InfoLine label="ABS total" value={selectedReport.absCount} />
              <InfoLine label="Backlog início" value={selectedReport.backlogStart} />
              <InfoLine label="Backlog final" value={selectedReport.backlogEnd} />
              <InfoLine label="SLA latência início" value={selectedReport.latencyStart || "-"} />
              <InfoLine label="SLA latência final" value={selectedReport.latencyEnd || "-"} />
              <InfoLine label="Necessita follow-up" value={selectedReport.requiresFollowUp ? "Sim" : "Não"} />
              <InfoLine label="Responsável follow-up" value={selectedReport.followUpOwner || "-"} />
              <InfoLine label="Prazo follow-up" value={selectedReport.followUpDueDate || "-"} />
            </div>
            <div className="mt-5 rounded-lg border border-border p-4">
              <h3 className="mb-3 text-sm font-extrabold text-navy-950">Distribuição do Tempo</h3>
              {selectedReport.timeBlocks?.length ? (
                <TimeDistributionView blocks={selectedReport.timeBlocks} summary={selectedReport.timeSummary} />
              ) : (
                <EmptyState title="Sem blocos registrados" description="Este report não possui distribuição de tempo." />
              )}
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {[
                ["Ocorrências", selectedReport.occurrences],
                ["Tarefas pendentes", selectedReport.pendingTasks],
                ["Principais riscos", selectedReport.mainRisks],
                ["Ações realizadas", selectedReport.actionsTaken],
                ["Pontos para o próximo turno", selectedReport.nextShiftAttentionPoints],
                ["Comentários adicionais", selectedReport.additionalComments]
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-border p-3">
                  <p className="text-xs font-extrabold uppercase text-muted">{label}</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm font-semibold text-navy-950">{value || "-"}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function StaffCoveragePage() {
  const [adjustment, setAdjustment] = useState(2);
  const [attendanceSummary, setAttendanceSummary] = useState<AttendanceSummary | null>(null);
  const simulated = 80 + adjustment * 3.5;

  useEffect(() => {
    apiJson<{ summary: AttendanceSummary }>("/api/attendance").then((payload) => setAttendanceSummary(payload.summary)).catch(() => undefined);
  }, []);

  return (
    <div>
      <PageHeader title="Staff e Cobertura" description="Planejamento de pessoal e análise de cobertura por turno e dia." icon={UsersRound} actions={<TopActions />} />
      <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard title="Staff Planejado" value={attendanceSummary?.planned ?? "1.248"} change="100%" helper="vs período anterior" icon={Users} tone="blue" />
        <StatCard title="Staff Real" value={attendanceSummary?.present ?? "1.184"} change={`${attendanceSummary?.absRate ?? 5.1}% ABS`} helper="presença real" icon={UserCheck} tone="green" />
        <StatCard title="Gap Real" value={attendanceSummary?.gap ?? "-64"} change="impacto ausências" helper="planejado vs real" icon={AlertTriangle} tone="orange" />
        <StatCard title="Cobertura Real" value={`${attendanceSummary?.coverageRate ?? 95.1}%`} change="-3,2pp" helper="inclui ausências" icon={ShieldCheck} tone="purple" />
        <StatCard title="Risco de Cobertura" value={attendanceSummary?.riskLevel ?? "Alto"} helper="Tendência: monitorar" icon={AlertTriangle} tone={attendanceSummary?.riskLevel === "Crítico" ? "red" : "orange"} />
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.1fr_.9fr]">
        <Panel title="Matriz de Cobertura por Dia e Turno">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs font-bold text-muted">
                  <th className="px-3 py-3">Turno</th>
                  {["Seg 20/05", "Ter 21/05", "Qua 22/05", "Qui 23/05", "Sex 24/05", "Sáb 25/05", "Dom 26/05", "Média"].map((day) => (
                    <th key={day} className="px-3 py-3 text-center">{day}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {coverageMatrix.map((row) => (
                  <tr key={row.turno}>
                    <td className="border border-border px-3 py-3 font-bold text-navy-950">
                      {row.turno}
                      <p className="text-xs font-normal text-muted">{row.range}</p>
                    </td>
                    {row.values.map((value, index) => (
                      <td key={index} className={cn("border border-white px-3 py-3 text-center font-bold", coverageTone(value))}>{value}%</td>
                    ))}
                    <td className="border border-border px-3 py-3 text-center font-extrabold text-navy-950">{row.media}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap gap-4 text-xs font-semibold text-muted">
            {["≥ 95% Excelente", "90% - 94% Adequado", "85% - 89% Atenção", "< 85% Crítico"].map((item, index) => (
              <span key={item} className="flex items-center gap-2">
                <span className={cn("status-dot", ["bg-emerald-500", "bg-lime-400", "bg-amber-400", "bg-red-500"][index])} />
                {item}
              </span>
            ))}
          </div>
        </Panel>
        <Panel title="Cobertura por Turno (Média do Período)" action="Ver detalhes">
          <div className="grid gap-5 md:grid-cols-[1fr_180px]">
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={coverageByShift}>
                  <CartesianGrid stroke="#E8EDF5" vertical={false} />
                  <XAxis dataKey="shift" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="cobertura" fill="#2563EB" radius={[8, 8, 0, 0]} />
                  <Line dataKey="meta" stroke="#071B3A" strokeDasharray="4 4" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="rounded-lg border border-border p-4">
              <p className="text-sm font-bold text-muted">Meta de Cobertura</p>
              <p className="mt-2 text-xl font-extrabold text-navy-950">≥ 95%</p>
              <p className="mt-8 text-sm font-bold text-muted">Cobertura Geral</p>
              <p className="mt-2 text-3xl font-extrabold text-blue-600">95,1%</p>
              <p className="text-xs font-bold text-red-500">-3,2pp vs período anterior</p>
            </div>
          </div>
        </Panel>
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <Panel title="Alertas de Cobertura" action="Ver todos os alertas">
          <MiniAlertList
            items={[
              { title: "Déficit crítico no turno da Noite de Domingo", status: "Crítico", tone: "red" },
              { title: "Cobertura abaixo da meta na Noite", status: "Atenção", tone: "orange" },
              { title: "Gap projetado para aumentar na próxima semana", status: "Atenção", tone: "orange" },
              { title: "12 colaboradores em férias impactando cobertura", status: "Informativo", tone: "blue" }
            ]}
          />
        </Panel>
        <Panel title="Simular Impacto de Folgas">
          <div className="grid grid-cols-2 gap-3">
            <MetricPill value={24} label="Folgas Atuais" />
            <div className="rounded-lg border border-border bg-white p-4 text-center">
              <p className="text-xs font-bold text-muted">Ajustar Folgas</p>
              <div className="mt-3 flex items-center justify-center gap-4">
                <button onClick={() => setAdjustment(Math.max(0, adjustment - 1))} className="h-8 w-8 rounded-lg border border-border">-</button>
                <span className="text-xl font-extrabold">{adjustment}</span>
                <button onClick={() => setAdjustment(adjustment + 1)} className="h-8 w-8 rounded-lg border border-border">+</button>
              </div>
              <p className="mt-4 text-xs font-bold text-muted">Simular Cobertura</p>
              <p className="text-2xl font-extrabold text-orange-500">{simulated.toFixed(0)}%</p>
            </div>
          </div>
          <div className="mt-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">
            Redução de 2 folgas melhora cobertura em +7pp
          </div>
        </Panel>
        <Panel title="Gap por Área (Média do Período)" action="Ver todas">
          <SimpleTable
            columns={["Área", "Necessário", "Planejado", "Gap", "Cobertura"]}
            rows={[
              ["Atendimento", 512, 468, "-44", "91,4%"],
              ["Vendas", 320, 292, "-28", "91,3%"],
              ["Retenção", 208, 186, "-22", "89,4%"],
              ["Operação", 160, 154, "-6", "96,3%"],
              ["Suporte", 112, 102, "-10", "91,1%"]
            ]}
          />
        </Panel>
      </div>
    </div>
  );
}

function coverageTone(value: number) {
  if (value >= 95) return "bg-emerald-100 text-emerald-800";
  if (value >= 90) return "bg-lime-100 text-lime-800";
  if (value >= 85) return "bg-amber-100 text-amber-800";
  return "bg-red-100 text-red-700";
}

export function ClimatePage() {
  const [answered, setAnswered] = useState(false);
  const [climateComment, setClimateComment] = useState("");

  async function submitClimateAnswer() {
    await apiJson<{ data: unknown }>("/api/climate/answers", {
      method: "POST",
      body: JSON.stringify({
        surveyId: "CLM-05",
        answers: [
          { questionId: "q1", value: 4 },
          { questionId: "q2", value: "Sim" },
          { questionId: "q3", value: "Ferramentas" },
          { questionId: "q4", value: climateComment }
        ]
      })
    });
    setAnswered(true);
  }

  return (
    <div>
      <PageHeader title="Pesquisa de Clima" description="Crie, responda e acompanhe pesquisas de satisfação, engajamento e eNPS." icon={HeartPulse} actions={<TopActions />} />
      <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Participação" value="82%" change="+6 p.p." helper="vs última pesquisa" icon={UsersRound} tone="blue" />
        <StatCard title="Satisfação" value="4,2/5" change="+0,3" helper="média geral" icon={HeartPulse} tone="green" />
        <StatCard title="Engajamento" value="78%" change="+5%" helper="colaboradores ativos" icon={Trophy} tone="purple" />
        <StatCard title="eNPS interno" value="54" change="+8" helper="zona de qualidade" icon={Target} tone="orange" />
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Panel title="Responder Pesquisa Ativa">
          {answered ? (
            <EmptyState title="Resposta registrada" description="Obrigado. A resposta foi computada sem expor dados sensíveis no consolidado." />
          ) : (
            <div className="space-y-4">
              {["Como você avalia seu ambiente de trabalho?", "Você recomendaria a Central como um bom lugar para trabalhar?", "Qual tema merece mais atenção?"].map((question, index) => (
                <label key={question} className="block rounded-lg border border-border p-4">
                  <span className="text-sm font-bold text-navy-950">{question}</span>
                  {index === 0 ? (
                    <input type="range" min="1" max="5" defaultValue="4" className="mt-4 w-full" />
                  ) : (
                    <select className="mt-3 h-11 w-full rounded-lg border border-border px-3">
                      <option>{index === 1 ? "Sim" : "Ferramentas"}</option>
                      <option>{index === 1 ? "Não" : "Liderança"}</option>
                      <option>Processos</option>
                      <option>Ambiente</option>
                    </select>
                  )}
                </label>
              ))}
              <textarea value={climateComment} onChange={(event) => setClimateComment(event.target.value)} className="min-h-28 w-full rounded-lg border border-border p-3 outline-none" placeholder="Deixe uma sugestão de melhoria" />
              <button onClick={submitClimateAnswer} className="rounded-lg bg-blue-600 px-5 py-3 text-sm font-bold text-white">Enviar resposta</button>
            </div>
          )}
        </Panel>
        <div className="space-y-5">
          <Panel title="Temas Recorrentes">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={climateThemes} layout="vertical">
                  <CartesianGrid stroke="#E8EDF5" horizontal={false} />
                  <XAxis type="number" hide />
                  <YAxis dataKey="theme" type="category" width={90} />
                  <Tooltip />
                  <Bar dataKey="value" fill="#2563EB" radius={[0, 8, 8, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>
          <Panel title="Plano de Ação">
            <MiniAlertList
              items={[
                { title: "Revisar estabilidade das ferramentas", status: "Em andamento", tone: "blue" },
                { title: "Rodada com líderes de turno", status: "Planejado", tone: "orange" },
                { title: "Simplificar fluxo de aprovação", status: "Novo", tone: "green" }
              ]}
            />
          </Panel>
        </div>
      </div>
    </div>
  );
}

export function AnonymousFeedbackPage() {
  const [submitted, setSubmitted] = useState(false);
  const [anonymousForm, setAnonymousForm] = useState({ category: "Estrutura", message: "" });

  async function submitAnonymousFeedback() {
    await apiJson<{ data: unknown }>("/api/anonymous-feedback", {
      method: "POST",
      body: JSON.stringify({ ...anonymousForm, message: anonymousForm.message || "Sugestão registrada anonimamente para análise do RH." })
    });
    setSubmitted(true);
  }

  return (
    <div>
      <PageHeader title="Feedback Anônimo" description="Canal seguro para registrar percepções consolidadas para RH e gestão." icon={MessageCircle} actions={<TopActions />} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_430px]">
        <Panel title="Enviar feedback anônimo">
          {submitted ? (
            <EmptyState title="Feedback recebido" description="A identidade do colaborador não será exibida nos painéis de RH/Gestão." />
          ) : (
            <div className="space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-sm font-bold text-muted">Categoria</span>
                <select value={anonymousForm.category} onChange={(event) => setAnonymousForm({ ...anonymousForm, category: event.target.value })} className="h-11 w-full rounded-lg border border-border px-3">
                  <option>Estrutura</option>
                  <option>Liderança</option>
                  <option>Processos</option>
                  <option>Ferramentas</option>
                  <option>Ambiente</option>
                  <option>Outros</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-bold text-muted">Mensagem</span>
                <textarea value={anonymousForm.message} onChange={(event) => setAnonymousForm({ ...anonymousForm, message: event.target.value })} className="min-h-40 w-full rounded-lg border border-border p-3 outline-none" placeholder="Descreva a situação, oportunidade ou sugestão" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-bold text-muted">Evidência opcional</span>
                <input type="file" className="w-full rounded-lg border border-border p-3 text-sm" />
              </label>
              <button onClick={submitAnonymousFeedback} className="rounded-lg bg-blue-600 px-5 py-3 text-sm font-bold text-white">Enviar anonimamente</button>
            </div>
          )}
        </Panel>
        <div className="space-y-5">
          <Panel title="Dashboard RH/Gestão">
            <div className="grid grid-cols-2 gap-3">
              <MetricPill value={42} label="Recebidos" />
              <MetricPill value={18} label="Em análise" />
              <MetricPill value={9} label="Planos de ação" />
              <MetricPill value={15} label="Concluídos" />
            </div>
          </Panel>
          <Panel title="Classificação por tema">
            <MiniAlertList
              items={[
                { title: "Ferramentas", status: "34%", tone: "orange" },
                { title: "Liderança", status: "27%", tone: "blue" },
                { title: "Processos", status: "21%", tone: "green" },
                { title: "Ambiente", status: "18%", tone: "blue" }
              ]}
            />
          </Panel>
          <Panel title="Status">
            <MiniAlertList
              items={[
                { title: "Recebido", status: "12", tone: "blue" },
                { title: "Em análise", status: "18", tone: "orange" },
                { title: "Plano de ação", status: "9", tone: "green" },
                { title: "Concluído", status: "15", tone: "green" }
              ]}
            />
          </Panel>
        </div>
      </div>
    </div>
  );
}

export function TokensPage() {
  const [balance, setBalance] = useState(430);
  const [redemptions, setRedemptions] = useState(tokenHistory);
  const [rewardCatalog, setRewardCatalog] = useState<RewardItem[]>(rewards.map((reward, index) => ({ id: `RWD-${index + 1}`, name: reward.name, cost: reward.cost, stock: reward.stock })));
  const [tokenMessage, setTokenMessage] = useState("");

  useEffect(() => {
    apiJson<{ data: { balance: number; history: typeof tokenHistory; rewards: RewardItem[] } }>("/api/tokens")
      .then((payload) => {
        setBalance(payload.data.balance);
        setRedemptions(payload.data.history);
        setRewardCatalog(payload.data.rewards);
      })
      .catch(() => undefined);
  }, []);

  async function redeem(reward: RewardItem) {
    const payload = await apiJson<{ data: { requestId: string; newBalance: number; transaction: (typeof tokenHistory)[number] } }>("/api/tokens/redeem", {
      method: "POST",
      body: JSON.stringify({ rewardId: reward.id, cost: reward.cost })
    });
    setBalance(payload.data.newBalance);
    setRedemptions((items) => [payload.data.transaction, ...items]);
    setTokenMessage(`Resgate solicitado. Solicitação ${payload.data.requestId} criada para aprovação.`);
  }

  return (
    <div>
      <PageHeader title="Tokens e Recompensas" description="Acompanhe saldo, ganhos, resgates e reconhecimento operacional." icon={Coins} actions={<TopActions />} />
      <div className="grid gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
        <div className="space-y-5">
          <Panel title="Saldo de Tokens">
            <div className="rounded-xl bg-navy-950 p-6 text-white">
              <Coins className="h-10 w-10 text-amber-300" />
              <p className="mt-4 text-sm text-blue-100">Saldo disponível</p>
              <p className="text-5xl font-extrabold">{balance}</p>
              <p className="mt-2 text-sm text-blue-100">Tokens podem ser usados em recompensas aprovadas.</p>
            </div>
          </Panel>
          <Panel title="Regras de pontuação">
            <MiniAlertList
              items={[
                { title: "Presença gera tokens", status: "+5/dia", tone: "green" },
                { title: "Qualidade acima da meta", status: "+80", tone: "green" },
                { title: "Produtividade acima da meta", status: "+60", tone: "blue" },
                { title: "Reconhecimento manual", status: "Variável", tone: "orange" }
              ]}
            />
          </Panel>
        </div>
        <div className="space-y-5">
          <Panel title="Catálogo de Recompensas">
            {tokenMessage ? (
              <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-700">{tokenMessage}</div>
            ) : null}
            <div className="grid gap-4 md:grid-cols-4">
              {rewardCatalog.map((reward) => {
                const Icon = getRewardIcon(reward.name);
                return (
                  <div key={reward.name} className="rounded-lg border border-border p-4">
                    <Icon className="h-9 w-9 text-blue-600" />
                    <p className="mt-3 font-extrabold text-navy-950">{reward.name}</p>
                    <p className="text-sm text-muted">Estoque: {reward.stock}</p>
                    <p className="mt-3 text-lg font-extrabold text-amber-500">{reward.cost} tokens</p>
                    <button onClick={() => redeem(reward)} className="mt-3 w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white">Solicitar resgate</button>
                  </div>
                );
              })}
            </div>
          </Panel>
          <div className="grid gap-5 xl:grid-cols-2">
            <Panel title="Histórico de Tokens">
              <SimpleTable columns={["Evento", "Tokens", "Data", "Tipo"]} rows={redemptions.map((item) => [item.title, item.amount, item.date, <StatusBadge key={item.title} status={item.type} />])} />
            </Panel>
            <Panel title="Ranking de Engajamento">
              <SimpleTable columns={["Pos.", "Pessoa", "Tokens"]} rows={topPerformers.map((person, index) => [`${index + 1}º`, person.name, 760 - index * 58])} />
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ChatPage() {
  const { data: session } = useSession();
  const [messages, setMessages] = useState(chatMessages.map((message, index) => ({ id: `MSG-${index + 1}`, ...message })));
  const [text, setText] = useState("");

  useEffect(() => {
    apiJson<{ data: Array<{ id: string; author: string; message: string; time: string; self: boolean }> }>("/api/chat/messages?roomId=equipe-alfa")
      .then((payload) => setMessages(payload.data))
      .catch(() => undefined);
  }, []);

  async function sendMessage() {
    if (!text.trim()) return;
    const payload = await apiJson<{ data: { id: string; author: string; message: string; time: string; self: boolean } }>("/api/chat/messages", {
      method: "POST",
      body: JSON.stringify({ roomId: "equipe-alfa", content: text })
    });
    setMessages([...messages, { ...payload.data, author: session?.user?.name ?? payload.data.author }]);
    setText("");
  }

  return (
    <div>
      <PageHeader title="Chat" description="Conversas individuais, grupos por time, LOB e área." icon={MessageCircle} actions={<TopActions />} />
      <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Panel title="Conversas">
          {["Equipe Alfa", "CEC - Operação", "WFM e Supervisores", "Qualidade", "TI Suporte"].map((room, index) => (
            <button key={room} className={cn("mb-2 flex w-full items-center gap-3 rounded-lg p-3 text-left last:mb-0", index === 0 ? "bg-blue-50" : "hover:bg-slate-50")}>
              <span className="grid h-10 w-10 place-items-center rounded-full bg-blue-600 text-sm font-bold text-white">{initials(room)}</span>
              <span>
                <p className="font-bold text-navy-950">{room}</p>
                <p className="text-xs text-muted">{index % 2 === 0 ? "Online" : "Grupo"}</p>
              </span>
            </button>
          ))}
        </Panel>
        <section className="card flex min-h-[640px] flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div>
              <h2 className="text-lg font-extrabold text-navy-950">Equipe Alfa</h2>
              <p className="text-sm text-muted">12 participantes online</p>
            </div>
            <StatusBadge status="Online" />
          </div>
          <div className="flex-1 space-y-4 overflow-y-auto bg-slate-50/55 p-5">
            {messages.map((message) => (
              <div key={message.id} className={cn("flex", message.self ? "justify-end" : "justify-start")}>
                <div className={cn("max-w-[72%] rounded-xl p-4 shadow-soft", message.self ? "bg-blue-600 text-white" : "bg-white text-navy-950")}>
                  <p className="text-xs font-bold opacity-75">{message.author} • {message.time}</p>
                  <p className="mt-1 text-sm">{message.message}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-3 border-t border-border p-4">
            <input value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => event.key === "Enter" && sendMessage()} className="h-12 flex-1 rounded-lg border border-border px-4 outline-none" placeholder="Digite sua mensagem..." />
            <button onClick={sendMessage} className="grid h-12 w-12 place-items-center rounded-lg bg-blue-600 text-white">
              <Send className="h-5 w-5" />
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

export function ReportsPage() {
  return (
    <div>
      <PageHeader title="Relatórios" description="Extraia relatórios operacionais com filtros por período, LOB, turno e status." icon={FileText} actions={<TopActions />} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {reportCards.map((report) => {
          const Icon = report.icon;
          return (
            <a key={report.title} href={`/api/reports/export-csv?report=${encodeURIComponent(report.title)}`} className="card p-5 transition hover:-translate-y-0.5 hover:shadow-card">
              <Icon className="h-9 w-9 text-blue-600" />
              <h2 className="mt-4 text-lg font-extrabold text-navy-950">{report.title}</h2>
              <p className="mt-2 text-sm text-muted">{report.records}</p>
              <p className="mt-5 flex items-center gap-2 text-sm font-bold text-blue-600">
                Exportar CSV <ChevronRight className="h-4 w-4" />
              </p>
            </a>
          );
        })}
      </div>
    </div>
  );
}

export function AuditPage() {
  const [rows, setRows] = useState<AuditItem[]>(
    auditLogs.map((row, index) => ({
      id: `AUD-${index + 1}`,
      dateTime: row[0],
      user: row[1],
      action: row[2],
      entity: row[3],
      entityId: row[4],
      reason: row[5]
    }))
  );

  useEffect(() => {
    apiJson<{ data: AuditItem[] }>("/api/audit")
      .then((payload) => setRows(payload.data))
      .catch(() => undefined);
  }, []);

  return (
    <div>
      <PageHeader title="Auditoria" description="Logs de ações sensíveis, aprovações, importações e alterações de dados." icon={FileText} actions={<TopActions />} />
      <Panel title="Logs de Auditoria">
        <SimpleTable
          columns={["Data/hora", "Usuário", "Ação", "Entidade", "ID da entidade", "Depois/Motivo"]}
          rows={rows.map((row) => [row.dateTime, row.user, <StatusBadge key={`${row.id}-${row.action}`} status={row.action} />, row.entity, row.entityId, row.reason])}
        />
      </Panel>
    </div>
  );
}

export function PlatformUsagePage() {
  const [usage, setUsage] = useState<PlatformUsage | null>(null);
  const [errors, setErrors] = useState<ErrorLogItem[]>([]);

  useEffect(() => {
    apiJson<{ data: PlatformUsage }>("/api/platform-usage")
      .then((payload) => setUsage(payload.data))
      .catch(() => undefined);
    apiJson<{ data: ErrorLogItem[] }>("/api/error-logs")
      .then((payload) => setErrors(payload.data))
      .catch(() => undefined);
  }, []);

  const stats = usage
    ? [
        { title: "Usuários ativos", value: usage.activeUsers.toLocaleString("pt-BR"), change: `${usage.employees} colaboradores`, icon: Users, tone: "blue" as const },
        { title: "Arquivos enviados", value: usage.uploadedFiles.toLocaleString("pt-BR"), change: usage.storageLabel, icon: Upload, tone: "green" as const },
        { title: "Solicitações", value: usage.requests.toLocaleString("pt-BR"), change: `${usage.openRequests} abertas`, icon: ClipboardList, tone: "orange" as const },
        { title: "Reports de turno", value: usage.shiftReports.toLocaleString("pt-BR"), change: "base gerencial", icon: FileText, tone: "purple" as const },
        { title: "Audit logs", value: usage.auditLogs.toLocaleString("pt-BR"), change: "imutáveis", icon: ShieldCheck, tone: "blue" as const },
        { title: "Error logs", value: usage.errorLogs.toLocaleString("pt-BR"), change: "internos", icon: AlertTriangle, tone: usage.errorLogs > 5 ? ("red" as const) : ("orange" as const) }
      ]
    : [];

  return (
    <div>
      <PageHeader title="Uso da Plataforma" description="Controle operacional de uso, storage, logs e alertas internos do MVP." icon={FileText} actions={<TopActions />} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        {stats.map((stat) => (
          <StatCard key={stat.title} {...stat} />
        ))}
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Panel title="Indicadores administrativos">
          {usage ? (
            <SimpleTable
              columns={["Indicador", "Valor", "Leitura"]}
              rows={[
                ["Importações de cronograma", usage.scheduleImports, "Arquivos de cronograma com validação/preview"],
                ["Notificações internas", usage.notifications, `${usage.unreadNotifications} não lidas`],
                ["Cadastros pendentes", usage.pendingRegistrations, usage.pendingRegistrations ? "Requer ação de RH/Admin/WFM" : "Sem fila crítica"],
                ["Solicitações abertas", usage.openRequests, "Monitorar SLAs operacionais"],
                ["Storage estimado", usage.storageLabel, "Supabase Storage privado"]
              ]}
            />
          ) : (
            <EmptyState title="Carregando uso" description="Consolidando métricas da plataforma." />
          )}
        </Panel>

        <div className="space-y-5">
          <Panel title="Alertas de uso">
            <div className="space-y-3">
              {(usage?.alerts ?? ["Carregando alertas..."]).map((alert) => (
                <div key={alert} className="flex items-start gap-3 rounded-xl border border-amber-100 bg-amber-50/70 p-3 text-sm font-semibold text-amber-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  {alert}
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Erros recentes">
            <div className="space-y-3">
              {errors.slice(0, 5).map((error) => (
                <div key={error.id} className="rounded-xl border border-border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-extrabold text-navy-950">{error.code ?? error.action ?? "ERROR"}</p>
                    <StatusBadge status={error.severity} />
                  </div>
                  <p className="mt-2 text-sm text-muted">{error.message}</p>
                  <p className="mt-2 text-xs font-semibold text-slate-400">{error.route ?? "rota interna"} • {error.createdAt}</p>
                </div>
              ))}
              {!errors.length ? <EmptyState title="Sem erros críticos" description="Nenhum erro operacional registrado para este usuário." /> : null}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

export function SettingsPage() {
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [settingsMessage, setSettingsMessage] = useState("");
  const [settingsError, setSettingsError] = useState(false);
  const adminSections = ["Usuários", "Perfis", "Permissões", "LOBs", "Times", "Supervisores", "Turnos", "Cargos/Funções", "Tipos de solicitação", "SLAs", "Regras de aprovação", "Regras de cobertura", "Regras de tokens", "Configurações gerais"];
  const [activeSection, setActiveSection] = useState(adminSections[0]);
  const [userDraft, setUserDraft] = useState({ id: "", name: "", email: "", roleName: "COLABORADOR", status: "ACTIVE", employeeId: "", password: "" });
  const [roleDraft, setRoleDraft] = useState({ id: "", name: "", label: "", description: "", status: "ACTIVE" as "ACTIVE" | "INACTIVE" });
  const [permissionDraft, setPermissionDraft] = useState({ id: "", key: "", label: "", description: "", status: "ACTIVE" as "ACTIVE" | "INACTIVE", roleName: "", granted: true });
  const [lobDraft, setLobDraft] = useState({ id: "", name: "", description: "" });
  const [teamDraft, setTeamDraft] = useState({ id: "", name: "", lobId: "", supervisorId: "", status: "ACTIVE" as "ACTIVE" | "INACTIVE" });
  const [supervisorDraft, setSupervisorDraft] = useState({ supervisorId: "", teamId: "", employeeId: "" });
  const [shiftDraft, setShiftDraft] = useState({ id: "", name: "", startsAt: "08:00", endsAt: "16:00", color: "#2563EB" });
  const [requestTypeDraft, setRequestTypeDraft] = useState({ id: "", name: "", area: "Operação", slaHours: "24", requiresApproval: true, status: "ACTIVE" as "ACTIVE" | "INACTIVE" });
  const [roleTitleDraft, setRoleTitleDraft] = useState({ previousName: "", name: "", status: "ACTIVE" as "ACTIVE" | "INACTIVE" });
  const [ruleDraft, setRuleDraft] = useState({ id: "", name: "", requestType: "", priority: "Média", hours: "24", role: "WFM", lob: "ALL", shift: "", staffRequired: "1", points: "1", status: "ACTIVE" as "ACTIVE" | "INACTIVE" });
  const [generalDraft, setGeneralDraft] = useState<Record<string, unknown>>({});
  const [defaultMonthDraft, setDefaultMonthDraft] = useState("2026-05");
  const [savingSettings, setSavingSettings] = useState(false);

  useEffect(() => {
    void loadSettings();
  }, []);

  async function loadSettings() {
    try {
      const payload = await apiJson<{ data: SystemSettings }>("/api/settings");
      setSettings(payload.data);
      setDefaultMonthDraft(payload.data.defaultMonth);
      setGeneralDraft(payload.data.generalSettings ?? {});
    } catch (error) {
      setSettingsError(true);
      setSettingsMessage(error instanceof Error ? error.message : "Não foi possível carregar configurações.");
    }
  }

  async function saveSetting(body: Record<string, unknown>, success: string) {
    setSavingSettings(true);
    setSettingsMessage("");
    try {
      await apiJson<{ success: boolean }>("/api/settings", { method: "POST", body: JSON.stringify(body) });
      setSettingsError(false);
      setSettingsMessage(success);
      setLobDraft({ id: "", name: "", description: "" });
      setTeamDraft({ id: "", name: "", lobId: "", supervisorId: "", status: "ACTIVE" });
      setSupervisorDraft({ supervisorId: "", teamId: "", employeeId: "" });
      setShiftDraft({ id: "", name: "", startsAt: "08:00", endsAt: "16:00", color: "#2563EB" });
      setRoleTitleDraft({ previousName: "", name: "", status: "ACTIVE" });
      setRequestTypeDraft({ id: "", name: "", area: "Operação", slaHours: "24", requiresApproval: true, status: "ACTIVE" });
      setPermissionDraft({ id: "", key: "", label: "", description: "", status: "ACTIVE", roleName: "", granted: true });
      setUserDraft({ id: "", name: "", email: "", roleName: "COLABORADOR", status: "ACTIVE", employeeId: "", password: "" });
      setRuleDraft({ id: "", name: "", requestType: "", priority: "Média", hours: "24", role: "WFM", lob: "ALL", shift: "", staffRequired: "1", points: "1", status: "ACTIVE" });
      await loadSettings();
    } catch (error) {
      setSettingsError(true);
      setSettingsMessage(error instanceof Error ? error.message : "Não foi possível salvar configuração.");
    } finally {
      setSavingSettings(false);
    }
  }

  const activeLobs = settings?.lobs.filter((lob) => lob.status !== "INACTIVE").length ?? 0;
  const activeShifts = settings?.shifts.filter((shift) => shift.status !== "INACTIVE" && isSelectableShiftName(shift.name)).length ?? 0;
  const activeTitles = settings?.roleTitles.filter((title) => title.status !== "INACTIVE").length ?? 0;
  const activeTeams = settings?.teams?.filter((team) => team.status !== "INACTIVE").length ?? 0;
  const roleOptions = settings?.roles.filter((role) => role.status !== "INACTIVE").map((role) => role.name) ?? ["COLABORADOR", "SUPERVISOR", "WFM", "ADMIN"];
  const lobOptions = settings?.lobs.filter((lob) => lob.status !== "INACTIVE") ?? [];
  const supervisorOptions = settings?.supervisors ?? [];
  const employeeOptionsForSettings = settings?.employees ?? [];
  const teamOptions = settings?.teams ?? [];

  function statusButtonLabel(status?: string) {
    return status === "INACTIVE" ? "Ativar" : "Inativar";
  }

  function editRule(kind: "slaRule" | "approvalRule" | "coverageRule" | "tokenRule", item: Record<string, unknown>) {
    setRuleDraft({
      id: String(item.id ?? ""),
      name: String(item.name ?? ""),
      requestType: String(item.requestType ?? item.typeName ?? ""),
      priority: String(item.priority ?? "Média"),
      hours: String(item.hours ?? item.slaHours ?? "24"),
      role: String(item.role ?? item.approverRole ?? "WFM"),
      lob: String(item.lob ?? "ALL"),
      shift: String(item.shift ?? ""),
      staffRequired: String(item.staffRequired ?? "1"),
      points: String(item.points ?? "1"),
      status: item.status === "INACTIVE" ? "INACTIVE" : "ACTIVE"
    });
    if (kind === "slaRule") setActiveSection("SLAs");
    if (kind === "approvalRule") setActiveSection("Regras de aprovação");
    if (kind === "coverageRule") setActiveSection("Regras de cobertura");
    if (kind === "tokenRule") setActiveSection("Regras de tokens");
  }

  function rulePanel(title: string, kind: "slaRule" | "approvalRule" | "coverageRule" | "tokenRule", items: Array<Record<string, unknown> & { id: string; name: string; status: "ACTIVE" | "INACTIVE" }>) {
    const isSla = kind === "slaRule";
    const isApproval = kind === "approvalRule";
    const isCoverage = kind === "coverageRule";
    return (
      <Panel title={title}>
        <div className="mb-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <input value={ruleDraft.name} onChange={(event) => setRuleDraft({ ...ruleDraft, name: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder="Nome da regra" />
          <input value={ruleDraft.requestType} onChange={(event) => setRuleDraft({ ...ruleDraft, requestType: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder={isCoverage ? "Dia/período" : "Tipo de solicitação/evento"} />
          <input value={isSla ? ruleDraft.hours : isCoverage ? ruleDraft.staffRequired : kind === "tokenRule" ? ruleDraft.points : ruleDraft.role} onChange={(event) => setRuleDraft({ ...ruleDraft, [isSla ? "hours" : isCoverage ? "staffRequired" : kind === "tokenRule" ? "points" : "role"]: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder={isSla ? "Prazo horas" : isCoverage ? "Staff necessário" : kind === "tokenRule" ? "Pontos" : "Role aprovadora"} />
          <select value={ruleDraft.lob} onChange={(event) => setRuleDraft({ ...ruleDraft, lob: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold outline-none">
            {["ALL", ...lobOptions.map((lob) => lob.name).filter((name) => name !== "ALL")].map((name) => <option key={name}>{name}</option>)}
          </select>
          <select value={ruleDraft.status} onChange={(event) => setRuleDraft({ ...ruleDraft, status: event.target.value as "ACTIVE" | "INACTIVE" })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold outline-none">
            <option value="ACTIVE">Ativo</option>
            <option value="INACTIVE">Inativo</option>
          </select>
          <button disabled={savingSettings} onClick={() => void saveSetting({ type: kind, ...ruleDraft, slaHours: Number(ruleDraft.hours), staffRequired: Number(ruleDraft.staffRequired), points: Number(ruleDraft.points), approverRole: ruleDraft.role, appliesScheduleChange: isApproval && ruleDraft.role === "WFM" }, ruleDraft.id ? "Regra atualizada." : "Regra criada.")} className="rounded-lg bg-blue-600 px-4 text-sm font-bold text-white disabled:opacity-60">
            {ruleDraft.id ? "Salvar regra" : "Criar regra"}
          </button>
        </div>
        {items.length ? (
          <SimpleTable
            columns={["Nome", isSla ? "Prazo" : isCoverage ? "Staff" : kind === "tokenRule" ? "Pontos" : "Role", "LOB", "Status", "Ações"]}
            rows={items.map((item) => [
              item.name,
              isSla ? `${String(item.slaHours ?? item.hours ?? "-")}h` : isCoverage ? String(item.staffRequired ?? "-") : kind === "tokenRule" ? String(item.points ?? "-") : String(item.approverRole ?? item.role ?? "-"),
              String(item.lob ?? "ALL"),
              <StatusBadge key={`${item.id}-status`} status={item.status === "INACTIVE" ? "Inativo" : "Ativo"} />,
              <div key={`${item.id}-actions`} className="flex flex-wrap gap-2">
                <button onClick={() => editRule(kind, item)} className="rounded-lg border border-border px-3 py-1 text-xs font-bold">Editar</button>
                <button onClick={() => void saveSetting({ type: kind, ...item, status: item.status === "INACTIVE" ? "ACTIVE" : "INACTIVE" }, "Status da regra atualizado.")} className="rounded-lg border border-border px-3 py-1 text-xs font-bold">{statusButtonLabel(item.status)}</button>
              </div>
            ])}
          />
        ) : <EmptyState title="Nenhuma regra cadastrada" description="Crie regras para parametrizar fluxos sem alterar código." />}
      </Panel>
    );
  }

  return (
    <div>
      <PageHeader title="Configurações" description="Administre usuários, perfis, permissões, regras e parâmetros do sistema." icon={Wrench} actions={<TopActions />} />
      {settingsMessage ? (
        <div className={cn("mb-5 rounded-lg border px-4 py-3 text-sm font-bold", settingsError ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700")}>
          {settingsMessage}
        </div>
      ) : null}
      <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Panel title="Módulos administrativos">
          {adminSections.map((section) => (
            <button key={section} onClick={() => setActiveSection(section)} className={cn("mb-2 flex w-full items-center justify-between rounded-lg px-4 py-3 text-left text-sm font-bold last:mb-0", activeSection === section ? "bg-blue-50 text-blue-700" : "hover:bg-slate-50")}>
              {section}
              <ChevronRight className="h-4 w-4" />
            </button>
          ))}
        </Panel>
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-4">
            <MetricPill value={activeLobs} label="LOBs ativas" />
            <MetricPill value={activeShifts} label="Turnos ativos" />
            <MetricPill value={activeTitles} label="Cargos ativos" />
            <MetricPill value={activeTeams} label="Times ativos" />
          </div>

          {activeSection === "Usuários" ? (
            <Panel title="Usuários">
              <div className="mb-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                <input value={userDraft.name} onChange={(event) => setUserDraft({ ...userDraft, name: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder="Nome" />
                <input value={userDraft.email} onChange={(event) => setUserDraft({ ...userDraft, email: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder="E-mail" />
                <select value={userDraft.roleName} onChange={(event) => setUserDraft({ ...userDraft, roleName: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold outline-none">{roleOptions.map((role) => <option key={role}>{role}</option>)}</select>
                <select value={userDraft.employeeId} onChange={(event) => setUserDraft({ ...userDraft, employeeId: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold outline-none">
                  <option value="">Sem vínculo</option>
                  {employeeOptionsForSettings.map((employee) => <option key={employee.id} value={employee.id}>{employee.name} - {employee.email || employee.wb || employee.id}</option>)}
                </select>
                <input value={userDraft.password} onChange={(event) => setUserDraft({ ...userDraft, password: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder="Senha temp/reset" type="password" />
                <button disabled={savingSettings} onClick={() => void saveSetting({ type: "user", ...userDraft }, userDraft.id ? "Usuário atualizado." : "Usuário criado.")} className="rounded-lg bg-blue-600 px-4 text-sm font-bold text-white disabled:opacity-60">{userDraft.id ? "Salvar" : "Criar"}</button>
              </div>
              {settings?.users?.length ? <SimpleTable columns={["Nome", "E-mail", "Role", "Status", "Vínculo", "Ações"]} rows={settings.users.map((user) => [
                user.name,
                user.email,
                user.roleName,
                <StatusBadge key={`${user.id}-status`} status={user.status === "ACTIVE" ? "Ativo" : "Inativo"} />,
                user.employeeName || "-",
                <div key={`${user.id}-actions`} className="flex flex-wrap gap-2">
                  <button onClick={() => setUserDraft({ id: user.id, name: user.name, email: user.email, roleName: user.roleName, status: user.status, employeeId: user.employeeId ?? "", password: "" })} className="rounded-lg border border-border px-3 py-1 text-xs font-bold">Editar</button>
                  <button onClick={() => void saveSetting({ type: "user", id: user.id, name: user.name, email: user.email, roleName: user.roleName, employeeId: user.employeeId, status: user.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" }, "Status do usuário atualizado.")} className="rounded-lg border border-border px-3 py-1 text-xs font-bold">{user.status === "ACTIVE" ? "Inativar" : "Ativar"}</button>
                </div>
              ])} /> : <EmptyState title="Nenhum usuário" description="Crie usuários reais para acessar a plataforma." />}
            </Panel>
          ) : null}

          {activeSection === "Perfis" ? (
            <Panel title="Perfis/Roles">
              <div className="mb-4 grid gap-3 md:grid-cols-[1fr_1fr_1fr_120px_auto]">
                <input value={roleDraft.name} onChange={(event) => setRoleDraft({ ...roleDraft, name: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder="Role interna" />
                <input value={roleDraft.label} onChange={(event) => setRoleDraft({ ...roleDraft, label: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder="Label" />
                <input value={roleDraft.description} onChange={(event) => setRoleDraft({ ...roleDraft, description: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder="Descrição" />
                <select value={roleDraft.status} onChange={(event) => setRoleDraft({ ...roleDraft, status: event.target.value as "ACTIVE" | "INACTIVE" })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold"><option value="ACTIVE">Ativo</option><option value="INACTIVE">Inativo</option></select>
                <button disabled={savingSettings || !roleDraft.id} onClick={() => void saveSetting({ type: "role", ...roleDraft }, "Perfil atualizado.")} className="rounded-lg bg-blue-600 px-4 text-sm font-bold text-white disabled:opacity-60">Salvar</button>
              </div>
              <SimpleTable columns={["Role", "Label", "Essencial", "Status", "Ações"]} rows={(settings?.roles ?? []).map((role) => [
                role.name,
                role.label,
                role.essential ? "Sim" : "Não",
                <StatusBadge key={`${role.id}-status`} status={role.status === "INACTIVE" ? "Inativo" : "Ativo"} />,
                <button key={`${role.id}-edit`} onClick={() => setRoleDraft({ id: role.id, name: role.name, label: role.label, description: role.description ?? "", status: role.status ?? "ACTIVE" })} className="rounded-lg border border-border px-3 py-1 text-xs font-bold">Editar</button>
              ])} />
            </Panel>
          ) : null}

          {activeSection === "Permissões" ? (
            <Panel title="Permissões">
              <div className="mb-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                <input value={permissionDraft.key} onChange={(event) => setPermissionDraft({ ...permissionDraft, key: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder="Chave" />
                <input value={permissionDraft.label} onChange={(event) => setPermissionDraft({ ...permissionDraft, label: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder="Label" />
                <select value={permissionDraft.roleName} onChange={(event) => setPermissionDraft({ ...permissionDraft, roleName: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold outline-none"><option value="">Sem role</option>{roleOptions.map((role) => <option key={role}>{role}</option>)}</select>
                <select value={permissionDraft.granted ? "true" : "false"} onChange={(event) => setPermissionDraft({ ...permissionDraft, granted: event.target.value === "true" })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold outline-none"><option value="true">Conceder</option><option value="false">Remover</option></select>
                <select value={permissionDraft.status} onChange={(event) => setPermissionDraft({ ...permissionDraft, status: event.target.value as "ACTIVE" | "INACTIVE" })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold outline-none"><option value="ACTIVE">Ativa</option><option value="INACTIVE">Inativa</option></select>
                <button disabled={savingSettings} onClick={() => void saveSetting({ type: "permission", ...permissionDraft }, "Permissão salva.")} className="rounded-lg bg-blue-600 px-4 text-sm font-bold text-white disabled:opacity-60">Salvar</button>
              </div>
              <SimpleTable columns={["Chave", "Label", "Status", "Ações"]} rows={(settings?.permissions ?? []).map((permission) => [
                permission.key,
                permission.label,
                <StatusBadge key={`${permission.id}-status`} status={permission.status === "INACTIVE" ? "Inativa" : "Ativa"} />,
                <button key={`${permission.id}-edit`} onClick={() => setPermissionDraft({ id: permission.id, key: permission.key, label: permission.label, description: permission.description ?? "", status: permission.status, roleName: "", granted: true })} className="rounded-lg border border-border px-3 py-1 text-xs font-bold">Editar</button>
              ])} />
            </Panel>
          ) : null}

          {activeSection === "LOBs" ? <Panel title="LOBs">
            <div className="mb-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
              <input value={lobDraft.name} onChange={(event) => setLobDraft({ ...lobDraft, name: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder="Nome da LOB" />
              <input value={lobDraft.description} onChange={(event) => setLobDraft({ ...lobDraft, description: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder="Descrição" />
              <button disabled={savingSettings} onClick={() => void saveSetting({ type: "lob", ...lobDraft, status: "ACTIVE" }, lobDraft.id ? "LOB atualizada." : "LOB criada.")} className="rounded-lg bg-blue-600 px-4 text-sm font-bold text-white disabled:opacity-60">
                {lobDraft.id ? "Salvar LOB" : "Criar LOB"}
              </button>
            </div>
            {settings?.lobs.length ? (
              <SimpleTable
                columns={["Nome", "Descrição", "Status", "Ações"]}
                rows={settings.lobs.map((lob) => [
                  lob.name,
                  lob.description || "-",
                  <StatusBadge key={`${lob.id}-status`} status={lob.status === "INACTIVE" ? "Inativo" : "Ativo"} />,
                  <div key={`${lob.id}-actions`} className="flex flex-wrap gap-2">
                    <button onClick={() => setLobDraft({ id: lob.id, name: lob.name, description: lob.description ?? "" })} className="rounded-lg border border-border px-3 py-1 text-xs font-bold">Editar</button>
                    <button onClick={() => void saveSetting({ type: "lob", id: lob.id, name: lob.name, description: lob.description, status: lob.status === "INACTIVE" ? "ACTIVE" : "INACTIVE" }, "Status da LOB atualizado.")} className="rounded-lg border border-border px-3 py-1 text-xs font-bold">
                      {lob.status === "INACTIVE" ? "Ativar" : "Inativar"}
                    </button>
                  </div>
                ])}
              />
            ) : <EmptyState title="Nenhuma LOB cadastrada" description="Crie uma LOB para alimentar filtros, cadastros e cronograma." />}
          </Panel> : null}

          {activeSection === "Times" ? (
            <Panel title="Times">
              <div className="mb-4 grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto]">
                <input value={teamDraft.name} onChange={(event) => setTeamDraft({ ...teamDraft, name: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder="Nome do time" />
                <select value={teamDraft.lobId} onChange={(event) => setTeamDraft({ ...teamDraft, lobId: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold outline-none"><option value="">LOB</option>{lobOptions.map((lob) => <option key={lob.id} value={lob.id}>{lob.name}</option>)}</select>
                <select value={teamDraft.supervisorId} onChange={(event) => setTeamDraft({ ...teamDraft, supervisorId: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold outline-none"><option value="">Sem supervisor</option>{supervisorOptions.map((supervisor) => <option key={supervisor.id} value={supervisor.id}>{supervisor.name} - {supervisor.email}</option>)}</select>
                <button disabled={savingSettings} onClick={() => void saveSetting({ type: "team", ...teamDraft }, teamDraft.id ? "Time atualizado." : "Time criado.")} className="rounded-lg bg-blue-600 px-4 text-sm font-bold text-white disabled:opacity-60">{teamDraft.id ? "Salvar" : "Criar"}</button>
              </div>
              {teamOptions.length ? <SimpleTable columns={["Time", "LOB", "Supervisor", "Status", "Ações"]} rows={teamOptions.map((team) => [
                team.name,
                team.lob,
                team.supervisorName || "-",
                <StatusBadge key={`${team.id}-status`} status={team.status === "INACTIVE" ? "Inativo" : "Ativo"} />,
                <div key={`${team.id}-actions`} className="flex flex-wrap gap-2">
                  <button onClick={() => setTeamDraft({ id: team.id, name: team.name, lobId: team.lobId, supervisorId: team.supervisorId ?? "", status: team.status })} className="rounded-lg border border-border px-3 py-1 text-xs font-bold">Editar</button>
                  <button onClick={() => void saveSetting({ type: "team", id: team.id, name: team.name, lobId: team.lobId, supervisorId: team.supervisorId, status: team.status === "INACTIVE" ? "ACTIVE" : "INACTIVE" }, "Status do time atualizado.")} className="rounded-lg border border-border px-3 py-1 text-xs font-bold">{statusButtonLabel(team.status)}</button>
                </div>
              ])} /> : <EmptyState title="Nenhum time" description="Crie times para supervisão, filtros e esteiras." />}
            </Panel>
          ) : null}

          {activeSection === "Supervisores" ? (
            <Panel title="Supervisores">
              <div className="mb-4 grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto]">
                <select value={supervisorDraft.supervisorId} onChange={(event) => setSupervisorDraft({ ...supervisorDraft, supervisorId: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold outline-none"><option value="">Supervisor</option>{supervisorOptions.map((supervisor) => <option key={supervisor.id} value={supervisor.id}>{supervisor.name} - {supervisor.email}</option>)}</select>
                <select value={supervisorDraft.teamId} onChange={(event) => setSupervisorDraft({ ...supervisorDraft, teamId: event.target.value, employeeId: "" })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold outline-none"><option value="">Vincular time</option>{teamOptions.map((team) => <option key={team.id} value={team.id}>{team.name} - {team.lob}</option>)}</select>
                <select value={supervisorDraft.employeeId} onChange={(event) => setSupervisorDraft({ ...supervisorDraft, employeeId: event.target.value, teamId: "" })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold outline-none"><option value="">Vincular colaborador</option>{employeeOptionsForSettings.map((employee) => <option key={employee.id} value={employee.id}>{employee.name} - {employee.email || employee.wb}</option>)}</select>
                <button disabled={savingSettings} onClick={() => void saveSetting({ type: "supervisor", ...supervisorDraft }, "Vínculo de supervisão atualizado.")} className="rounded-lg bg-blue-600 px-4 text-sm font-bold text-white disabled:opacity-60">Salvar vínculo</button>
              </div>
              {supervisorOptions.length ? <SimpleTable columns={["Supervisor", "E-mail", "LOB", "Time", "Agentes", "Status"]} rows={supervisorOptions.map((supervisor) => [
                supervisor.name,
                supervisor.email || "-",
                supervisor.lob || "-",
                supervisor.team || "-",
                String(supervisor.supervisees ?? 0),
                supervisor.status || "Ativo"
              ])} /> : <EmptyState title="Nenhum supervisor" description="Atribua role SUPERVISOR a um usuário para aparecer aqui." />}
            </Panel>
          ) : null}

          {activeSection === "Turnos" ? <Panel title="Turnos">
            <div className="mb-4 grid gap-3 md:grid-cols-[1fr_120px_120px_110px_auto]">
              <input value={shiftDraft.name} onChange={(event) => setShiftDraft({ ...shiftDraft, name: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder="Nome do turno" />
              <input value={shiftDraft.startsAt} onChange={(event) => setShiftDraft({ ...shiftDraft, startsAt: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder="Entrada" />
              <input value={shiftDraft.endsAt} onChange={(event) => setShiftDraft({ ...shiftDraft, endsAt: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder="Saída" />
              <input type="color" value={shiftDraft.color} onChange={(event) => setShiftDraft({ ...shiftDraft, color: event.target.value })} className="h-10 rounded-lg border border-border px-2" />
              <button disabled={savingSettings} onClick={() => void saveSetting({ type: "shift", ...shiftDraft, name: cleanShiftName(shiftDraft.name), status: isBlockedShiftName(shiftDraft.name) ? "INACTIVE" : "ACTIVE" }, shiftDraft.id ? "Turno atualizado." : "Turno criado.")} className="rounded-lg bg-blue-600 px-4 text-sm font-bold text-white disabled:opacity-60">
                {shiftDraft.id ? "Salvar" : "Criar"}
              </button>
            </div>
            {settings?.shifts.length ? (
              <SimpleTable
                columns={["Turno", "Entrada", "Saída", "Status", "Ações"]}
                rows={settings.shifts.map((shift) => {
                  const blockedShift = isBlockedShiftName(shift.name);
                  const effectiveStatus = blockedShift ? "INACTIVE" : shift.status;
                  return [
                    cleanShiftName(shift.name),
                    shift.startsAt,
                    shift.endsAt,
                    <StatusBadge key={`${shift.id}-status`} status={effectiveStatus === "INACTIVE" ? "Inativo" : "Ativo"} />,
                    <div key={`${shift.id}-actions`} className="flex flex-wrap gap-2">
                      <button onClick={() => setShiftDraft({ id: shift.id, name: cleanShiftName(shift.name), startsAt: shift.startsAt, endsAt: shift.endsAt, color: shift.color ?? "#2563EB" })} className="rounded-lg border border-border px-3 py-1 text-xs font-bold">Editar</button>
                      <button
                        disabled={blockedShift}
                        onClick={() => void saveSetting({ type: "shift", id: shift.id, name: cleanShiftName(shift.name), startsAt: shift.startsAt, endsAt: shift.endsAt, color: shift.color, status: effectiveStatus === "INACTIVE" ? "ACTIVE" : "INACTIVE" }, "Status do turno atualizado.")}
                        className="rounded-lg border border-border px-3 py-1 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {blockedShift ? "Inativo padrão" : effectiveStatus === "INACTIVE" ? "Ativar" : "Inativar"}
                      </button>
                    </div>
                  ];
                })}
              />
            ) : <EmptyState title="Nenhum turno cadastrado" description="Crie turnos para aparecerem em cronograma e filtros." />}
          </Panel> : null}

          {activeSection === "Cargos/Funções" ? <div className="grid gap-5 xl:grid-cols-2">
            <Panel title="Cargos/Funções">
              <div className="mb-4 grid gap-3 md:grid-cols-[1fr_auto]">
                <input value={roleTitleDraft.name} onChange={(event) => setRoleTitleDraft({ ...roleTitleDraft, name: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder="Cargo/Função operacional" />
                <button disabled={savingSettings} onClick={() => void saveSetting({ type: "roleTitle", ...roleTitleDraft }, roleTitleDraft.previousName ? "Cargo atualizado." : "Cargo criado.")} className="rounded-lg bg-blue-600 px-4 text-sm font-bold text-white disabled:opacity-60">
                  {roleTitleDraft.previousName ? "Salvar" : "Criar"}
                </button>
              </div>
              {settings?.roleTitles.length ? (
                <div className="space-y-2">
                  {settings.roleTitles.map((title) => (
                    <div key={title.name} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                      <span className="font-bold text-navy-950">{title.name}</span>
                      <div className="flex gap-2">
                        <StatusBadge status={title.status === "INACTIVE" ? "Inativo" : "Ativo"} />
                        <button onClick={() => setRoleTitleDraft({ previousName: title.name, name: title.name, status: title.status })} className="text-xs font-bold text-blue-600">Editar</button>
                        <button onClick={() => void saveSetting({ type: "roleTitle", previousName: title.name, name: title.name, status: title.status === "INACTIVE" ? "ACTIVE" : "INACTIVE" }, "Status do cargo atualizado.")} className="text-xs font-bold text-navy-700">
                          {title.status === "INACTIVE" ? "Ativar" : "Inativar"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : <EmptyState title="Nenhum cargo configurado" description="Cadastre cargos operacionais para uso no Mapa e cadastros." />}
            </Panel>
          </div> : null}

          {activeSection === "Configurações gerais" ? (
            <Panel title="Parâmetros e permissões">
              <div className="mb-5 grid gap-3 md:grid-cols-[1fr_auto]">
                <FormInput label="Mês padrão local" value={defaultMonthDraft} onChange={setDefaultMonthDraft} />
                <button disabled={savingSettings} onClick={() => void saveSetting({ type: "defaultMonth", value: defaultMonthDraft }, "Mês padrão atualizado.")} className="self-end rounded-lg bg-blue-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-60">Salvar</button>
              </div>
              <SimpleTable
                columns={["Role", "Descrição"]}
                rows={(settings?.roles ?? []).map((role) => [role.name, role.label])}
              />
              <div className="mt-4 rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                Apenas ADMIN acessa esta página. Modo local/produção é informativo; secrets continuam fora da interface.
              </div>
              <div className="mt-5 grid gap-3 md:grid-cols-2">
                <FormInput label="Nome da operação" value={String(generalDraft.operationName ?? "Central Operacional")} onChange={(value) => setGeneralDraft({ ...generalDraft, operationName: value })} />
                <FormInput label="Fuso horário" value={String(generalDraft.timezone ?? "America/Sao_Paulo")} onChange={(value) => setGeneralDraft({ ...generalDraft, timezone: value })} />
                {["enableScheduleUpload", "enableDayOffRequests", "enableDayOffSell", "enablePublicRegistration", "enableEmployeeImport", "enableInternalNotifications"].map((key) => (
                  <label key={key} className="flex items-center justify-between rounded-lg border border-border bg-slate-50 p-3 text-sm font-bold text-navy-950">
                    {key}
                    <input type="checkbox" checked={Boolean(generalDraft[key] ?? true)} onChange={(event) => setGeneralDraft({ ...generalDraft, [key]: event.target.checked })} />
                  </label>
                ))}
                <button disabled={savingSettings} onClick={() => void saveSetting({ type: "generalSettings", values: { ...generalDraft, defaultMonth: defaultMonthDraft } }, "Configurações gerais salvas.")} className="rounded-lg bg-blue-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-60">Salvar configurações gerais</button>
              </div>
            </Panel>
          ) : null}

          {activeSection === "Tipos de solicitação" ? (
            <Panel title="Tipos de solicitação">
              <div className="mb-4 grid gap-3 md:grid-cols-[1fr_1fr_100px_120px_auto]">
                <input value={requestTypeDraft.name} onChange={(event) => setRequestTypeDraft({ ...requestTypeDraft, name: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder="Tipo" />
                <input value={requestTypeDraft.area} onChange={(event) => setRequestTypeDraft({ ...requestTypeDraft, area: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder="Área" />
                <input value={requestTypeDraft.slaHours} onChange={(event) => setRequestTypeDraft({ ...requestTypeDraft, slaHours: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder="SLA" />
                <select value={requestTypeDraft.status} onChange={(event) => setRequestTypeDraft({ ...requestTypeDraft, status: event.target.value as "ACTIVE" | "INACTIVE" })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold outline-none"><option value="ACTIVE">Ativo</option><option value="INACTIVE">Inativo</option></select>
                <button disabled={savingSettings} onClick={() => void saveSetting({ type: "requestType", ...requestTypeDraft, slaHours: Number(requestTypeDraft.slaHours) }, requestTypeDraft.id ? "Tipo atualizado." : "Tipo criado.")} className="rounded-lg bg-blue-600 px-4 text-sm font-bold text-white disabled:opacity-60">{requestTypeDraft.id ? "Salvar" : "Criar"}</button>
              </div>
              {settings?.requestTypes.length ? (
                <SimpleTable
                  columns={["Tipo", "Área", "SLA", "Aprovação", "Status", "Ações"]}
                  rows={settings.requestTypes.map((type) => [
                    type.name,
                    type.area,
                    `${type.slaHours}h`,
                    type.requiresApproval ? "Sim" : "Não",
                    <StatusBadge key={`${type.id}-status`} status={type.status === "INACTIVE" ? "Inativo" : "Ativo"} />,
                    <div key={`${type.id}-actions`} className="flex flex-wrap gap-2">
                      <button onClick={() => setRequestTypeDraft({ id: type.id, name: type.name, area: type.area, slaHours: String(type.slaHours), requiresApproval: type.requiresApproval, status: type.status ?? "ACTIVE" })} className="rounded-lg border border-border px-3 py-1 text-xs font-bold">Editar</button>
                      <button onClick={() => void saveSetting({ type: "requestType", id: type.id, name: type.name, area: type.area, slaHours: type.slaHours, requiresApproval: type.requiresApproval, status: type.status === "INACTIVE" ? "ACTIVE" : "INACTIVE" }, "Status do tipo atualizado.")} className="rounded-lg border border-border px-3 py-1 text-xs font-bold">{statusButtonLabel(type.status)}</button>
                    </div>
                  ])}
                />
              ) : <EmptyState title="Nenhum tipo configurado" description="Tipos essenciais serão criados pelo seed local." />}
            </Panel>
          ) : null}

          {activeSection === "SLAs" ? rulePanel("SLAs", "slaRule", settings?.slaRules ?? []) : null}
          {activeSection === "Regras de aprovação" ? rulePanel("Regras de aprovação", "approvalRule", settings?.approvalRules ?? []) : null}
          {activeSection === "Regras de cobertura" ? rulePanel("Regras de cobertura", "coverageRule", settings?.coverageRules ?? []) : null}
          {activeSection === "Regras de tokens" ? rulePanel("Regras de tokens", "tokenRule", settings?.tokenRules ?? []) : null}
        </div>
      </div>
    </div>
  );
}
