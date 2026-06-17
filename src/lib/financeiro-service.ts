import { AuditAction, Prisma } from "@prisma/client";

import type { Actor } from "@/lib/mock-db";
import { canAccessFinanceiro } from "@/lib/financeiro-permissions";
import { currentReferenceMonth, formatReferenceMonth, normalizeReferenceMonth } from "@/lib/monthly-advance-service";
import { prisma } from "@/lib/prisma";
import type { XlsxExportPayload } from "@/lib/xlsx-export";

type FinanceiroUser = NonNullable<Awaited<ReturnType<typeof findFinanceiroUser>>>;

export type FinanceiroFilters = {
  invoiceCycleMonth?: string | null;
  costCenter?: string | null;
  source?: string | null;
  search?: string | null;
};

export type FinanceiroPreviewRow = {
  rowNumber: number;
  invoiceCycleMonth: string;
  costCenter: string;
  maxHoursCapacityMinutes: number;
  billableHoursTargetMinutes: number;
  billableHoursActualMinutes: number;
  adherencePercent: number;
  differenceMinutes: number;
  penaltyPercent: number;
  notes: string;
  source: string;
  action: "create" | "update" | "ignore";
  errors: string[];
  warnings: string[];
};

const FINANCEIRO_DEFAULT_SOURCE = "Upload histórico";
const FINANCEIRO_ADJUSTMENT_FIELDS = new Map<string, { label: string; type: "hours" | "percent" | "text" }>([
  ["maxHoursCapacityMinutes", { label: "Max Hours (Capacity)", type: "hours" }],
  ["billableHoursTargetMinutes", { label: "Billable Hours (Meta)", type: "hours" }],
  ["billableHoursActualMinutes", { label: "Billable Hours (Real)", type: "hours" }],
  ["adherencePercent", { label: "Aderence %", type: "percent" }],
  ["differenceMinutes", { label: "Difference", type: "hours" }],
  ["penaltyPercent", { label: "Penalty %", type: "percent" }],
  ["notes", { label: "Notes", type: "text" }],
  ["source", { label: "Source", type: "text" }]
] as const);

export async function getFinanceiroDashboard(actor: Actor, filters: FinanceiroFilters = {}) {
  const user = await requireFinanceiroUser(actor);
  if ("error" in user) return user;
  const where = buildFinanceiroWhere(filters);
  const [records, costCenters, sources, uploads] = await Promise.all([
    prisma.financeInvoiceCycleRecord.findMany({
      where,
      include: {
        createdBy: { select: { name: true, email: true } },
        updatedBy: { select: { name: true, email: true } },
        adjustments: { orderBy: { createdAt: "desc" }, include: { createdBy: { select: { name: true, email: true } } } }
      },
      orderBy: [{ invoiceCycleMonth: "desc" }, { costCenter: "asc" }]
    }),
    prisma.financeInvoiceCycleRecord.findMany({
      distinct: ["costCenter"],
      select: { costCenter: true },
      orderBy: { costCenter: "asc" }
    }),
    prisma.financeInvoiceCycleRecord.findMany({
      distinct: ["source"],
      where: { source: { not: null } },
      select: { source: true },
      orderBy: { source: "asc" }
    }),
    prisma.financeUploadBatch.findMany({
      orderBy: { uploadedAt: "desc" },
      take: 8,
      include: { uploadedBy: { select: { name: true, email: true } } }
    })
  ]);

  return {
    data: {
      filters: {
        invoiceCycleMonth: normalizeFinanceiroMonth(filters.invoiceCycleMonth) || currentReferenceMonth(),
        costCenter: filters.costCenter || "Todos",
        source: filters.source || "Todos",
        search: filters.search || ""
      },
      filterOptions: {
        costCenters: ["Todos", ...costCenters.map((item) => item.costCenter).filter(Boolean)],
        sources: ["Todos", ...sources.map((item) => item.source ?? "").filter(Boolean)]
      },
      summary: buildFinanceiroSummary(records),
      records: records.map(mapFinanceiroRecord),
      uploads: uploads.map(mapFinanceiroUpload),
      canManage: true,
      canExport: true,
      allowedEmails: ["wb_fernanda20@kuaishou.com", "runyukio@gmail.com"]
    }
  };
}

