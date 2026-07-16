import { AuditAction } from "@prisma/client";

import { createPermissionError } from "@/lib/api-errors";
import { normalizeExcelDate, normalizeExcelTime } from "@/lib/excel-normalization";
import type { Actor } from "@/lib/mock-db";
import { recordErrorLog } from "@/lib/mock-db";
import { canAccessStaffCoverage, canManageStaffCoverageRequirements } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { countAdsScheduledByHour, listAdsScheduledAgentsAtHour } from "@/lib/staff-coverage-service";

export type AdsHourlyCoverageQuery = {
  startDate?: string;
  endDate?: string;
};

type ParsedRequirement = {
  date: Date;
  dateKey: string;
  hour: number;
  requiredStaff: number;
};

export async function listAdsHourlyCoverage(actor: Actor, query: AdsHourlyCoverageQuery = {}) {
  try {
    const user = await getUser(actor);
    if (!user) return createPermissionError("Usuário não encontrado ou inativo.");
    if (!canAccessStaffCoverage(permissionUser(user))) return createPermissionError("Você não tem permissão para visualizar Necessidade.");

    const period = resolvePeriod(query);
    const requirements = await prisma.adsHourlyRequirement.findMany({
      where: { date: { gte: period.startDate, lte: period.endDate } },
      orderBy: [{ date: "asc" }, { hour: "asc" }]
    });
    const slots = requirements.map((row) => ({ date: formatDateKey(row.date), hour: row.hour }));
    const scheduledBySlot = await countAdsScheduledByHour(period, slots);
    const data = requirements.map((row) => {
      const date = formatDateKey(row.date);
      const scheduled = scheduledBySlot.get(`${date}|${row.hour}`) ?? 0;
      const gap = scheduled - row.requiredStaff;
      return {
        id: row.id,
        date,
        dateLabel: formatDatePtBr(row.date),
        weekday: weekdayLabel(row.date),
        hour: row.hour,
        hourLabel: `${String(row.hour).padStart(2, "0")}:00`,
        required: row.requiredStaff,
        scheduled,
        gap,
        status: coverageStatus(row.requiredStaff, scheduled)
      };
    });

    return {
      data,
      period: { startDate: formatDateKey(period.startDate), endDate: formatDateKey(period.endDate) },
      summary: {
        slots: data.length,
        days: new Set(data.map((row) => row.date)).size
      },
      permissions: { canImport: canManageStaffCoverageRequirements(permissionUser(user)) }
    };
  } catch (error) {
    recordErrorLog({
      userEmail: actor.email,
      code: "ADS_HOURLY_COVERAGE_LIST_ERROR",
      message: errorMessage(error),
      action: "ADS_HOURLY_COVERAGE_LIST",
      severity: "ERROR"
    });
    return { error: "Não foi possível carregar a necessidade ADS por hora.", message: "Não foi possível carregar a necessidade ADS por hora.", status: 500 };
  }
}

export async function getAdsHourlyCoverageDetails(actor: Actor, query: { date?: string; hour?: string }) {
  try {
    const user = await getUser(actor);
    if (!user) return createPermissionError("Usuário não encontrado ou inativo.");
    if (!canAccessStaffCoverage(permissionUser(user))) return createPermissionError("Você não tem permissão para visualizar Necessidade.");

    const date = normalizeExcelDate(query.date);
    const hour = Number(query.hour);
    if (!date || !Number.isInteger(hour) || hour < 0 || hour > 23) {
      return { error: "Informe uma data e hora válidas.", message: "Informe uma data e hora válidas.", status: 400 };
    }

    const requirement = await prisma.adsHourlyRequirement.findUnique({
      where: { date_hour: { date, hour } }
    });
    if (!requirement) {
      return { error: "Necessidade ADS não encontrada para este horário.", message: "Necessidade ADS não encontrada para este horário.", status: 404 };
    }

    const agents = await listAdsScheduledAgentsAtHour(date, hour);
    const scheduled = agents.length;
    const gap = scheduled - requirement.requiredStaff;
    return {
      summary: {
        date: formatDateKey(date),
        dateLabel: formatDatePtBr(date),
        hour,
        hourLabel: `${String(hour).padStart(2, "0")}:00`,
        lob: "ADS",
        required: requirement.requiredStaff,
        scheduled,
        gap,
        status: coverageStatus(requirement.requiredStaff, scheduled)
      },
      data: agents
    };
  } catch (error) {
    recordErrorLog({
      userEmail: actor.email,
      code: "ADS_HOURLY_COVERAGE_DETAILS_ERROR",
      message: errorMessage(error),
      action: "ADS_HOURLY_COVERAGE_DETAILS",
      severity: "ERROR"
    });
    return { error: "Não foi possível carregar os agentes ADS deste horário.", message: "Não foi possível carregar os agentes ADS deste horário.", status: 500 };
  }
}

