import { Prisma } from "@prisma/client";

import type { Actor } from "@/lib/mock-db";
import { recordErrorLog } from "@/lib/mock-db";
import {
  MONTHLY_ADVANCE_ENDED_MESSAGE,
  MONTHLY_ADVANCE_FIXED_AMOUNT,
  isMonthlyAdvanceReferenceMonthAvailable,
  monthlyAdvanceAmountForOptIn
} from "@/lib/monthly-advance-constants";
import { prisma } from "@/lib/prisma";
import { normalizeRole } from "@/lib/permissions";

export const MONTHLY_ADVANCE_LOCKED_IMPLEMENTATION_MONTH = "2026-05";
export const MONTHLY_ADVANCE_RESPONSE_DEADLINE_DAY = 18;
const TIME_ZONE = "America/Sao_Paulo";
const MONTH_NAMES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro"
];
const MONTHLY_ADVANCE_PJ_ONLY_MESSAGE = "Adiantamento mensal disponível apenas para colaboradores PJ.";
const MONTHLY_ADVANCE_TRAINING_BLOCK_MESSAGE = "Adiantamento mensal indisponível para colaboradores em treinamento.";
const MONTHLY_ADVANCE_TRAINING_BLOCK_REASON = "TRAINING_STATUS";
const monthlyAdvanceTrainingStatusValues = [
  "Em treinamento",
  "EM_TREINAMENTO",
  "Treinamento",
  "TRAINING",
  "In training",
  "IN_TRAINING"
];

const monthNameIndex = new Map(
  MONTH_NAMES.map((name, index) => [
    name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase(),
    index + 1
  ])
);

type ActiveUser = NonNullable<Awaited<ReturnType<typeof findActiveUser>>>;
type AdvanceEmployee = {
  id: string;
  wbLogin: string;
  fullName: string;
  contractType?: string | null;
  user?: { email: string } | null;
  lob?: { id: string; name: string } | null;
  supervisor?: { id: string; fullName: string; wbLogin: string; user?: { email: string } | null } | null;
  operationalStatus?: string;
};

export type MonthlyAdvanceFilters = {
  referenceMonth?: string;
  lob?: string;
  supervisorId?: string;
  optIn?: string;
  search?: string;
  page?: string | number;
  limit?: string | number;
};

export type MonthlyAdvanceImportRow = {
  rowNumber: number;
  wbLogin: string;
  referenceMonth: string;
  optIn: boolean | null;
  amount: number | null;
  observation: string;
  employeeId?: string;
  employeeName?: string;
  contractType?: string;
  action?: "create" | "update";
  errors: string[];
  warnings: string[];
};