export async function previewFinanceiroImport(actor: Actor, rawRows: Array<Record<string, unknown>>, fileName = "financeiro.xlsx") {
  const user = await requireFinanceiroUser(actor);
  if ("error" in user) return user;
  const normalizedRows = rawRows.map(normalizeObjectKeys);
  const seen = new Map<string, number>();
  const parsedRows = normalizedRows.map((row, index) => parseFinanceiroImportRow(row, index + 2, seen));
  const keys = parsedRows.filter((row) => row.invoiceCycleMonth && row.costCenter && !row.errors.length);
  const existing = keys.length
    ? await prisma.financeInvoiceCycleRecord.findMany({
      where: { OR: keys.map((row) => ({ invoiceCycleMonth: row.invoiceCycleMonth, costCenter: row.costCenter })) },
      select: { invoiceCycleMonth: true, costCenter: true }
    })
    : [];
  const existingKeys = new Set(existing.map((row) => financeRecordKey(row.invoiceCycleMonth, row.costCenter)));
  const rows = parsedRows.map((row) => ({
    ...row,
    action: row.errors.length ? "ignore" as const : existingKeys.has(financeRecordKey(row.invoiceCycleMonth, row.costCenter)) ? "update" as const : "create" as const
  }));
  return buildFinanceiroPreview(rows, fileName);
}

export async function commitFinanceiroImport(actor: Actor, rows: FinanceiroPreviewRow[], fileName = "financeiro.xlsx") {
  const user = await requireFinanceiroUser(actor);
  if ("error" in user) return user;
  const validRows = rows.filter((row) => !row.errors.length && row.action !== "ignore");
  if (!validRows.length) return { error: "Nenhuma linha válida para importar Financeiro.", status: 400 };
  const rowsInserted = validRows.filter((row) => row.action === "create").length;
  const rowsUpdated = validRows.filter((row) => row.action === "update").length;
  const batch = await prisma.financeUploadBatch.create({
    data: {
      fileName,
      rowsTotal: rows.length,
      rowsValid: validRows.length,
      rowsError: rows.length - validRows.length,
      rowsInserted,
      rowsUpdated,
      uploadedById: user.id,
      status: rows.some((row) => row.errors.length) ? "PARTIAL_SUCCESS" : "SUCCESS",
      errorSummary: rows.filter((row) => row.errors.length).slice(0, 50).map((row) => ({ rowNumber: row.rowNumber, errors: row.errors }))
    }
  });

  for (const chunk of chunks(validRows, 100)) {
    await prisma.$transaction(chunk.map((row) => prisma.financeInvoiceCycleRecord.upsert({
      where: { invoiceCycleMonth_costCenter: { invoiceCycleMonth: row.invoiceCycleMonth, costCenter: row.costCenter } },
      update: {
        maxHoursCapacityMinutes: row.maxHoursCapacityMinutes,
        billableHoursTargetMinutes: row.billableHoursTargetMinutes,
        billableHoursActualMinutes: row.billableHoursActualMinutes,
        adherencePercent: decimal(row.adherencePercent),
        differenceMinutes: row.differenceMinutes,
        penaltyPercent: decimal(row.penaltyPercent),
        notes: row.notes || null,
        source: row.source || FINANCEIRO_DEFAULT_SOURCE,
        uploadBatchId: batch.id,
        updatedById: user.id
      },
      create: {
        invoiceCycleMonth: row.invoiceCycleMonth,
        costCenter: row.costCenter,
        maxHoursCapacityMinutes: row.maxHoursCapacityMinutes,
        billableHoursTargetMinutes: row.billableHoursTargetMinutes,
        billableHoursActualMinutes: row.billableHoursActualMinutes,
        adherencePercent: decimal(row.adherencePercent),
        differenceMinutes: row.differenceMinutes,
        penaltyPercent: decimal(row.penaltyPercent),
        notes: row.notes || null,
        source: row.source || FINANCEIRO_DEFAULT_SOURCE,
        uploadBatchId: batch.id,
        createdById: user.id,
        updatedById: user.id
      }
    })));
  }

  await auditFinanceiro(user.id, "FinanceUploadBatch", batch.id, "FINANCEIRO_IMPORT_COMMITTED", {
    fileName,
    rowsTotal: rows.length,
    rowsValid: validRows.length,
    rowsInserted,
    rowsUpdated
  }, AuditAction.IMPORTACAO);

  return { data: { batchId: batch.id, rowsTotal: rows.length, rowsValid: validRows.length, rowsInserted, rowsUpdated } };
}