export async function importAdsHourlyRequirements(
  actor: Actor,
  rows: Array<Record<string, unknown>>,
  fileName?: string
) {
  try {
    const user = await getUser(actor);
    if (!user) return { error: "Usuário não encontrado ou inativo.", message: "Usuário não encontrado ou inativo.", status: 403 };
    if (!canManageStaffCoverageRequirements(permissionUser(user))) {
      return { error: "Apenas WFM ou ADMIN podem importar a necessidade ADS.", message: "Apenas WFM ou ADMIN podem importar a necessidade ADS.", status: 403 };
    }
    if (!rows.length) return { error: "A planilha está vazia.", message: "A planilha está vazia.", status: 400 };
    if (rows.length > 10_000) return { error: "A planilha excede 10.000 linhas.", message: "A planilha excede 10.000 linhas.", status: 400 };

    const parsed: ParsedRequirement[] = [];
    const errors: Array<{ rowNumber: number; message: string }> = [];
    const seen = new Set<string>();

    rows.forEach((rawRow, index) => {
      const rowNumber = index + 2;
      const row = normalizeRow(rawRow);
      const date = normalizeExcelDate(row.data);
      const time = normalizeExcelTime(row.hora);
      const required = parseRequired(row.required);
      if (!date) errors.push({ rowNumber, message: "Data inválida." });
      if (!time || !/^\d{2}:00$/.test(time)) errors.push({ rowNumber, message: "Hora inválida. Use blocos fechados, como 08:00 ou 17:00." });
      if (required === null) errors.push({ rowNumber, message: "Required inválido. Use um número maior ou igual a zero." });
      if (!date || !time || required === null || !/^\d{2}:00$/.test(time)) return;

      const dateKey = formatDateKey(date);
      const hour = Number(time.slice(0, 2));
      const key = `${dateKey}|${hour}`;
      if (seen.has(key)) {
        errors.push({ rowNumber, message: "Data e hora duplicadas no arquivo." });
        return;
      }
      seen.add(key);
      parsed.push({ date, dateKey, hour, requiredStaff: required });
    });

    if (errors.length) {
      return {
        error: `A planilha possui ${errors.length} erro(s).`,
        message: `A planilha possui ${errors.length} erro(s). Revise as linhas informadas.`,
        errors: errors.slice(0, 30),
        status: 400
      };
    }
    if (!parsed.length) return { error: "Não há linhas válidas para importar.", message: "Não há linhas válidas para importar.", status: 400 };

    parsed.sort((a, b) => a.date.getTime() - b.date.getTime() || a.hour - b.hour);
    const startDate = parsed[0].date;
    const endDate = parsed[parsed.length - 1].date;
    const now = new Date();
    await prisma.$transaction([
      prisma.adsHourlyRequirement.deleteMany({ where: { date: { gte: startDate, lte: endDate } } }),
      prisma.adsHourlyRequirement.createMany({
        data: parsed.map((row) => ({
          date: row.date,
          hour: row.hour,
          requiredStaff: row.requiredStaff,
          sourceFileName: fileName?.trim() || null,
          createdAt: now,
          updatedAt: now
        }))
      })
    ]);

    await prisma.auditLog.create({
      data: {
        actorId: user.id,
        action: AuditAction.IMPORTACAO,
        entity: "AdsHourlyRequirement",
        entityId: `ads-hourly-${Date.now()}`,
        reason: "Importação da necessidade ADS por hora",
        newValue: {
          fileName: fileName ?? null,
          rows: parsed.length,
          startDate: formatDateKey(startDate),
          endDate: formatDateKey(endDate)
        }
      }
    });

    return {
      success: true,
      importedRows: parsed.length,
      period: { startDate: formatDateKey(startDate), endDate: formatDateKey(endDate) }
    };
  } catch (error) {
    recordErrorLog({
      userEmail: actor.email,
      code: "ADS_HOURLY_REQUIREMENT_IMPORT_ERROR",
      message: errorMessage(error),
      action: "ADS_HOURLY_REQUIREMENT_IMPORT",
      severity: "ERROR"
    });
    const migrationMissing = /AdsHourlyRequirement|does not exist|P2021/i.test(errorMessage(error));
    const message = migrationMissing
      ? "A migration da necessidade ADS ainda não foi aplicada no banco online. Rode npm run db:deploy e tente novamente."
      : "Não foi possível importar a necessidade ADS por hora.";
    return { error: message, message, status: 500 };
  }
}

function normalizeRow(row: Record<string, unknown>) {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const header = normalizeHeader(key);
    if (["data", "date", "dia"].includes(header)) normalized.data = value;
    else if (["hora", "hour", "horario"].includes(header)) normalized.hora = value;
    else if (["required", "requerido", "necessidade", "required_staff"].includes(header)) normalized.required = value;
  }
  return normalized;
}

function parseRequired(value: unknown) {
  const raw = typeof value === "number" ? value : Number(String(value ?? "").trim().replace(",", "."));
  if (!Number.isFinite(raw) || raw < 0) return null;
  return Math.round(raw);
}

function coverageStatus(required: number, scheduled: number) {
  if (required === 0 && scheduled > 0) return "Sem necessidade";
  if (required > 0 && scheduled === 0) return "Sem cobertura";
  const gap = scheduled - required;
  if (gap < 0) return "Déficit";
  if (gap === 0) return "OK";
  return "Sobra";
}

function resolvePeriod(query: AdsHourlyCoverageQuery) {
  const today = new Date();
  const startDate = normalizeExcelDate(query.startDate) ?? new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const endDate = normalizeExcelDate(query.endDate) ?? startDate;
  return startDate <= endDate ? { startDate, endDate } : { startDate: endDate, endDate: startDate };
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

function normalizeHeader(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function permissionUser(user: NonNullable<Awaited<ReturnType<typeof getUser>>>) {
  return { role: user.role.name, email: user.email, name: user.name, status: user.status };
}

async function getUser(actor: Actor) {
  if (!actor.email) return null;
  return prisma.user.findUnique({ where: { email: actor.email }, include: { role: true } });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