export function currentReferenceMonth(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? String(date.getFullYear());
  const month = parts.find((part) => part.type === "month")?.value ?? String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function getCurrentReferenceMonth(date = new Date()) {
  return currentReferenceMonth(date);
}

export function addReferenceMonths(referenceMonth: string, delta: number) {
  const [year, month] = referenceMonth.split("-").map(Number);
  const date = new Date(Date.UTC(year, (month || 1) - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function getNextReferenceMonth(date = new Date()) {
  return addReferenceMonths(getCurrentReferenceMonth(date), 1);
}

export function formatReferenceMonth(referenceMonth: string) {
  const [year, month] = referenceMonth.split("-").map(Number);
  const name = MONTH_NAMES[(month || 1) - 1] ?? referenceMonth;
  return `${name}/${year}`;
}

export function isAdvanceCurrentMonthOpen(today = new Date()) {
  return dayOfMonthInOperationTimeZone(today) < MONTHLY_ADVANCE_RESPONSE_DEADLINE_DAY;
}

export function isAdvanceMonthOpenForEmployee(referenceMonth: string, today = new Date(), options: { answered?: boolean } = {}) {
  const normalized = normalizeReferenceMonth(referenceMonth);
  if (!normalized || options.answered) return false;
  if (!isMonthlyAdvanceReferenceMonthAvailable(normalized)) return false;
  if (normalized === MONTHLY_ADVANCE_LOCKED_IMPLEMENTATION_MONTH) return false;

  const currentMonth = getCurrentReferenceMonth(today);
  const nextMonth = getNextReferenceMonth(today);
  if (normalized === currentMonth) return isAdvanceCurrentMonthOpen(today);
  if (normalized === nextMonth) return true;
  return false;
}

export function isAdvanceMonthLockedForEmployee(referenceMonth: string, today = new Date(), options: { answered?: boolean } = {}) {
  const normalized = normalizeReferenceMonth(referenceMonth);
  if (!normalized) return true;
  if (!isMonthlyAdvanceReferenceMonthAvailable(normalized)) return true;
  if (normalized === MONTHLY_ADVANCE_LOCKED_IMPLEMENTATION_MONTH) return true;
  if (options.answered) return true;

  const currentMonth = getCurrentReferenceMonth(today);
  const nextMonth = getNextReferenceMonth(today);
  if (normalized < currentMonth) return true;
  if (normalized === currentMonth) return !isAdvanceCurrentMonthOpen(today);
  if (normalized === nextMonth) return false;
  return true;
}

export function employeeMonthlyAdvanceCycleMonths(date = new Date()) {
  const currentMonth = getCurrentReferenceMonth(date);
  return [currentMonth, getNextReferenceMonth(date)].filter(isMonthlyAdvanceReferenceMonthAvailable);
}

export function isEmployeeMonthlyAdvanceCycleOpen(referenceMonth: string, date = new Date()) {
  const normalized = normalizeReferenceMonth(referenceMonth);
  return Boolean(normalized) && employeeMonthlyAdvanceCycleMonths(date).includes(normalized);
}

export function normalizeReferenceMonth(value: unknown, fallback?: string) {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback ?? "";
  const normalized = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const iso = normalized.match(/^(\d{4})[-/](\d{1,2})$/);
  if (iso) return formatMonthParts(Number(iso[1]), Number(iso[2]));

  const slash = normalized.match(/^(\d{1,2})[-/](\d{4})$/);
  if (slash) return formatMonthParts(Number(slash[2]), Number(slash[1]));

  const named = normalized.match(/^([a-zA-Z]+)\s*[/ ]\s*(\d{4})$/);
  if (named) {
    const month = monthNameIndex.get(named[1].toLowerCase());
    if (month) return formatMonthParts(Number(named[2]), month);
  }

  return "";
}

export function normalizeWbLogin(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function dayOfMonthInOperationTimeZone(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    day: "2-digit"
  }).formatToParts(date);
  return Number(parts.find((part) => part.type === "day")?.value ?? date.getDate());
}

function isImplementationLockedMonth(referenceMonth: string) {
  return normalizeReferenceMonth(referenceMonth) === MONTHLY_ADVANCE_LOCKED_IMPLEMENTATION_MONTH;
}

function monthlyAdvanceClosedMessage(referenceMonth: string, today = new Date(), answered = false) {
  const normalized = normalizeReferenceMonth(referenceMonth);
  if (normalized && !isMonthlyAdvanceReferenceMonthAvailable(normalized)) return MONTHLY_ADVANCE_ENDED_MESSAGE;
  if (isImplementationLockedMonth(normalized)) return "Este ciclo já foi fechado e pago. Alterações para este mês não estão disponíveis.";
  if (answered) return "Para alterar uma resposta já registrada ou solicitar exceção após o prazo, abra uma solicitação.";
  if (normalized === getCurrentReferenceMonth(today) && !isAdvanceCurrentMonthOpen(today)) {
    return "O prazo para responder o adiantamento deste mês encerrou no dia 18.";
  }
  if (normalized && normalized < getCurrentReferenceMonth(today)) return "Este mês está disponível apenas como histórico.";
  if (normalized && normalized !== getCurrentReferenceMonth(today) && normalized !== getNextReferenceMonth(today)) {
    return "Este mês não está aberto para resposta direta.";
  }
  return "";
}

function monthlyAdvanceDeadlineMessage(referenceMonth: string, today = new Date(), answered = false) {
  if (answered || isImplementationLockedMonth(referenceMonth)) return "";
  const normalized = normalizeReferenceMonth(referenceMonth);
  if (normalized && !isMonthlyAdvanceReferenceMonthAvailable(normalized)) return MONTHLY_ADVANCE_ENDED_MESSAGE;
  if (normalized === getCurrentReferenceMonth(today)) {
    return isAdvanceCurrentMonthOpen(today)
      ? "Você pode responder o adiantamento deste mês antes do dia 18."
      : "O prazo para responder o adiantamento deste mês encerrou no dia 18.";
  }
  if (normalized === getNextReferenceMonth(today)) return "Você já pode responder o adiantamento do próximo mês.";
  return "";
}

export function parseAdvanceOptIn(value: unknown): boolean | null {
  const normalized = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  if (["sim", "s", "true", "1", "yes", "y"].includes(normalized)) return true;
  if (["nao", "n", "false", "0", "no"].includes(normalized)) return false;
  return null;
}

export function parseAdvanceAmount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? roundMoney(value) : null;
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const cleaned = raw
    .replace(/R\$/gi, "")
    .replace(/\s/g, "")
    .replace(/[^\d,.-]/g, "");
  if (!cleaned) return null;
  const decimalSeparator = cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".") ? "," : ".";
  const normalized = cleaned
    .replace(decimalSeparator === "," ? /\./g : /,/g, "")
    .replace(decimalSeparator, ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? roundMoney(parsed) : null;
}

export async function listMonthlyAdvances(actor: Actor, filters: MonthlyAdvanceFilters = {}) {
  const user = await findActiveUser(actor.email);
  if (!user) return { error: "Usuário ativo não encontrado.", status: 401 };
  const role = normalizeRole(actor.role);
  if (!canViewMonthlyAdvance(role)) return { error: "Você não tem permissão para visualizar adiantamento mensal.", status: 403 };

  const referenceMonth = normalizeReferenceMonth(filters.referenceMonth, currentReferenceMonth());
  if (!isMonthlyAdvanceReferenceMonthAvailable(referenceMonth)) {
    return {
      data: [],
      summary: { total: 0, optIn: 0, optOut: 0, amount: 0 },
      page: parsePositiveInteger(filters.page, 1),
      limit: Math.min(parsePositiveInteger(filters.limit, 50), 5000),
      total: 0,
      totalPages: 1,
      referenceMonth,
      canManage: canManageMonthlyAdvance(role),
      canExport: canExportMonthlyAdvance(role),
      message: MONTHLY_ADVANCE_ENDED_MESSAGE
    };
  }
  const where: Prisma.MonthlyAdvanceRecordWhereInput = { referenceMonth, status: { not: "REMOVED" } };
  const and: Prisma.MonthlyAdvanceRecordWhereInput[] = [{ employee: monthlyAdvanceEligibleEmployeeWhere() }];

  if (role === "COLABORADOR") {
    const employee = await resolveEmployeeForUser(user);
    if (!employee) return { error: "Seu usuário não está vinculado a um cadastro de colaborador.", status: 400 };
    if (!isMonthlyAdvanceEligibleContract(employee.contractType)) return { error: MONTHLY_ADVANCE_PJ_ONLY_MESSAGE, status: 403 };
    if (isMonthlyAdvanceTrainingStatus(employee.operationalStatus)) return { error: MONTHLY_ADVANCE_TRAINING_BLOCK_MESSAGE, status: 403 };
    where.employeeId = employee.id;
  }

  if (filters.lob && filters.lob !== "Todos") {
    and.push({
      employee: {
        OR: [
          { lobId: filters.lob },
          { lob: { name: { equals: filters.lob, mode: "insensitive" } } }
        ]
      }
    });
  }

  if (filters.supervisorId && filters.supervisorId !== "Todos") {
    if (["SEM_SUPERVISOR", "NONE", "Sem supervisor"].includes(filters.supervisorId)) {
      and.push({ employee: { supervisorId: null } });
    } else {
      and.push({ employee: { supervisorId: filters.supervisorId } });
    }
  }

  if (filters.optIn && filters.optIn !== "Todos") {
    const optIn = parseAdvanceOptIn(filters.optIn);
    if (optIn !== null) where.optIn = optIn;
  }

  if (filters.search?.trim()) {
    const search = filters.search.trim();
    and.push({
      OR: [
        { employee: { fullName: { contains: search, mode: "insensitive" } } },
        { employee: { wbLogin: { contains: search, mode: "insensitive" } } },
        { employee: { user: { email: { contains: search, mode: "insensitive" } } } }
      ]
    });
  }

  if (and.length) where.AND = and;

  const page = parsePositiveInteger(filters.page, 1);
  const limit = Math.min(parsePositiveInteger(filters.limit, 50), 5000);
  const skip = (page - 1) * limit;
  const [total, records, aggregates] = await Promise.all([
    prisma.monthlyAdvanceRecord.count({ where }),
    prisma.monthlyAdvanceRecord.findMany({
      where,
      include: monthlyAdvanceInclude,
      orderBy: [{ employee: { fullName: "asc" } }, { createdAt: "desc" }],
      skip,
      take: limit
    }),
    prisma.monthlyAdvanceRecord.groupBy({
      by: ["optIn"],
      where,
      _count: { _all: true }
    })
  ]);

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const optInCount = aggregates.find((item) => item.optIn)?._count._all ?? 0;
  const summary = {
    total,
    optIn: optInCount,
    optOut: aggregates.find((item) => !item.optIn)?._count._all ?? 0,
    amount: optInCount * MONTHLY_ADVANCE_FIXED_AMOUNT
  };

  return {
    data: records.map(mapMonthlyAdvanceRecord),
    summary,
    page,
    limit,
    total,
    totalPages,
    referenceMonth,
    canManage: canManageMonthlyAdvance(role),
    canExport: canExportMonthlyAdvance(role)
  };
}

export async function getMyMonthlyAdvanceCycles(actor: Actor) {
  const user = await findActiveUser(actor.email);
  if (!user) return { error: "Usuário ativo não encontrado.", status: 401 };
  const employee = await resolveEmployeeForUser(user);
  if (!employee) return { error: "Seu usuário não está vinculado a um cadastro de colaborador.", status: 400 };
  if (!isMonthlyAdvanceEligibleContract(employee.contractType)) {
    return { data: [], message: MONTHLY_ADVANCE_PJ_ONLY_MESSAGE };
  }
  if (isMonthlyAdvanceTrainingStatus(employee.operationalStatus)) {
    return { data: [], message: MONTHLY_ADVANCE_TRAINING_BLOCK_MESSAGE, blockedReason: MONTHLY_ADVANCE_TRAINING_BLOCK_REASON };
  }

  const today = new Date();
  const months = employeeMonthlyAdvanceCycleMonths(today);
  if (!months.length) {
    return { data: [], message: MONTHLY_ADVANCE_ENDED_MESSAGE };
  }
  const records = await prisma.monthlyAdvanceRecord.findMany({
    where: { employeeId: employee.id, referenceMonth: { in: months }, status: { not: "REMOVED" } },
    include: monthlyAdvanceInclude
  });
  const recordByMonth = new Map(records.map((record) => [record.referenceMonth, record]));

  return {
    data: months.map((referenceMonth, index) => {
      const record = recordByMonth.get(referenceMonth);
      const answered = Boolean(record);
      const locked = isAdvanceMonthLockedForEmployee(referenceMonth, today, { answered });
      const canRespond = isAdvanceMonthOpenForEmployee(referenceMonth, today, { answered });
      const canRequestChange = !isImplementationLockedMonth(referenceMonth) && answered && isEmployeeMonthlyAdvanceCycleOpen(referenceMonth, today);
      return {
        referenceMonth,
        label: index === 0 ? "Mês atual" : "Próximo mês",
        monthLabel: formatReferenceMonth(referenceMonth),
        locked,
        closedMessage: monthlyAdvanceClosedMessage(referenceMonth, today, answered),
        deadlineMessage: monthlyAdvanceDeadlineMessage(referenceMonth, today, answered),
        answered,
        canRespond,
        canRequestChange,
        record: record ? mapMonthlyAdvanceRecord(record) : null
      };
    })
  };
}

export async function respondMonthlyAdvance(actor: Actor, input: { referenceMonth: string; optIn: boolean }) {
  const user = await findActiveUser(actor.email);
  if (!user) return { error: "Usuário ativo não encontrado.", status: 401 };

  const employee = await resolveEmployeeForUser(user);
  if (!employee) return { error: "Seu usuário não está vinculado a um cadastro de colaborador.", status: 400 };
  if (!isMonthlyAdvanceEligibleContract(employee.contractType)) return { error: MONTHLY_ADVANCE_PJ_ONLY_MESSAGE, status: 403 };
  if (isMonthlyAdvanceTrainingStatus(employee.operationalStatus)) return { error: MONTHLY_ADVANCE_TRAINING_BLOCK_MESSAGE, status: 403 };

  const referenceMonth = normalizeReferenceMonth(input.referenceMonth);
  if (!referenceMonth) return { error: "Mês de referência inválido.", status: 400 };
  if (!isMonthlyAdvanceReferenceMonthAvailable(referenceMonth)) return { error: MONTHLY_ADVANCE_ENDED_MESSAGE, status: 403 };
  const today = new Date();
  if (isImplementationLockedMonth(referenceMonth)) {
    return { error: "Este ciclo já foi fechado e pago. Alterações para este mês não estão disponíveis.", status: 403 };
  }
  if (!isEmployeeMonthlyAdvanceCycleOpen(referenceMonth)) {
    return { error: "Este mês não está aberto para resposta direta. Responda apenas o mês atual ou o próximo mês no Meu Cronograma.", status: 403 };
  }

  const existing = await prisma.monthlyAdvanceRecord.findUnique({
    where: { employeeId_referenceMonth: { employeeId: employee.id, referenceMonth } }
  });
  if (existing && existing.status !== "REMOVED") return { error: "Você já respondeu este ciclo. Para alterar, abra uma solicitação.", status: 409 };
  if (!isAdvanceMonthOpenForEmployee(referenceMonth, today)) {
    return { error: monthlyAdvanceClosedMessage(referenceMonth, today, false) || "Este mês não está aberto para resposta direta.", status: 403 };
  }

  const amount = monthlyAdvanceAmountForOptIn(input.optIn);
  const record = existing ? await prisma.monthlyAdvanceRecord.update({
    where: { id: existing.id },
    data: {
      optIn: input.optIn,
      amount: decimal(amount),
      hasDiscount: false,
      discountAmount: null,
      discountReason: null,
      finalAmount: decimal(amount),
      status: "RESPONDIDO",
      observation: "Resposta registrada pelo usuário.",
      updatedById: user.id
    },
    include: monthlyAdvanceInclude
  }) : await prisma.monthlyAdvanceRecord.create({
    data: {
      employeeId: employee.id,
      referenceMonth,
      optIn: input.optIn,
      amount: decimal(amount),
      hasDiscount: false,
      discountAmount: null,
      discountReason: null,
      finalAmount: decimal(amount),
      status: "RESPONDIDO",
      observation: "Resposta registrada pelo usuário.",
      updatedById: user.id
    },
    include: monthlyAdvanceInclude
  });

  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      action: "CRIACAO",
      entity: "MonthlyAdvanceRecord",
      entityId: record.id,
      reason: "Resposta de adiantamento mensal",
      newValue: { employeeId: employee.id, referenceMonth, optIn: input.optIn, amount }
    }
  });

  return { data: mapMonthlyAdvanceRecord(record) };
}