export async function createFinanceiroAdjustment(actor: Actor, input: {
  recordId?: string | null;
  fieldName?: string | null;
  newValue?: string | number | null;
  adjustmentType?: string | null;
  description?: string | null;
}) {
  const user = await requireFinanceiroUser(actor);
  if ("error" in user) return user;
  const recordId = input.recordId?.trim();
  if (!recordId) return { error: "Registro financeiro é obrigatório.", status: 400 };
  const fieldName = input.fieldName?.trim() ?? "";
  const field = FINANCEIRO_ADJUSTMENT_FIELDS.get(fieldName);
  if (!field) return { error: "Campo de ajuste inválido.", status: 400 };
  const adjustmentType = input.adjustmentType?.trim() || "Correção";
  const description = input.description?.trim();
  if (!description) return { error: "Descrição do ajuste é obrigatória.", status: 400 };
  const record = await prisma.financeInvoiceCycleRecord.findUnique({ where: { id: recordId } });
  if (!record) return { error: "Registro financeiro não encontrado.", status: 404 };

  const parsed = parseAdjustmentValue(field.type, input.newValue);
  if (!parsed.valid) return { error: parsed.error ?? "Valor novo inválido.", status: 400 };
  const previousValue = financeFieldDisplay(record, fieldName);
  const data: Prisma.FinanceInvoiceCycleRecordUpdateInput = { updatedBy: { connect: { id: user.id } } };

  if (fieldName === "maxHoursCapacityMinutes") data.maxHoursCapacityMinutes = parsed.value as number;
  if (fieldName === "billableHoursTargetMinutes") data.billableHoursTargetMinutes = parsed.value as number;
  if (fieldName === "billableHoursActualMinutes") data.billableHoursActualMinutes = parsed.value as number;
  if (fieldName === "adherencePercent") data.adherencePercent = decimal(parsed.value as number);
  if (fieldName === "differenceMinutes") data.differenceMinutes = parsed.value as number;
  if (fieldName === "penaltyPercent") data.penaltyPercent = decimal(parsed.value as number);
  if (fieldName === "notes") data.notes = String(parsed.value ?? "").trim() || null;
  if (fieldName === "source") data.source = String(parsed.value ?? "").trim() || null;

  const nextTarget = fieldName === "billableHoursTargetMinutes" ? parsed.value as number : record.billableHoursTargetMinutes;
  const nextActual = fieldName === "billableHoursActualMinutes" ? parsed.value as number : record.billableHoursActualMinutes;
  if (fieldName === "billableHoursTargetMinutes" || fieldName === "billableHoursActualMinutes") {
    data.adherencePercent = decimal(calculateAdherence(nextActual, nextTarget));
    data.differenceMinutes = nextActual - nextTarget;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.financeInvoiceCycleRecord.update({ where: { id: record.id }, data });
    await tx.financeAdjustment.create({
      data: {
        recordId: record.id,
        fieldName,
        oldValue: previousValue,
        newValue: financeFieldDisplay(saved, fieldName),
        adjustmentType,
        description,
        createdById: user.id
      }
    });
    await tx.auditLog.create({
      data: {
        actorId: user.id,
        action: AuditAction.EDICAO,
        entity: "FinanceInvoiceCycleRecord",
        entityId: record.id,
        reason: "FINANCEIRO_MANUAL_ADJUSTMENT",
        previousValue: { fieldName, value: previousValue },
        newValue: { fieldName, value: financeFieldDisplay(saved, fieldName), adjustmentType, description }
      }
    });
    return saved;
  });

  return { data: mapFinanceiroRecord({ ...updated, createdBy: null, updatedBy: user, adjustments: [] }) };
}

export async function getFinanceiroUploads(actor: Actor) {
  const user = await requireFinanceiroUser(actor);
  if ("error" in user) return user;
  const uploads = await prisma.financeUploadBatch.findMany({
    orderBy: { uploadedAt: "desc" },
    take: 100,
    include: { uploadedBy: { select: { name: true, email: true } } }
  });
  return { data: uploads.map(mapFinanceiroUpload) };
}

