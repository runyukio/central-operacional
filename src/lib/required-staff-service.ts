import { type ScheduleStatus, Prisma } from "@prisma/client";

import { createPermissionError } from "@/lib/api-errors";
import type { Actor } from "@/lib/mock-db";
import { recordErrorLog } from "@/lib/mock-db";
import { normalizeComparableJobTitle } from "@/lib/job-title-normalization";
import { canAccessStaffCoverage } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { shiftCategoryName, shiftLookupKey } from "@/lib/shift-display";

const productiveShiftCategories = ["Manhã", "Tarde", "Noite"] as const;
const requiredLobs = ["ADS", "CEC", "TNS"] as const;
const coverageStatuses = new Set<ScheduleStatus>(["ESCALADO", "PRESENTE", "TROCA_APROVADA", "VENDA_FOLGA_APROVADA"]);
const unavailableEmployeeTokens = new Set([
  "afastado",
  "afastada",
  "desligado",
  "desligada",
  "desligado em treinamento",
  "desligada em treinamento",
  "inativo",
  "inativa",
  "desativado",
  "desativada",
  "inactive",
  "terminated",
  "suspended",
  "suspenso",
  "suspensa"
]);

type ProductiveShiftCategory = (typeof productiveShiftCategories)[number];
type RequiredLob = (typeof requiredLobs)[number];
type StaffRole = "SUPERVISOR" | "POC" | "RTA";
type RequiredStaffCoverageFilter = "Todos" | "Verde" | "Amarelo" | "Vermelho" | "Sem supervisor";

type ActiveUser = NonNullable<Awaited<ReturnType<typeof getUser>>>;

type StaffSchedule = Prisma.ScheduleGetPayload<{
  include: {
    shift: true;
    employee: {
      select: {
        id: true;
        fullName: true;
        wbLogin: true;
        roleTitle: true;
        skill: true;
        operationalStatus: true;
        terminationDate: true;
        lob: { select: { id: true; name: true } };
        shift: { select: { id: true; name: true; startsAt: true; endsAt: true } };
      };
    };
  };
}> & { coverageLobName: string };

export type RequiredStaffQuery = {
  startDate?: string;
  endDate?: string;
  lob?: string;
  shift?: string;
  supervisor?: string;
  includeRta?: boolean | string;
  coverageStatus?: string;
};

export type RequiredStaffPerson = {
  id: string;
  name: string;
  wbLogin: string;
  skill: string;
  lob: RequiredLob;
  role: StaffRole;
  shift: ProductiveShiftCategory;
  scheduleStatus: string;
};

type RequiredStaffPersonWithDate = RequiredStaffPerson & { date: string };

export type RequiredStaffLobCell = {
  lob: RequiredLob;
  status: "COMPLETE" | "PARTIAL_SUPERVISOR" | "PARTIAL_POC" | "NONE";
  label: string;
  supervisors: RequiredStaffPerson[];
  pocs: RequiredStaffPerson[];
  rtas: RequiredStaffPerson[];
};

export type RequiredStaffShiftRow = {
  date: string;
  dateLabel: string;
  weekday: string;
  isWeekend: boolean;
  shift: ProductiveShiftCategory;
  companySupervisors: RequiredStaffPerson[];
  supervisorStatus: "OK" | "CRITICAL";
  rtas: RequiredStaffPerson[];
  lobs: RequiredStaffLobCell[];
};

export type RequiredStaffCriticalRow = {
  date: string;
  dateLabel: string;
  weekday: string;
  shift: ProductiveShiftCategory;
  lob: RequiredLob | "Geral";
  severity: "Crítico" | "Alto" | "Médio" | "Baixo";
  problem: string;
  observation: string;
  score: number;
};

export async function listRequiredStaffCoverage(actor: Actor, query: RequiredStaffQuery = {}) {
  try {
    const user = await getUser(actor);
    if (!user) return createPermissionError("Usuário não encontrado ou inativo.");
    if (!canAccessStaffCoverage(permissionUser(user))) return createPermissionError("Você não tem permissão para visualizar Requerido.");

    const period = resolvePeriod(query);
    const schedules = await listStaffSchedules(period, query);
    const computed = buildStaffCoverage(period, schedules, query);
    return {
      ...computed,
      period: { startDate: formatDateKey(period.startDate), endDate: formatDateKey(period.endDate) }
    };
  } catch (error) {
    recordErrorLog({ userEmail: actor.email, code: "REQUIRED_STAFF_COVERAGE_ERROR", message: errorMessage(error), action: "REQUIRED_STAFF_COVERAGE", severity: "ERROR" });
    return { error: "Não foi possível carregar cobertura STAFF do Requerido.", message: "Não foi possível carregar cobertura STAFF do Requerido." };
  }
}