export async function upsertMonthlyAdvance(actor: Actor, input: {
  employeeId?: string;
  wbLogin?: string;
  referenceMonth: string;
  optIn: boolean;
  observation?: string;
}) {
  const user = await findActiveUser(actor.email);
  if (!user) return { error: "Usuário ativo não encontrado.", status: 401 };
  if (!canManageMonthlyAdvance(normalizeRole(actor.role))) return { error: "Você não tem permissão para gerir adiantamento mensal.", status: 403 };

  const employee = input.employeeId
    ? await prisma.employeeProfile.findFirst({ where: { id: input.employeeId, deletedAt: null }, include: employeeInclude })
    : await findEmployeeByWbLogin(input.wbLogin);
  if (!employee) return { error: "WB/Login não encontrado.", status: 404 };
  if (!isMonthlyAdvanceEligibleContract(employee.contractType)) return { error: MONTHLY_ADVANCE_PJ_ONLY_MESSAGE, status: 400 };
  if (isMonthlyAdvanceTrainingStatus(employee.operationalStatus)) return { error: MONTHLY_ADVANCE_TRAINING_BLOCK_MESSAGE, status: 400 };

  const referenceMonth = normalizeReferenceMonth(input.referenceMonth);
  if (!referenceMonth) return { error: "Mês de referência inválido.", status: 400 };
  if (!isMonthlyAdvanceReferenceMonthAvailable(referenceMonth)) return { error: MONTHLY_ADVANCE_ENDED_MESSAGE, status: 400 };
  const amount = monthlyAdvanceAmountForOptIn(input.optIn);

  const previous = await prisma.monthlyAdvanceRecord.findUnique({
    where: { employeeId_referenceMonth: { employeeId: employee.id, referenceMonth } }
  });
  const record = await prisma.monthlyAdvanceRecord.upsert({
    where: { employeeId_referenceMonth: { employeeId: employee.id, referenceMonth } },
    update: {
      optIn: input.optIn,
      amount: decimal(amount),
      hasDiscount: false,
      discountAmount: null,
      discountReason: null,
      finalAmount: decimal(amount),
      status: "ACTIVE",
      observation: input.observation?.trim() || null,
      updatedById: user.id
    },
    create: {
      employeeId: employee.id,
      referenceMonth,
      optIn: input.optIn,
      amount: decimal(amount),
      hasDiscount: false,
      discountAmount: null,
      discountReason: null,
      finalAmount: decimal(amount),
      status: "ACTIVE",
      observation: input.observation?.trim() || null,
      updatedById: user.id
    },
    include: monthlyAdvanceInclude
  });

  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      action: previous ? "EDICAO" : "CRIACAO",
      entity: "MonthlyAdvanceRecord",
      entityId: record.id,
      reason: previous ? "Adiantamento mensal atualizado" : "Adiantamento mensal criado",
      previousValue: previous ? { optIn: previous.optIn, amount: Number(previous.amount), observation: previous.observation } : undefined,
      newValue: { employeeId: employee.id, referenceMonth, optIn: input.optIn, amount, observation: input.observation ?? null }
    }
  });

  return { data: mapMonthlyAdvanceRecord(record) };
}