export async function exportFinanceiro(actor: Actor, filters: FinanceiroFilters = {}): Promise<XlsxExportPayload | { error: string; status?: number }> {
  const user = await requireFinanceiroUser(actor);
  if ("error" in user) return user;
  const where = buildFinanceiroWhere(filters);
  const [records, adjustments, uploads] = await Promise.all([
    prisma.financeInvoiceCycleRecord.findMany({
      where,
      include: { createdBy: true, updatedBy: true },
      orderBy: [{ invoiceCycleMonth: "desc" }, { costCenter: "asc" }]
    }),
    prisma.financeAdjustment.findMany({
      where: Object.keys(where).length ? { record: { is: where } } : {},
      include: { record: true, createdBy: true },
      orderBy: { createdAt: "desc" }
    }),
    prisma.financeUploadBatch.findMany({ include: { uploadedBy: true }, orderBy: { uploadedAt: "desc" } })
  ]);
  const summary = buildFinanceiroSummary(records);
  await auditFinanceiro(user.id, "Financeiro", "export", "FINANCEIRO_EXPORTED", { filters, rows: records.length }, AuditAction.EDICAO);
  return {
    fileName: `financeiro_${new Date().toISOString().slice(0, 10)}.xlsx`,
    sheetName: "Consolidado",
    headers: ["max_hours_capacity", "billable_hours_target", "billable_hours_actual", "aderence_percent", "difference_hours", "penalty_percent"],
    rows: [[summary.maxHoursCapacity, summary.billableHoursTarget, summary.billableHoursActual, `${summary.adherencePercent}%`, summary.differenceHours, `${summary.penaltyPercent}%`]],
    sheets: [
      {
        sheetName: "Historico por ciclo",
        headers: ["invoice_cycle_month", "cost_center", "max_hours_capacity", "billable_hours_target", "billable_hours_actual", "adherence_percent", "difference_hours", "penalty_percent", "notes", "source", "created_at", "updated_at"],
        rows: records.map((record) => [record.invoiceCycleMonth, record.costCenter, minutesToHours(record.maxHoursCapacityMinutes), minutesToHours(record.billableHoursTargetMinutes), minutesToHours(record.billableHoursActualMinutes), `${Number(record.adherencePercent)}%`, minutesToHours(record.differenceMinutes), `${Number(record.penaltyPercent)}%`, record.notes ?? "", record.source ?? "", record.createdAt.toISOString(), record.updatedAt.toISOString()])
      },
      {
        sheetName: "Ajustes",
        headers: ["invoice_cycle_month", "cost_center", "campo", "valor_anterior", "valor_novo", "tipo_ajuste", "descricao", "criado_por", "criado_em"],
        rows: adjustments.map((row) => [row.record.invoiceCycleMonth, row.record.costCenter, row.fieldName, row.oldValue ?? "", row.newValue ?? "", row.adjustmentType, row.description, row.createdBy?.email ?? "", row.createdAt.toISOString()])
      },
      {
        sheetName: "Uploads",
        headers: ["arquivo", "usuario", "linhas_total", "linhas_validas", "linhas_erro", "criados", "atualizados", "status", "uploaded_at"],
        rows: uploads.map((row) => [row.fileName, row.uploadedBy?.email ?? "", row.rowsTotal, row.rowsValid, row.rowsError, row.rowsInserted, row.rowsUpdated, row.status, row.uploadedAt.toISOString()])
      }
    ]
  };
}

function buildFinanceiroWhere(filters: FinanceiroFilters = {}) {
  const where: Prisma.FinanceInvoiceCycleRecordWhereInput = {};
  const month = normalizeFinanceiroMonth(filters.invoiceCycleMonth);
  if (month) where.invoiceCycleMonth = month;
  if (filters.costCenter && filters.costCenter !== "Todos") where.costCenter = filters.costCenter;
  if (filters.source && filters.source !== "Todos") where.source = filters.source;
  if (filters.search?.trim()) {
    const search = filters.search.trim();
    where.OR = [
      { costCenter: { contains: search, mode: "insensitive" } },
      { notes: { contains: search, mode: "insensitive" } },
      { source: { contains: search, mode: "insensitive" } }
    ];
  }
  return where;
}