async function listStaffSchedules(period: { startDate: Date; endDate: Date }, query: RequiredStaffQuery) {
  const schedules = await prisma.schedule.findMany({
    where: {
      date: { gte: period.startDate, lte: period.endDate },
      deletedAt: null,
      employee: { deletedAt: null }
    },
    include: {
      shift: true,
      employee: {
        select: {
          id: true,
          fullName: true,
          wbLogin: true,
          roleTitle: true,
          skill: true,
          operationalStatus: true,
          terminationDate: true,
          lob: { select: { id: true, name: true } },
          shift: { select: { id: true, name: true, startsAt: true, endsAt: true } }
        }
      }
    }
  });

  const lobIds = Array.from(new Set(schedules.map((schedule) => schedule.lobId).filter(Boolean) as string[]));
  const lobs = lobIds.length ? await prisma.lob.findMany({ where: { id: { in: lobIds } }, select: { id: true, name: true } }) : [];
  const lobNameById = new Map(lobs.map((lob) => [lob.id, lob.name]));

  return schedules
    .map((schedule) => ({
      ...schedule,
      coverageLobName: schedule.lobId ? lobNameById.get(schedule.lobId) ?? schedule.employee.lob.name : schedule.employee.lob.name
    }))
    .filter((schedule) => scheduleMatchesStaffCoverage(schedule, query));
}

function scheduleMatchesStaffCoverage(schedule: StaffSchedule, query: RequiredStaffQuery) {
  const role = classifyStaffBySkill(schedule.employee.skill);
  const lob = canonicalLob(schedule.coverageLobName);
  if (!role) return false;
  if (role !== "RTA" && !lob) return false;
  if (!scheduleCountsAsStaffCoverage(schedule)) return false;
  if (!isEmployeeAvailable(schedule.employee.operationalStatus)) return false;
  if (schedule.employee.terminationDate && formatDateKey(schedule.date) >= formatDateKey(schedule.employee.terminationDate)) return false;

  const shift = scheduleShiftCategory(schedule);
  if (!shift) return false;

  const shiftFilter = normalizeProductiveShift(query.shift);
  if (shiftFilter && shift !== shiftFilter) return false;

  if (query.supervisor && query.supervisor !== "Todos") {
    const target = lookupKey(query.supervisor);
    if (lookupKey(schedule.employee.fullName) !== target && lookupKey(schedule.employee.wbLogin) !== target) return false;
  }

  return true;
}

function buildStaffCoverage(period: { startDate: Date; endDate: Date }, schedules: StaffSchedule[], query: RequiredStaffQuery) {
  const dates = datesInRange(period.startDate, period.endDate);
  const visibleLobs = visibleLobList(query.lob);
  const selectedShifts = visibleShiftList(query.shift);
  const includeRta = query.includeRta == null ? true : parseBoolean(query.includeRta);
  const people = schedules.map(formatStaffPerson).filter((person): person is RequiredStaffPersonWithDate => Boolean(person));
  const byKey = groupPeople(people);
  const rows: RequiredStaffShiftRow[] = [];

  for (const date of dates) {
    const dateKey = formatDateKey(date);
    const isWeekend = isWeekendDate(date);
    for (const shift of selectedShifts) {
      const companySupervisors = uniquePeople(requiredLobs.flatMap((lob) => byKey.get(personKey(dateKey, shift, lob, "SUPERVISOR")) ?? []));
      const shiftRtas = includeRta ? uniquePeople(requiredLobs.flatMap((lob) => byKey.get(personKey(dateKey, shift, lob, "RTA")) ?? [])) : [];
      rows.push({
        date: dateKey,
        dateLabel: formatDatePtBr(date),
        weekday: weekdayLabel(date),
        isWeekend,
        shift,
        companySupervisors,
        supervisorStatus: companySupervisors.length ? "OK" : "CRITICAL",
        rtas: shiftRtas,
        lobs: visibleLobs.map((lob) => buildLobCell(lob, dateKey, shift, byKey, includeRta))
      });
    }
  }

  const filteredRows = filterStaffRowsByCoverage(rows, query.coverageStatus);
  const summary = summarizeStaffRows(filteredRows);
  const critical = buildCriticalRows(filteredRows, includeRta);
  const staffOptions = ["Todos", ...Array.from(new Set(people.map((person) => person.name).filter(Boolean))).sort((a, b) => a.localeCompare(b, "pt-BR"))];

  return {
    summary,
    rows: filteredRows,
    critical,
    filters: {
      lobs: ["Todos", ...requiredLobs],
      shifts: ["Todos", ...productiveShiftCategories],
      staff: staffOptions,
      coverageStatuses: ["Todos", "Verde", "Amarelo", "Vermelho", "Sem supervisor"] satisfies RequiredStaffCoverageFilter[]
    }
  };
}