export async function previewMonthlyAdvanceImport(actor: Actor, rawRows: Array<Record<string, unknown>>, fallbackReferenceMonth?: string) {
  const user = await findActiveUser(actor.email);
  if (!user) return { error: "Usuário ativo não encontrado.", status: 401 };
  if (!canManageMonthlyAdvance(normalizeRole(actor.role))) return { error: "Você não tem permissão para importar adiantamento mensal.", status: 403 };

  const fallback = normalizeReferenceMonth(fallbackReferenceMonth, currentReferenceMonth());
  if (fallback && !isMonthlyAdvanceReferenceMonthAvailable(fallback)) {
    return { error: MONTHLY_ADVANCE_ENDED_MESSAGE, status: 400 };
  }
  const normalizedWbLogins = Array.from(new Set(rawRows.map((row) => normalizeWbLogin(importRowWbLogin(row))).filter(Boolean)));
  const employees = await findEmployeesByNormalizedWbLogins(normalizedWbLogins);
  const employeeByLogin = new Map(employees.map((employee) => [normalizeWbLogin(employee.wbLogin), employee]));
  const missingWbLogins = normalizedWbLogins.filter((login) => !employeeByLogin.has(login));
  console.info("[monthly-advance-import:validation]", {
    totalRows: rawRows.length,
    uniqueWbLogins: normalizedWbLogins.length,
    firstNormalizedWbLogins: normalizedWbLogins.slice(0, 10),
    employeeProfilesFound: normalizedWbLogins.length - missingWbLogins.length,
    employeeProfilesMissing: missingWbLogins.length,
    firstMissingWbLogins: missingWbLogins.slice(0, 20)
  });
  const parsedRows = rawRows.map((raw, index) => parseImportRow(raw, index + 2, fallback, employeeByLogin));
  const keys = parsedRows
    .filter((row) => row.employeeId && row.referenceMonth)
    .map((row) => ({ employeeId: row.employeeId as string, referenceMonth: row.referenceMonth }));
  const existing = keys.length
    ? await prisma.monthlyAdvanceRecord.findMany({
        where: {
          OR: keys.map((key) => ({ employeeId: key.employeeId, referenceMonth: key.referenceMonth }))
        },
        select: { employeeId: true, referenceMonth: true }
      })
    : [];
  const existingKeys = new Set(existing.map((record) => `${record.employeeId}:${record.referenceMonth}`));
  const rows = parsedRows.map((row) => ({
    ...row,
    action: row.employeeId && row.referenceMonth && existingKeys.has(`${row.employeeId}:${row.referenceMonth}`) ? "update" as const : "create" as const
  }));

  return importPreviewPayload(rows);
}