function parseFinanceiroImportRow(row: Record<string, unknown>, rowNumber: number, seen: Map<string, number>): FinanceiroPreviewRow {
  const errors: string[] = [];
  const warnings: string[] = [];
  const invoiceCycleMonth = normalizeFinanceiroMonth(rowValue(row, ["invoice_cycle_month", "ciclo_da_invoice", "ciclo da invoice", "ciclo", "invoice cycle", "invoice month"]));
  const costCenter = text(rowValue(row, ["cost_center", "cost center", "cost of center", "centro de custo"]));
  const maxHours = parseHours(rowValue(row, ["max_hours_capacity", "max hours capacity", "max hours", "capacity"]));
  const targetHours = parseHours(rowValue(row, ["billable_hours_target", "billable hours target", "billable hours meta", "billable hours (meta)", "meta"]));
  const actualHours = parseHours(rowValue(row, ["billable_hours_actual", "billable hours actual", "billable hours real", "billable hours (real)", "real"]));
  const importedAdherence = parsePercent(rowValue(row, ["adherence_percent", "aderence_percent", "aderence %", "adherence %", "aderence", "adherence"]));
  const importedDifference = parseHours(rowValue(row, ["difference_hours", "difference", "diferença", "diferenca"]));
  const penalty = parsePercent(rowValue(row, ["penalty_percent", "penalty %", "penalty", "penalidade"]));
  const notes = text(rowValue(row, ["notes", "observacao", "observação", "comentario", "comentário"]));
  const source = text(rowValue(row, ["source", "fonte"])) || FINANCEIRO_DEFAULT_SOURCE;

  if (!invoiceCycleMonth) errors.push("Ciclo da invoice inválido.");
  if (!costCenter) errors.push("Cost center é obrigatório.");
  if (maxHours === null) errors.push("Max Hours inválido.");
  if (targetHours === null) errors.push("Billable Hours Meta inválido.");
  if (actualHours === null) errors.push("Billable Hours Real inválido.");
  if (penalty === null) errors.push("Penalty % inválido.");

  const key = financeRecordKey(invoiceCycleMonth, costCenter);
  if (key) {
    const first = seen.get(key);
    if (first) errors.push(`Linha duplicada no arquivo. Primeira ocorrência na linha ${first}.`);
    else seen.set(key, rowNumber);
  }

  const safeTarget = targetHours ?? 0;
  const safeActual = actualHours ?? 0;
  const adherencePercent = importedAdherence ?? calculateAdherence(safeActual, safeTarget);
  const differenceMinutes = importedDifference ?? safeActual - safeTarget;
  if (importedAdherence === null) warnings.push("Aderence % calculado automaticamente.");
  if (importedDifference === null) warnings.push("Difference calculado automaticamente.");

  return {
    rowNumber,
    invoiceCycleMonth,
    costCenter,
    maxHoursCapacityMinutes: maxHours ?? 0,
    billableHoursTargetMinutes: safeTarget,
    billableHoursActualMinutes: safeActual,
    adherencePercent,
    differenceMinutes,
    penaltyPercent: penalty ?? 0,
    notes,
    source,
    action: errors.length ? "ignore" : "create",
    errors,
    warnings
  };
}

function buildFinanceiroPreview(rows: FinanceiroPreviewRow[], fileName: string) {
  return {
    fileName,
    totalRows: rows.length,
    validRows: rows.filter((row) => !row.errors.length).length,
    errorRows: rows.filter((row) => row.errors.length).length,
    createdRows: rows.filter((row) => row.action === "create").length,
    updatedRows: rows.filter((row) => row.action === "update").length,
    rows: rows.map((row) => ({
      ...row,
      display: {
        invoiceCycleMonth: formatReferenceMonth(row.invoiceCycleMonth),
        maxHoursCapacity: minutesToHours(row.maxHoursCapacityMinutes),
        billableHoursTarget: minutesToHours(row.billableHoursTargetMinutes),
        billableHoursActual: minutesToHours(row.billableHoursActualMinutes),
        adherencePercent: `${formatNumber(row.adherencePercent)}%`,
        differenceHours: minutesToHours(row.differenceMinutes),
        penaltyPercent: `${formatNumber(row.penaltyPercent)}%`
      }
    }))
  };
}