function filterStaffRowsByCoverage(rows: RequiredStaffShiftRow[], value?: string | null) {
  const filter = normalizeCoverageFilter(value);
  if (filter === "Todos") return rows;
  return rows
    .map((row) => ({
      ...row,
      lobs: row.lobs.filter((cell) => staffCellMatchesCoverageFilter(cell, filter))
    }))
    .filter((row) => row.lobs.length > 0);
}

function staffCellMatchesCoverageFilter(cell: RequiredStaffLobCell, filter: RequiredStaffCoverageFilter) {
  if (filter === "Verde") return cell.status === "COMPLETE";
  if (filter === "Amarelo") return cell.status === "PARTIAL_SUPERVISOR" || cell.status === "PARTIAL_POC";
  if (filter === "Vermelho") return cell.status === "NONE";
  if (filter === "Sem supervisor") return cell.supervisors.length === 0;
  return true;
}

function normalizeCoverageFilter(value?: string | null): RequiredStaffCoverageFilter {
  const key = lookupKey(value);
  if (key === "VERDE" || key === "GREEN" || key === "COM_SUPERVISOR") return "Verde";
  if (key === "AMARELO" || key === "YELLOW" || key === "PARCIAL" || key === "POC_RTA" || key === "POC_OU_RTA") return "Amarelo";
  if (key === "VERMELHO" || key === "RED" || key === "SEM_COBERTURA" || key === "SEM_NINGUEM") return "Vermelho";
  if (key === "SEM_SUPERVISOR" || key === "NO_SUPERVISOR") return "Sem supervisor";
  return "Todos";
}

function buildLobCell(lob: RequiredLob, date: string, shift: ProductiveShiftCategory, byKey: Map<string, RequiredStaffPerson[]>, includeRta: boolean): RequiredStaffLobCell {
  const supervisors = byKey.get(personKey(date, shift, lob, "SUPERVISOR")) ?? [];
  const pocs = byKey.get(personKey(date, shift, lob, "POC")) ?? [];
  const rtas = includeRta ? byKey.get(personKey(date, shift, lob, "RTA")) ?? [] : [];
  if (supervisors.length) {
    const complements = [pocs.length ? "POC" : null, rtas.length ? "RTA" : null].filter(Boolean);
    return {
      lob,
      status: "COMPLETE",
      label: complements.length ? `Supervisor + ${complements.join(" + ")}` : "Supervisor",
      supervisors,
      pocs,
      rtas
    };
  }
  if (pocs.length || rtas.length) {
    const coverage = [pocs.length ? "POC" : null, rtas.length ? "RTA" : null].filter(Boolean).join(" + ");
    return { lob, status: "PARTIAL_POC", label: coverage ? `Apenas ${coverage}` : "Cobertura parcial", supervisors, pocs, rtas };
  }
  return { lob, status: "NONE", label: includeRta ? "Sem Supervisor, POC ou RTA" : "Sem Supervisor e sem POC", supervisors, pocs, rtas };
}