export async function removeMonthlyAdvance(actor: Actor, id: string) {
  const user = await findActiveUser(actor.email);
  if (!user) return { error: "Usuário ativo não encontrado.", status: 401 };
  if (!canDeleteMonthlyAdvance(normalizeRole(actor.role))) return { error: "Você não tem permissão para remover registros de adiantamento.", status: 403 };
  const record = await prisma.monthlyAdvanceRecord.findUnique({
    where: { id },
    include: monthlyAdvanceInclude
  });
  if (!record || record.status === "REMOVED") return { error: "Registro de adiantamento não encontrado.", status: 404 };

  const removed = await prisma.monthlyAdvanceRecord.update({
    where: { id },
    data: {
      status: "REMOVED",
      updatedById: user.id,
      observation: record.observation ? `${record.observation}\nRegistro removido da lista ativa.` : "Registro removido da lista ativa."
    },
    include: monthlyAdvanceInclude
  });

  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      action: "EXCLUSAO",
      entity: "MonthlyAdvanceRecord",
      entityId: record.id,
      reason: "ADVANCE_RECORD_REMOVED",
      previousValue: {
        employeeId: record.employeeId,
        referenceMonth: record.referenceMonth,
        optIn: record.optIn,
        amount: Number(record.amount),
        status: record.status
      },
      newValue: { status: "REMOVED", action: "ADVANCE_RECORD_REMOVED" }
    }
  });

  return { data: mapMonthlyAdvanceRecord(removed) };
}

export async function commitMonthlyAdvanceImport(actor: Actor, rows: Array<Record<string, unknown>>, fallbackReferenceMonth?: string) {
  const user = await findActiveUser(actor.email);
  if (!user) return { error: "Usuário ativo não encontrado.", status: 401 };
  if (!canManageMonthlyAdvance(normalizeRole(actor.role))) return { error: "Você não tem permissão para importar adiantamento mensal.", status: 403 };

  const preview = await previewMonthlyAdvanceImport(actor, rows, fallbackReferenceMonth);
  if ("error" in preview) return preview;
  const validRows = preview.rows.filter((row) => !row.errors.length && row.employeeId && row.optIn !== null && row.amount !== null);
  if (!validRows.length) return { error: "Nenhuma linha válida para importar.", status: 400, preview };

  let createdRows = 0;
  let updatedRows = 0;
  for (const row of validRows) {
    const amount = monthlyAdvanceAmountForOptIn(Boolean(row.optIn));
    await prisma.monthlyAdvanceRecord.upsert({
      where: { employeeId_referenceMonth: { employeeId: row.employeeId!, referenceMonth: row.referenceMonth } },
      update: {
        optIn: Boolean(row.optIn),
        amount: decimal(amount),
        hasDiscount: false,
        discountAmount: null,
        discountReason: null,
        finalAmount: decimal(amount),
        status: "ACTIVE",
        observation: row.observation || null,
        updatedById: user.id
      },
      create: {
        employeeId: row.employeeId!,
        referenceMonth: row.referenceMonth,
        optIn: Boolean(row.optIn),
        amount: decimal(amount),
        hasDiscount: false,
        discountAmount: null,
        discountReason: null,
        finalAmount: decimal(amount),
        status: "ACTIVE",
        observation: row.observation || null,
        updatedById: user.id
      }
    });
    if (row.action === "update") updatedRows += 1;
    else createdRows += 1;
  }

  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      action: "IMPORTACAO",
      entity: "MonthlyAdvanceRecord",
      entityId: `monthly-advance-import-${Date.now()}`,
      reason: "Importação de adiantamento mensal",
      newValue: { createdRows, updatedRows, totalRows: rows.length }
    }
  });

  return {
    data: {
      createdRows,
      updatedRows,
      importedRows: createdRows + updatedRows,
      errorRows: preview.errorRows
    },
    preview
  };
}

export async function exportMonthlyAdvances(actor: Actor, filters: MonthlyAdvanceFilters = {}) {
  const result = await listMonthlyAdvances(actor, { ...filters, page: 1, limit: 5000 });
  if ("error" in result) return result;
  const employeeIds = Array.from(new Set(result.data.map((record) => record.employeeId)));
  const sensitiveRows = employeeIds.length
    ? await prisma.employeeSensitiveData.findMany({
        where: { employeeId: { in: employeeIds } },
        select: { employeeId: true, cnpj: true }
      })
    : [];
  const cnpjByEmployeeId = new Map(sensitiveRows.map((row) => [row.employeeId, row.cnpj ?? ""]));
  const headers = [
    "mes_referencia",
    "nome",
    "wb_login",
    "email",
    "cnpj",
    "tipo_contrato",
    "lob",
    "supervisor",
    "status_colaborador",
    "aderente",
    "valor",
    "observacao",
    "atualizado_por",
    "atualizado_em"
  ];
  const rows = result.data.map((record) => [
    record.referenceMonth,
    record.employeeName,
    record.wbLogin,
    record.email ?? "",
    cnpjByEmployeeId.get(record.employeeId) ?? "",
    record.contractType ?? "",
    record.lob ?? "",
    record.supervisor,
    record.employeeStatus ?? "",
    record.optIn ? "Sim" : "Não",
    record.amount.toFixed(2),
    record.observation ?? "",
    record.updatedBy ?? "",
    record.updatedAt
  ]);
  return {
    headers,
    rows,
    sheetName: "Adiantamento",
    fileName: `adiantamento_${result.referenceMonth}.xlsx`
  };
}