function buildFinanceiroSummary(records: Array<{ maxHoursCapacityMinutes: number; billableHoursTargetMinutes: number; billableHoursActualMinutes: number; differenceMinutes: number; penaltyPercent: Prisma.Decimal | number }>) {
  const maxMinutes = records.reduce((sum, row) => sum + row.maxHoursCapacityMinutes, 0);
  const targetMinutes = records.reduce((sum, row) => sum + row.billableHoursTargetMinutes, 0);
  const actualMinutes = records.reduce((sum, row) => sum + row.billableHoursActualMinutes, 0);
  const differenceMinutes = records.reduce((sum, row) => sum + row.differenceMinutes, 0);
  const penaltyPercent = records.length ? round2(records.reduce((sum, row) => sum + Number(row.penaltyPercent), 0) / records.length) : 0;
  return {
    maxHoursCapacity: minutesToHours(maxMinutes),
    maxHoursCapacityMinutes: maxMinutes,
    billableHoursTarget: minutesToHours(targetMinutes),
    billableHoursTargetMinutes: targetMinutes,
    billableHoursActual: minutesToHours(actualMinutes),
    billableHoursActualMinutes: actualMinutes,
    adherencePercent: calculateAdherence(actualMinutes, targetMinutes),
    differenceHours: minutesToHours(differenceMinutes),
    differenceMinutes,
    penaltyPercent,
    recordsCount: records.length
  };
}

type FinanceiroRecordLike = Prisma.FinanceInvoiceCycleRecordGetPayload<{}> & {
  createdBy?: { name?: string | null; email?: string | null } | null;
  updatedBy?: { name?: string | null; email?: string | null } | null;
  adjustments?: Array<{
    id: string;
    fieldName: string;
    oldValue: string | null;
    newValue: string | null;
    adjustmentType: string;
    description: string;
    createdAt: Date;
    createdBy?: { name?: string | null; email?: string | null } | null;
  }>;
};

function mapFinanceiroRecord(record: FinanceiroRecordLike) {
  return {
    id: record.id,
    invoiceCycleMonth: record.invoiceCycleMonth,
    invoiceCycleLabel: formatReferenceMonth(record.invoiceCycleMonth),
    costCenter: record.costCenter,
    maxHoursCapacityMinutes: record.maxHoursCapacityMinutes,
    maxHoursCapacity: minutesToHours(record.maxHoursCapacityMinutes),
    billableHoursTargetMinutes: record.billableHoursTargetMinutes,
    billableHoursTarget: minutesToHours(record.billableHoursTargetMinutes),
    billableHoursActualMinutes: record.billableHoursActualMinutes,
    billableHoursActual: minutesToHours(record.billableHoursActualMinutes),
    adherencePercent: Number(record.adherencePercent),
    adherenceLabel: `${formatNumber(Number(record.adherencePercent))}%`,
    differenceMinutes: record.differenceMinutes,
    differenceHours: minutesToHours(record.differenceMinutes),
    penaltyPercent: Number(record.penaltyPercent),
    penaltyLabel: `${formatNumber(Number(record.penaltyPercent))}%`,
    notes: record.notes ?? "",
    source: record.source ?? "",
    createdBy: "createdBy" in record ? record.createdBy?.name ?? record.createdBy?.email ?? "" : "",
    updatedBy: "updatedBy" in record ? record.updatedBy?.name ?? record.updatedBy?.email ?? "" : "",
    createdAt: formatDateTime(record.createdAt),
    updatedAt: formatDateTime(record.updatedAt),
    adjustments: ("adjustments" in record ? record.adjustments ?? [] : []).map((adjustment) => ({
      id: adjustment.id,
      fieldName: adjustment.fieldName,
      oldValue: adjustment.oldValue ?? "",
      newValue: adjustment.newValue ?? "",
      adjustmentType: adjustment.adjustmentType,
      description: adjustment.description,
      createdBy: adjustment.createdBy?.name ?? adjustment.createdBy?.email ?? "",
      createdAt: formatDateTime(adjustment.createdAt)
    }))
  };
}

function mapFinanceiroUpload(upload: Prisma.FinanceUploadBatchGetPayload<{ include: { uploadedBy: { select: { name: true; email: true } } } }>) {
  return {
    id: upload.id,
    fileName: upload.fileName,
    rowsTotal: upload.rowsTotal,
    rowsValid: upload.rowsValid,
    rowsError: upload.rowsError,
    rowsInserted: upload.rowsInserted,
    rowsUpdated: upload.rowsUpdated,
    uploadedBy: upload.uploadedBy?.name ?? upload.uploadedBy?.email ?? "",
    uploadedAt: formatDateTime(upload.uploadedAt),
    status: upload.status,
    errorSummary: upload.errorSummary
  };
}