function summarizeStaffRows(rows: RequiredStaffShiftRow[]) {
  const lobScores = new Map<RequiredLob, number>();
  for (const row of rows) {
    for (const cell of row.lobs) {
      lobScores.set(cell.lob, (lobScores.get(cell.lob) ?? 0) + (cell.status === "NONE" ? 3 : cell.status === "COMPLETE" ? 0 : 1));
    }
  }
  const mostCriticalLob = Array.from(lobScores.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "-";
  const noSupervisorRows = rows.filter((row) => !row.companySupervisors.length);
  const criticalDay = noSupervisorRows[0]?.dateLabel ?? rows.find((row) => row.lobs.some((cell) => cell.status === "NONE"))?.dateLabel ?? "-";

  return {
    shiftsWithSupervisor: rows.filter((row) => row.companySupervisors.length).length,
    shiftsWithoutSupervisor: noSupervisorRows.length,
    completeCoverage: rows.reduce((sum, row) => sum + row.lobs.filter((cell) => cell.status === "COMPLETE").length, 0),
    partialCoverage: rows.reduce((sum, row) => sum + row.lobs.filter((cell) => cell.status === "PARTIAL_SUPERVISOR" || cell.status === "PARTIAL_POC").length, 0),
    noCoverage: rows.reduce((sum, row) => sum + row.lobs.filter((cell) => cell.status === "NONE").length, 0),
    mostCriticalLob,
    criticalDay,
    weekendRisk: noSupervisorRows.filter((row) => row.isWeekend).length
  };
}

function buildCriticalRows(rows: RequiredStaffShiftRow[], includeRta: boolean): RequiredStaffCriticalRow[] {
  const critical: RequiredStaffCriticalRow[] = [];
  for (const row of rows) {
    if (!row.companySupervisors.length) {
      critical.push({
        date: row.date,
        dateLabel: row.dateLabel,
        weekday: row.weekday,
        shift: row.shift,
        lob: "Geral",
        severity: "Crítico",
        problem: "Nenhum Supervisor na empresa",
        observation: row.isWeekend ? "Final de semana sem supervisor no turno" : "POC e RTA não substituem a regra mínima de Supervisor.",
        score: row.isWeekend ? 140 : 100
      });
    }

    for (const cell of row.lobs) {
      if (cell.status === "NONE") {
        critical.push({
          date: row.date,
          dateLabel: row.dateLabel,
          weekday: row.weekday,
          shift: row.shift,
          lob: cell.lob,
          severity: row.isWeekend || !row.companySupervisors.length ? "Alto" : "Alto",
          problem: includeRta ? "Sem Supervisor, POC ou RTA" : "Sem Supervisor e sem POC",
          observation: row.isWeekend ? "Falha de cobertura em final de semana." : "Não há cobertura para a LOB.",
          score: 70 + (row.isWeekend ? 15 : 0) + (!row.companySupervisors.length ? 20 : 0)
        });
      } else if (cell.status === "PARTIAL_SUPERVISOR" || cell.status === "PARTIAL_POC") {
        critical.push({
          date: row.date,
          dateLabel: row.dateLabel,
          weekday: row.weekday,
          shift: row.shift,
          lob: cell.lob,
          severity: "Médio",
          problem: cell.label,
          observation: includeRta ? "Cobertura parcial: ha POC ou RTA, mas sem Supervisor da LOB." : "Cobertura parcial: ha POC, mas sem Supervisor da LOB.",
          score: 35 + (row.isWeekend ? 10 : 0)
        });
      }
    }
  }
  return critical.sort((a, b) => b.score - a.score || `${a.date}|${a.shift}|${a.lob}`.localeCompare(`${b.date}|${b.shift}|${b.lob}`)).slice(0, 10);
}

function groupPeople(people: RequiredStaffPersonWithDate[]) {
  const map = new Map<string, RequiredStaffPerson[]>();
  for (const person of people) {
    const lobs = person.role === "RTA" ? requiredLobs : [person.lob];
    for (const lob of lobs) {
      const key = personKey(person.date, person.shift, lob, person.role);
      const current = map.get(key) ?? [];
      current.push({ ...person, lob });
      map.set(key, uniquePeople(current));
    }
  }
  return map;
}

function personKey(date: string, shift: ProductiveShiftCategory, lob: RequiredLob, role: StaffRole) {
  return `${date}|${shift}|${lob}|${role}`;
}

function formatStaffPerson(schedule: StaffSchedule): RequiredStaffPersonWithDate | null {
  const role = classifyStaffBySkill(schedule.employee.skill);
  const lob = canonicalLob(schedule.coverageLobName);
  const shift = scheduleShiftCategory(schedule);
  if (!role || !shift) return null;
  if (role !== "RTA" && !lob) return null;
  return {
    id: schedule.employee.id,
    name: schedule.employee.fullName,
    wbLogin: schedule.employee.wbLogin,
    skill: schedule.employee.skill ?? "",
    lob: lob ?? "ADS",
    role,
    shift,
    date: formatDateKey(schedule.date),
    scheduleStatus: statusLabel(schedule.status)
  };
}

function scheduleCountsAsStaffCoverage(schedule: StaffSchedule) {
  if (coverageStatuses.has(schedule.status)) return true;
  return schedule.status === "NESTING" && isVideoOrCommentsSchedule(schedule);
}

function isVideoOrCommentsSchedule(schedule: StaffSchedule) {
  const key = lookupKey([
    schedule.employee.skill,
    schedule.coverageLobName,
    schedule.employee.lob.name
  ].filter(Boolean).join(" "));
  return key.includes("VIDEO") || key.includes("COMMENT") || key.includes("TNS");
}

function classifyStaffBySkill(skill?: string | null): StaffRole | null {
  const key = lookupKey(skill);
  if (!key) return null;
  if (key === "POC" || key.includes("POC") || key.includes("POINT_OF_CONTACT") || key.includes("PONTO_FOCAL")) return "POC";
  if (key === "RTA" || key.includes("RTA") || key.includes("REAL_TIME")) return "RTA";
  if (
    key === "SUP" ||
    key === "TL" ||
    key.includes("SUPERVISOR") ||
    key.includes("SUPERVISAO") ||
    key.includes("TEAM_LEADER") ||
    key.includes("TEAMLEADER") ||
    key.includes("LEADER") ||
    key.includes("LIDER") ||
    key.includes("LIDERANCA")
  ) return "SUPERVISOR";
  return null;
}

function scheduleShiftCategory(schedule: StaffSchedule): ProductiveShiftCategory | null {
  const named = normalizeProductiveShift(schedule.shift?.name ?? schedule.employee.shift?.name);
  if (named) return named;
  const start = schedule.startsAt ?? schedule.shift?.startsAt ?? schedule.employee.shift?.startsAt;
  const minutes = minutesFromTime(start);
  if (minutes === null) return null;
  if (minutes >= 23 * 60 || minutes < 8 * 60) return "Noite";
  if (minutes >= 14 * 60) return "Tarde";
  return "Manhã";
}

function visibleLobList(value?: string | null): RequiredLob[] {
  const lob = canonicalLob(value);
  return lob ? [lob] : [...requiredLobs];
}

function visibleShiftList(value?: string | null): ProductiveShiftCategory[] {
  const shift = normalizeProductiveShift(value);
  return shift ? [shift] : [...productiveShiftCategories];
}

function canonicalLob(value?: unknown): RequiredLob | null {
  const key = lookupKey(value);
  if (key === "ADS" || key.includes("ADS")) return "ADS";
  if (key === "CEC" || key.includes("CEC")) return "CEC";
  if (key === "TNS" || key.includes("TNS") || key.includes("VIDEO") || key.includes("COMMENTS") || key.includes("COMMENT")) return "TNS";
  return null;
}

function uniquePeople<T extends RequiredStaffPerson>(items: T[]) {
  const map = new Map<string, T>();
  for (const item of items) {
    const key = item.id || item.wbLogin || item.name;
    if (!map.has(key)) map.set(key, item);
  }
  return Array.from(map.values());
}

function parseBoolean(value?: boolean | string) {
  if (typeof value === "boolean") return value;
  return ["1", "true", "sim", "yes"].includes(String(value ?? "").toLowerCase());
}

function normalizeProductiveShift(value?: unknown): ProductiveShiftCategory | null {
  const category = shiftCategoryName(String(value ?? ""));
  return productiveShiftCategories.includes(category as ProductiveShiftCategory) ? category as ProductiveShiftCategory : null;
}

function datesInRange(startDate: Date, endDate: Date) {
  const dates: Date[] = [];
  const current = new Date(startDate);
  while (current <= endDate) {
    dates.push(new Date(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

function resolvePeriod(query: RequiredStaffQuery) {
  const today = new Date();
  const startDate = parseDate(query.startDate) ?? new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const endDate = parseDate(query.endDate) ?? new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
  return startDate <= endDate ? { startDate, endDate } : { startDate: endDate, endDate: startDate };
}

function parseDate(value?: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return new Date(`${value}T00:00:00.000Z`);
}

function formatDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatDatePtBr(date: Date) {
  const [year, month, day] = formatDateKey(date).split("-");
  return `${day}/${month}/${year}`;
}

function weekdayLabel(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" }).format(date).replace(".", "");
}

function isWeekendDate(date: Date) {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

function minutesFromTime(value?: string | null) {
  const match = String(value ?? "").trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function statusLabel(status: ScheduleStatus) {
  return status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function isEmployeeAvailable(status?: string | null) {
  return !unavailableEmployeeTokens.has(normalizeComparableJobTitle(status));
}

function lookupKey(value: unknown) {
  return shiftLookupKey(String(value ?? ""));
}

function permissionUser(user: ActiveUser) {
  return { role: user.role.name, email: user.email, name: user.name, status: user.status };
}

async function getUser(actor: Actor) {
  if (!actor.email) return null;
  return prisma.user.findUnique({ where: { email: actor.email }, include: { role: true, employeeProfile: true } });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