export async function createMonthlyAdvanceChangeRequest(actor: Actor, input: {
  referenceMonth: string;
  requestedOptIn: boolean;
  reason: string;
  observation?: string;
}) {
  const user = await findActiveUser(actor.email);
  if (!user) return { error: "Usuário ativo não encontrado.", status: 401 };
  const employee = await resolveEmployeeForUser(user);
  if (!employee) return { error: "Seu usuário não está vinculado a um cadastro de colaborador.", status: 400 };
  if (!isMonthlyAdvanceEligibleContract(employee.contractType)) return { error: MONTHLY_ADVANCE_PJ_ONLY_MESSAGE, status: 403 };
  if (isMonthlyAdvanceTrainingStatus(employee.operationalStatus)) return { error: MONTHLY_ADVANCE_TRAINING_BLOCK_MESSAGE, status: 403 };

  const referenceMonth = normalizeReferenceMonth(input.referenceMonth);
  if (!referenceMonth) return { error: "Mês de referência inválido.", status: 400 };
  if (!isMonthlyAdvanceReferenceMonthAvailable(referenceMonth)) return { error: MONTHLY_ADVANCE_ENDED_MESSAGE, status: 403 };
  if (isImplementationLockedMonth(referenceMonth)) {
    return { error: "Este ciclo já foi fechado e pago. Alterações para este mês não estão disponíveis.", status: 403 };
  }
  if (!isEmployeeMonthlyAdvanceCycleOpen(referenceMonth)) {
    return { error: "Este mês está disponível apenas como histórico. Solicitações de alteração só podem ser abertas para o mês atual ou o próximo mês.", status: 403 };
  }
  if (!input.reason.trim()) return { error: "Motivo é obrigatório.", status: 400 };

  const current = await prisma.monthlyAdvanceRecord.findUnique({
    where: { employeeId_referenceMonth: { employeeId: employee.id, referenceMonth } }
  });
  if (!current || current.status === "REMOVED") return { error: "Responda o adiantamento mensal diretamente antes de abrir solicitação de alteração.", status: 400 };

  const duplicate = await prisma.request.findFirst({
    where: {
      employeeId: employee.id,
      status: { in: ["ABERTO", "EM_ANALISE", "AGUARDANDO_APROVACAO", "AJUSTE_SOLICITADO"] },
      type: { name: "Alteração de Adiantamento" },
      payload: { path: ["referenceMonth"], equals: referenceMonth }
    },
    select: { code: true }
  });
  if (duplicate) return { error: `Já existe uma solicitação pendente para este ciclo (${duplicate.code}).`, status: 409 };

  const type = await prisma.requestType.findUnique({
    where: { name: "Alteração de Adiantamento" },
    select: { id: true, name: true }
  });
  if (!type) {
    return {
      error: "Tipo de solicitação Alteração de Adiantamento não está configurado. Rode o seed de produção antes de usar este fluxo.",
      status: 500
    };
  }

  const request = await prisma.$transaction(async (tx) => {
    const created = await tx.request.create({
      data: {
        code: await nextRequestCode(tx),
        title: `Alteração de Adiantamento - ${formatReferenceMonth(referenceMonth)}`,
        description: input.observation?.trim() || input.reason.trim(),
        requesterId: user.id,
        employeeId: employee.id,
        typeId: type.id,
        assignedArea: "WFM",
        priority: "MEDIA",
        status: "ABERTO",
        payload: {
          monthlyAdvanceChange: true,
          referenceMonth,
          currentOptIn: current.optIn,
          requestedOptIn: input.requestedOptIn,
          currentAmount: Number(current.amount),
          requestedAmount: monthlyAdvanceAmountForOptIn(input.requestedOptIn),
          reason: input.reason.trim(),
          observation: input.observation?.trim() || null
        },
        history: {
          create: {
            actorId: user.id,
            action: "Criação",
            to: "ABERTO",
            reason: "Solicitação de alteração de adiantamento"
          }
        },
        comments: {
          create: {
            authorId: user.id,
            message: input.reason.trim()
          }
        }
      },
      include: { type: true }
    });
    await tx.auditLog.create({
      data: {
        actorId: user.id,
        action: "CRIACAO",
        entity: "Request",
        entityId: created.id,
        reason: "Solicitação de alteração de adiantamento criada",
        newValue: { code: created.code, referenceMonth, requestedOptIn: input.requestedOptIn }
      }
    });
    return created;
  });

  void notifyWfmSafely(request.id, request.code, user.name, actor.email);

  return {
    data: {
      id: request.code,
      title: request.title,
      status: "Aberto",
      type: request.type.name
    }
  };
}