function parseAdjustmentValue(type: string, value: unknown): { valid: true; value: string | number } | { valid: false; error: string } {
  if (type === "hours") {
    const parsed = parseHours(value);
    return parsed === null ? { valid: false, error: "Valor de horas inválido." } : { valid: true, value: parsed };
  }
  if (type === "percent") {
    const parsed = parsePercent(value);
    return parsed === null ? { valid: false, error: "Valor percentual inválido." } : { valid: true, value: parsed };
  }
  return { valid: true, value: text(value) };
}

function financeFieldDisplay(record: { [key: string]: unknown }, fieldName: string) {
  if (fieldName.endsWith("Minutes")) return minutesToHours(Number(record[fieldName] ?? 0));
  if (fieldName.endsWith("Percent")) return `${formatNumber(Number(record[fieldName] ?? 0))}%`;
  return String(record[fieldName] ?? "");
}

async function findFinanceiroUser(actor: Actor) {
  if (!actor.email) return null;
  return prisma.user.findUnique({ where: { email: actor.email } });
}

async function requireFinanceiroUser(actor: Actor): Promise<FinanceiroUser | { error: string; status: number }> {
  const user = await findFinanceiroUser(actor);
  if (!user) return { error: "Usuário ativo não encontrado.", status: 401 };
  if (!canAccessFinanceiro(user)) return { error: "Você não tem permissão para acessar Financeiro.", status: 403 };
  return user;
}

async function auditFinanceiro(actorId: string, entity: string, entityId: string, reason: string, after: unknown, action: AuditAction) {
  await prisma.auditLog.create({
    data: { actorId, action, entity, entityId, reason, after: after as Prisma.InputJsonValue }
  }).catch(() => undefined);
}

function normalizeObjectKeys(row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [normalizeHeader(key), value]));
}

function normalizeHeader(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[()]/g, "")
    .replace(/[%]/g, " percent")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function rowValue(row: Record<string, unknown>, aliases: string[]) {
  for (const alias of aliases) {
    const value = row[normalizeHeader(alias)];
    if (!isEmpty(value)) return value;
  }
  return "";
}

function normalizeFinanceiroMonth(value?: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
  const normalized = normalizeReferenceMonth(text(value));
  if (normalized) return normalized;
  const clean = text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const year = clean.match(/\b(20\d{2})\b/)?.[1];
  const month = MONTH_ALIASES.find((item) => clean.includes(item.name))?.month;
  return year && month ? `${year}-${String(month).padStart(2, "0")}` : "";
}

const MONTH_ALIASES = [
  "janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"
].map((name, index) => ({ name, month: index + 1 }));

function parseHours(value: unknown): number | null {
  if (isEmpty(value)) return null;
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value * 60);
  const raw = text(value).replace(/\s/g, "");
  if (!raw) return null;
  const sign = raw.startsWith("-") ? -1 : 1;
  const unsigned = raw.replace(/^[+-]/, "");
  if (/^\d+:\d{1,2}$/.test(unsigned)) {
    const [hours, minutes] = unsigned.split(":").map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes) || minutes >= 60) return null;
    return sign * (hours * 60 + minutes);
  }
  const decimalValue = Number(unsigned.replace(",", "."));
  if (!Number.isFinite(decimalValue)) return null;
  return Math.round(sign * decimalValue * 60);
}

function parsePercent(value: unknown): number | null {
  if (isEmpty(value)) return null;
  if (typeof value === "number" && Number.isFinite(value)) return round2(value);
  const parsed = Number(text(value).replace("%", "").replace(",", ".").trim());
  return Number.isFinite(parsed) ? round2(parsed) : null;
}

function calculateAdherence(actualMinutes: number, targetMinutes: number) {
  return targetMinutes > 0 ? round2((actualMinutes / targetMinutes) * 100) : 0;
}

function minutesToHours(minutes: number) {
  const sign = minutes < 0 ? "-" : "";
  const absolute = Math.abs(Math.round(minutes));
  const hours = Math.floor(absolute / 60);
  const remainder = absolute % 60;
  return `${sign}${hours}:${String(remainder).padStart(2, "0")}`;
}

function financeRecordKey(month: string, costCenter: string) {
  return month && costCenter ? `${month}:${costCenter.trim().toLowerCase()}` : "";
}

function decimal(value: number) {
  return new Prisma.Decimal(round2(value));
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
}

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(value);
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function isEmpty(value: unknown) {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

function round2(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function chunks<T>(rows: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < rows.length; index += size) result.push(rows.slice(index, index + size));
  return result;
}