export async function applyApprovedMonthlyAdvanceChange(tx: Prisma.TransactionClient, request: {
  id: string;
  employeeId: string | null;
  payload: Prisma.JsonValue | null;
}, actorId: string) {
  const payload = (request.payload ?? {}) as Record<string, unknown>;
  if (!payload.monthlyAdvanceChange) return { updated: false, message: "" };
  if (!request.employeeId) throw new Error("Solicitação sem colaborador vinculado para alterar adiantamento.");
  const referenceMonth = normalizeReferenceMonth(payload.referenceMonth);
  if (!referenceMonth) throw new Error("Mês de referência inválido na solicitação de adiantamento.");
  if (!isMonthlyAdvanceReferenceMonthAvailable(referenceMonth)) {
    return { updated: false, message: MONTHLY_ADVANCE_ENDED_MESSAGE };
  }
  const requestedOptIn = parseAdvanceOptIn(payload.requestedOptIn);
  if (requestedOptIn === null) throw new Error("Aderência solicitada inválida na solicitação de adiantamento.");
  const employee = await tx.employeeProfile.findUnique({
    where: { id: request.employeeId },
    select: { contractType: true, operationalStatus: true }
  });
  if (!isMonthlyAdvanceEligibleContract(employee?.contractType)) {
    return { updated: false, message: MONTHLY_ADVANCE_PJ_ONLY_MESSAGE };
  }
  if (isMonthlyAdvanceTrainingStatus(employee?.operationalStatus)) {
    return { updated: false, message: MONTHLY_ADVANCE_TRAINING_BLOCK_MESSAGE };
  }
  const requestedAmount = monthlyAdvanceAmountForOptIn(requestedOptIn);
  const previous = await tx.monthlyAdvanceRecord.findUnique({
    where: { employeeId_referenceMonth: { employeeId: request.employeeId, referenceMonth } }
  });
  const record = await tx.monthlyAdvanceRecord.upsert({
    where: { employeeId_referenceMonth: { employeeId: request.employeeId, referenceMonth } },
    update: {
      optIn: requestedOptIn,
      amount: decimal(requestedAmount),
      hasDiscount: false,
      discountAmount: null,
      discountReason: null,
      finalAmount: decimal(requestedAmount),
      status: "ACTIVE",
      observation: String(payload.observation ?? payload.reason ?? "").trim() || null,
      updatedById: actorId
    },
    create: {
      employeeId: request.employeeId,
      referenceMonth,
      optIn: requestedOptIn,
      amount: decimal(requestedAmount),
      hasDiscount: false,
      discountAmount: null,
      discountReason: null,
      finalAmount: decimal(requestedAmount),
      status: "ACTIVE",
      observation: String(payload.observation ?? payload.reason ?? "").trim() || null,
      updatedById: actorId
    }
  });
  await tx.auditLog.create({
    data: {
      actorId,
      action: "APROVACAO",
      entity: "MonthlyAdvanceRecord",
      entityId: record.id,
      reason: "Solicitação de alteração de adiantamento aprovada",
      previousValue: previous ? { optIn: previous.optIn, amount: Number(previous.amount) } : undefined,
      newValue: { optIn: requestedOptIn, amount: requestedAmount, referenceMonth }
    }
  });
  return { updated: true, message: "Adiantamento mensal atualizado pela solicitação aprovada." };
}

export function isMonthlyAdvanceRequestPayload(payload: unknown) {
  return Boolean(payload && typeof payload === "object" && (payload as Record<string, unknown>).monthlyAdvanceChange);
}

function parseImportRow(
  raw: Record<string, unknown>,
  rowNumber: number,
  fallbackReferenceMonth: string,
  employeeByLogin: Map<string, AdvanceEmployee>
): MonthlyAdvanceImportRow {
  const normalizedRaw = normalizeObjectKeys(raw);
  const wbLoginRaw = normalizedRaw.wb_login ?? normalizedRaw.login ?? normalizedRaw.wblogin ?? "";
  const wbLogin = String(wbLoginRaw ?? "").trim();
  const normalizedLogin = normalizeWbLogin(wbLogin);
  const referenceMonth = normalizeReferenceMonth(normalizedRaw.mes_referencia ?? normalizedRaw.reference_month ?? normalizedRaw.mes ?? "", fallbackReferenceMonth);
  const optIn = parseAdvanceOptIn(normalizedRaw.aderente ?? normalizedRaw.opt_in ?? normalizedRaw.optin);
  const amount = optIn === null ? null : monthlyAdvanceAmountForOptIn(optIn);
  const observation = String(normalizedRaw.observacao ?? normalizedRaw.observation ?? "").trim();
  const employee = normalizedLogin ? employeeByLogin.get(normalizedLogin) : null;
  const errors: string[] = [];

  if (!normalizedLogin) errors.push("WB/Login é obrigatório.");
  else if (!employee) errors.push("WB/Login não encontrado.");
  else if (!isMonthlyAdvanceEligibleContract(employee.contractType)) errors.push(MONTHLY_ADVANCE_PJ_ONLY_MESSAGE);
  else if (isMonthlyAdvanceTrainingStatus(employee.operationalStatus)) errors.push(MONTHLY_ADVANCE_TRAINING_BLOCK_MESSAGE);
  if (!referenceMonth) errors.push("Mês de referência inválido.");
  else if (!isMonthlyAdvanceReferenceMonthAvailable(referenceMonth)) errors.push(MONTHLY_ADVANCE_ENDED_MESSAGE);
  if (optIn === null) errors.push("Aderente deve ser Sim ou Não.");

  return {
    rowNumber,
    wbLogin,
    referenceMonth,
    optIn,
    amount,
    observation,
    employeeId: employee?.id,
    employeeName: employee?.fullName,
    contractType: employee?.contractType ?? "",
    errors,
    warnings: []
  };
}

function importPreviewPayload(rows: MonthlyAdvanceImportRow[]) {
  return {
    totalRows: rows.length,
    validRows: rows.filter((row) => !row.errors.length).length,
    errorRows: rows.filter((row) => row.errors.length).length,
    createdRows: rows.filter((row) => !row.errors.length && row.action === "create").length,
    updatedRows: rows.filter((row) => !row.errors.length && row.action === "update").length,
    foundEmployees: rows.filter((row) => row.employeeId).length,
    missingEmployees: rows.filter((row) => row.errors.includes("WB/Login não encontrado.")).length,
    rows
  };
}

function mapMonthlyAdvanceRecord(record: Prisma.MonthlyAdvanceRecordGetPayload<{ include: typeof monthlyAdvanceInclude }>) {
  return {
    id: record.id,
    employeeId: record.employeeId,
    employeeName: record.employee.fullName,
    wbLogin: record.employee.wbLogin,
    email: record.employee.user?.email,
    lob: record.employee.lob?.name,
    supervisor: record.employee.supervisor?.fullName ?? "Sem supervisor",
    supervisorId: record.employee.supervisorId,
    employeeStatus: record.employee.operationalStatus,
    contractType: record.employee.contractType ?? "",
    referenceMonth: record.referenceMonth,
    monthLabel: formatReferenceMonth(record.referenceMonth),
    optIn: record.optIn,
    optInLabel: record.optIn ? "Sim" : "Não",
    amount: monthlyAdvanceAmountForOptIn(record.optIn),
    status: record.status,
    observation: record.observation,
    updatedBy: record.updatedBy?.name,
    updatedAt: formatDateTime(record.updatedAt),
    createdAt: formatDateTime(record.createdAt)
  };
}

const employeeInclude = {
  user: { select: { email: true } },
  lob: { select: { id: true, name: true } },
  supervisor: {
    select: {
      id: true,
      fullName: true,
      wbLogin: true,
      user: { select: { email: true } }
    }
  }
} satisfies Prisma.EmployeeProfileInclude;

const monthlyAdvanceInclude = {
  employee: { include: employeeInclude },
  updatedBy: { select: { id: true, name: true, email: true } }
} satisfies Prisma.MonthlyAdvanceRecordInclude;

async function findActiveUser(email: string) {
  return prisma.user.findFirst({
    where: { email, status: "ACTIVE" },
    include: { role: true, employeeProfile: true }
  });
}

async function resolveEmployeeForUser(user: ActiveUser) {
  if (user.employeeProfile && !user.employeeProfile.deletedAt) return user.employeeProfile;
  const byUserId = await prisma.employeeProfile.findFirst({ where: { userId: user.id, deletedAt: null } });
  if (byUserId) return byUserId;
  const byEmail = await prisma.employeeProfile.findFirst({
    where: { user: { email: { equals: user.email, mode: "insensitive" } }, deletedAt: null }
  });
  if (byEmail) return byEmail;
  const wbLoginCandidate = user.email.split("@")[0]?.trim();
  if (!wbLoginCandidate) return null;
  return prisma.employeeProfile.findFirst({ where: { wbLogin: { equals: wbLoginCandidate, mode: "insensitive" }, deletedAt: null } });
}

async function findEmployeeByWbLogin(wbLogin: string | undefined) {
  const normalized = normalizeWbLogin(wbLogin);
  if (!normalized) return null;
  const employees = await findEmployeesByNormalizedWbLogins([normalized]);
  return employees[0] ?? null;
}

function canViewMonthlyAdvance(role: string) {
  return ["ADMIN", "GESTOR", "WFM", "COLABORADOR"].includes(role);
}

function canManageMonthlyAdvance(role: string) {
  return ["ADMIN", "GESTOR", "WFM"].includes(role);
}

function canExportMonthlyAdvance(role: string) {
  return ["ADMIN", "GESTOR", "WFM"].includes(role);
}

function canDeleteMonthlyAdvance(role: string) {
  return ["ADMIN", "GESTOR", "WFM"].includes(role);
}

function monthlyAdvanceEligibleEmployeeWhere(): Prisma.EmployeeProfileWhereInput {
  return {
    AND: [
      {
        OR: [
          { contractType: { equals: "PJ", mode: "insensitive" } },
          { contractType: { equals: "Pessoa Jurídica", mode: "insensitive" } },
          { contractType: { equals: "Pessoa Juridica", mode: "insensitive" } },
          { contractType: { equals: "Pessoa Jurídico", mode: "insensitive" } },
          { contractType: { equals: "Pessoa Juridico", mode: "insensitive" } }
        ]
      },
      {
        NOT: {
          OR: monthlyAdvanceTrainingStatusValues.map((status) => ({
            operationalStatus: { equals: status, mode: "insensitive" as const }
          }))
        }
      }
    ]
  };
}

function isMonthlyAdvanceTrainingStatus(value?: string | null) {
  const status = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return ["emtreinamento", "treinamento", "training", "intraining"].includes(status);
}

function isMonthlyAdvanceEligibleContract(value?: string | null) {
  const contract = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return contract === "pj" || contract === "pessoajuridica" || contract === "pessoajuridico";
}

function formatMonthParts(year: number, month: number) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return "";
  return `${year}-${String(month).padStart(2, "0")}`;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function decimal(value: number) {
  return new Prisma.Decimal(roundMoney(value).toFixed(2));
}

function parsePositiveInteger(value: string | number | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function normalizeObjectKeys(raw: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [
      key
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase()
        .replace(/[\s/-]+/g, "_"),
      value
    ])
  );
}

function importRowWbLogin(raw: Record<string, unknown>) {
  const normalizedRaw = normalizeObjectKeys(raw);
  return normalizedRaw.wb_login ?? normalizedRaw.login ?? normalizedRaw.wblogin ?? "";
}

async function findEmployeesByNormalizedWbLogins(normalizedWbLogins: string[]) {
  if (!normalizedWbLogins.length) return [];
  const chunks = chunkArray(normalizedWbLogins, 500);
  const results = await Promise.all(
    chunks.map((chunk) =>
      prisma.employeeProfile.findMany({
        where: {
          deletedAt: null,
          OR: chunk.map((wbLogin) => ({ wbLogin: { equals: wbLogin, mode: "insensitive" as const } }))
        },
        include: employeeInclude
      })
    )
  );
  return Array.from(new Map(results.flat().map((employee) => [employee.id, employee])).values());
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

async function nextRequestCode(tx: Prisma.TransactionClient) {
  const count = await tx.request.count();
  return `REQ-${String(count + 1).padStart(4, "0")}`;
}

async function notifyWfmSafely(requestId: string, code: string, requesterName: string, actorEmail: string) {
  try {
    const wfms = await prisma.user.findMany({
      where: { status: "ACTIVE", role: { name: { in: ["WFM", "ADMIN", "GESTOR"] } } },
      select: { id: true }
    });
    if (!wfms.length) return;
    await prisma.notification.createMany({
      data: wfms.map((user) => ({
        userId: user.id,
        title: "Alteração de adiantamento aguardando análise",
        body: `${requesterName} abriu a solicitação ${code}.`,
        category: "Solicitações",
        type: "REQUEST",
        entity: "Request",
        entityId: requestId,
        href: `/esteiras?request=${code}`
      })),
      skipDuplicates: true
    });
  } catch (error) {
    recordErrorLog({
      userEmail: actorEmail,
      code: "MONTHLY_ADVANCE_NOTIFY_WFM_WARNING",
      message: error instanceof Error ? error.message : "Falha ao notificar WFM sobre adiantamento",
      route: "/api/monthly-advance/change-request",
      action: "MONTHLY_ADVANCE_NOTIFY",
      severity: "WARNING"
    });
  }
}

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: TIME_ZONE
  }).format(value);
}
