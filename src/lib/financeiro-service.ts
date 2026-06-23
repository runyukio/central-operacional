import { AuditAction, Prisma, type WorkHourRecordStatus } from "@prisma/client";

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
  status: string;
  maxHoursCapacityMinutes: number;
  billableHoursTargetMinutes: number;
  billableHoursActualMinutes: number;
  trainingHoursMinutes: number;
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
const FINANCEIRO_MANUAL_SOURCE = "Manual";
const FINANCEIRO_TEMPLATE_HEADERS = ["invoice_cycle_month", "cost_center", "status", "max_hours_capacity", "billable_hours_actual", "training_hours", "adherence_percent", "difference_hours", "penalty_percent", "notes"];
const FINANCEIRO_DEFAULT_KWAI_HOURLY_USD = 9.39;
const FINANCEIRO_DEFAULT_GLOBAL_HOURLY_USD = 5.965;
const FINANCEIRO_DEFAULT_TRAINING_HOURLY_USD = 1.45;
const FINANCEIRO_ALLOWED_COST_CENTERS = ["ADS", "CEC", "COMMENTS", "VIDEO", "PROJECT"] as const;
const FINANCEIRO_MIN_REFERENCE_MONTH = "2026-06";
const FINANCEIRO_RECORD_STATUS_OPTIONS = ["PROJECAO", "EM_VALIDACAO", "FECHADO"] as const;
type FinanceiroRecordStatus = typeof FINANCEIRO_RECORD_STATUS_OPTIONS[number];
const FINANCEIRO_ALLOWED_CONTRACT_TYPES = ["CLT", "PJ"] as const;
const FINANCEIRO_PROJECTABLE_SCHEDULE_STATUSES = ["ESCALADO", "PRESENTE", "VENDA_FOLGA_APROVADA"] as const;
const FINANCEIRO_ABSENCE_SCHEDULE_STATUSES = ["FALTA", "FALTA_JUSTIFICADA", "FALTA_INJUSTIFICADA"] as const;
const FINANCEIRO_TRAINING_SCHEDULE_STATUSES = ["TREINAMENTO"] as const;
const FINANCEIRO_APPROVED_WORK_HOUR_STATUSES: WorkHourRecordStatus[] = ["IMPORTED", "OK", "DIVERGENT", "ADJUSTMENT_APPROVED", "ADJUSTMENT_REJECTED", "MANUALLY_CORRECTED"];
const FINANCEIRO_CLOSED_BILLING_STATUSES = new Set(["FECHADO", "PAGO"]);
const FINANCEIRO_ADJUSTMENT_FIELDS = new Map<string, { label: string; type: "hours" | "percent" | "text" }>([
  ["maxHoursCapacityMinutes", { label: "Max Hours (Capacity)", type: "hours" }],
  ["billableHoursActualMinutes", { label: "Billable Hours (Real)", type: "hours" }],
  ["trainingHoursMinutes", { label: "Training Hours", type: "hours" }],
  ["adherencePercent", { label: "Aderence %", type: "percent" }],
  ["differenceMinutes", { label: "Difference", type: "hours" }],
  ["penaltyPercent", { label: "Penalty %", type: "percent" }],
  ["status", { label: "Status", type: "text" }],
  ["notes", { label: "Notes", type: "text" }],
  ["source", { label: "Source", type: "text" }]
] as const);

export async function getFinanceiroDashboard(actor: Actor, filters: FinanceiroFilters = {}) {
  const user = await requireFinanceiroUser(actor);
  if ("error" in user) return user;
  const where = buildFinanceiroWhere(filters);
  const [records, sources, costCenters, uploads] = await Promise.all([
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
      distinct: ["source"],
      where: { source: { not: null } },
      select: { source: true },
      orderBy: { source: "asc" }
    }),
    prisma.financeInvoiceCycleRecord.findMany({
      distinct: ["costCenter"],
      select: { costCenter: true },
      orderBy: { costCenter: "asc" }
    }),
    prisma.financeUploadBatch.findMany({
      orderBy: { uploadedAt: "desc" },
      take: 8,
      include: { uploadedBy: { select: { name: true, email: true } } }
    })
  ]);
  const analytics = await buildFinanceiroAnalytics(records, filters);

  return {
    data: {
      filters: {
        invoiceCycleMonth: normalizeFinanceiroMonth(filters.invoiceCycleMonth) || currentReferenceMonth(),
        costCenter: filters.costCenter || "Todos",
        source: filters.source || "Todos",
        search: filters.search || ""
      },
      filterOptions: {
        costCenters: buildFinanceCostCenterOptions(costCenters.map((item) => item.costCenter)),
        sources: ["Todos", ...sources.map((item) => item.source ?? "").filter(Boolean)]
      },
      summary: buildFinanceiroSummary(records),
      analytics,
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
        billableHoursTargetMinutes: row.maxHoursCapacityMinutes,
        billableHoursActualMinutes: row.billableHoursActualMinutes,
        trainingHoursMinutes: row.trainingHoursMinutes,
        status: row.status,
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
        billableHoursTargetMinutes: row.maxHoursCapacityMinutes,
        billableHoursActualMinutes: row.billableHoursActualMinutes,
        trainingHoursMinutes: row.trainingHoursMinutes,
        status: row.status,
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
  if (fieldName === "billableHoursActualMinutes") data.billableHoursActualMinutes = parsed.value as number;
  if (fieldName === "trainingHoursMinutes") data.trainingHoursMinutes = parsed.value as number;
  if (fieldName === "adherencePercent") data.adherencePercent = decimal(parsed.value as number);
  if (fieldName === "differenceMinutes") data.differenceMinutes = parsed.value as number;
  if (fieldName === "penaltyPercent") data.penaltyPercent = decimal(parsed.value as number);
  if (fieldName === "status") {
    const status = normalizeFinanceRecordStatus(parsed.value);
    if (!status) return { error: "Status financeiro inválido.", status: 400 };
    data.status = status;
  }
  if (fieldName === "notes") data.notes = String(parsed.value ?? "").trim() || null;
  if (fieldName === "source") data.source = String(parsed.value ?? "").trim() || null;

  const nextTarget = fieldName === "maxHoursCapacityMinutes" ? parsed.value as number : record.maxHoursCapacityMinutes;
  const nextActual = fieldName === "billableHoursActualMinutes" ? parsed.value as number : record.billableHoursActualMinutes;
  if (fieldName === "maxHoursCapacityMinutes" || fieldName === "billableHoursActualMinutes") {
    data.billableHoursTargetMinutes = nextTarget;
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

export async function saveFinanceiroRecord(actor: Actor, input: Record<string, unknown>) {
  const user = await requireFinanceiroUser(actor);
  if ("error" in user) return user;
  const id = text(input.id);
  const invoiceCycleMonth = normalizeFinanceiroMonth(input.invoiceCycleMonth);
  const rawCostCenter = text(input.costCenter);
  const costCenter = normalizeFinanceRecordCostCenter(rawCostCenter, invoiceCycleMonth);
  if (!invoiceCycleMonth) return { error: "Ciclo da invoice é obrigatório.", status: 400 };
  if (!rawCostCenter) return { error: "LOB é obrigatória.", status: 400 };
  if (!costCenter) return { error: "LOB inválida.", status: 400 };
  if (isFinanceNewFlowMonth(invoiceCycleMonth) && !normalizeFinanceCostCenter(rawCostCenter)) return { error: "LOB permitidas a partir de Junho/2026: ADS, CEC, COMMENTS, VIDEO e PROJECT.", status: 400 };

  const maxHoursCapacityMinutes = parseHours(input.maxHoursCapacity);
  const billableHoursActualMinutes = parseHours(input.billableHoursActual);
  const trainingHoursMinutes = parseOptionalHours(input.trainingHours, "Training Hours");
  const penaltyPercent = parsePercent(input.penaltyPercent);
  const importedAdherence = parsePercent(input.adherencePercent);
  const importedDifference = parseHours(input.differenceHours);
  const rawStatus = text(input.status);
  const status = normalizeFinanceRecordStatus(input.status);
  if (maxHoursCapacityMinutes === null) return { error: "Max Hours (Capacity) inválido.", status: 400 };
  if (billableHoursActualMinutes === null) return { error: "Billable Hours (Real) inválido.", status: 400 };
  if (typeof trainingHoursMinutes === "string") return { error: trainingHoursMinutes, status: 400 };
  if (penaltyPercent === null) return { error: "Penalty % inválido.", status: 400 };
  if (rawStatus && !status) return { error: "Status financeiro inválido.", status: 400 };

  const billableHoursTargetMinutes = maxHoursCapacityMinutes;
  const adherencePercent = importedAdherence ?? calculateAdherence(billableHoursActualMinutes, billableHoursTargetMinutes);
  const differenceMinutes = importedDifference ?? billableHoursActualMinutes - billableHoursTargetMinutes;
  const notes = text(input.notes);
  const source = text(input.source) || FINANCEIRO_MANUAL_SOURCE;
  const data = {
    invoiceCycleMonth,
    costCenter,
    maxHoursCapacityMinutes,
    billableHoursTargetMinutes,
    billableHoursActualMinutes,
    trainingHoursMinutes,
    status: status || "PROJECAO",
    adherencePercent: decimal(adherencePercent),
    differenceMinutes,
    penaltyPercent: decimal(penaltyPercent),
    notes: notes || null,
    source,
    updatedById: user.id
  };

  try {
    const saved = id
      ? await prisma.financeInvoiceCycleRecord.update({
        where: { id },
        data,
        include: {
          createdBy: { select: { name: true, email: true } },
          updatedBy: { select: { name: true, email: true } },
          adjustments: { orderBy: { createdAt: "desc" }, include: { createdBy: { select: { name: true, email: true } } } }
        }
      })
      : await prisma.financeInvoiceCycleRecord.create({
        data: { ...data, createdById: user.id },
        include: {
          createdBy: { select: { name: true, email: true } },
          updatedBy: { select: { name: true, email: true } },
          adjustments: { orderBy: { createdAt: "desc" }, include: { createdBy: { select: { name: true, email: true } } } }
        }
      });
    await auditFinanceiro(user.id, "FinanceInvoiceCycleRecord", saved.id, id ? "FINANCEIRO_RECORD_UPDATED" : "FINANCEIRO_RECORD_CREATED", {
      invoiceCycleMonth,
      costCenter,
      maxHoursCapacity: minutesToHours(maxHoursCapacityMinutes),
      billableHoursActual: minutesToHours(billableHoursActualMinutes),
      trainingHours: minutesToHours(trainingHoursMinutes),
      status: status || "PROJECAO",
      adherencePercent,
      differenceHours: minutesToHours(differenceMinutes),
      penaltyPercent
    }, AuditAction.EDICAO);
    return { data: mapFinanceiroRecord(saved) };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "Já existe registro para este ciclo e LOB. Use Editar no registro existente.", status: 409 };
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return { error: "Registro financeiro não encontrado.", status: 404 };
    }
    throw error;
  }
}

export async function saveFinanceiroParameter(actor: Actor, input: Record<string, unknown>) {
  const user = await requireFinanceiroUser(actor);
  if ("error" in user) return user;
  const invoiceCycleMonth = normalizeFinanceiroMonth(input.invoiceCycleMonth);
  const rawCostCenter = text(input.costCenter);
  const costCenter = normalizeFinanceCostCenter(rawCostCenter);
  if (!invoiceCycleMonth) return { error: "Ciclo da invoice é obrigatório para parâmetros.", status: 400 };
  if (!rawCostCenter || rawCostCenter === "Todos") return { error: "LOB é obrigatória para parâmetros.", status: 400 };
  if (!costCenter) return { error: "LOB permitidas para parâmetros: ADS, CEC, COMMENTS, VIDEO e PROJECT.", status: 400 };

  const kwaiHourlyUsd = parseMoneyNumber(input.kwaiHourlyUsd, FINANCEIRO_DEFAULT_KWAI_HOURLY_USD);
  const globalHourlyUsd = parseMoneyNumber(input.globalHourlyUsd, FINANCEIRO_DEFAULT_GLOBAL_HOURLY_USD);
  const trainingHourlyUsd = parseMoneyNumber(input.trainingHourlyUsd, FINANCEIRO_DEFAULT_TRAINING_HOURLY_USD);
  const exchangeRateUsdBrl = parseMoneyNumber(input.exchangeRateUsdBrl, 0);
  if (kwaiHourlyUsd === null) return { error: "Repasse Kwai USD/h inválido.", status: 400 };
  if (globalHourlyUsd === null) return { error: "Repasse Global USD/h inválido.", status: 400 };
  if (trainingHourlyUsd === null) return { error: "Repasse treinamento USD/h inválido.", status: 400 };
  if (exchangeRateUsdBrl === null) return { error: "Câmbio USD/BRL inválido.", status: 400 };

  const notes = text(input.notes);
  const saved = await prisma.financeCycleParameter.upsert({
    where: { invoiceCycleMonth_costCenter: { invoiceCycleMonth, costCenter } },
    update: {
      kwaiHourlyUsd: decimal4(kwaiHourlyUsd),
      globalHourlyUsd: decimal4(globalHourlyUsd),
      trainingHourlyUsd: decimal4(trainingHourlyUsd),
      exchangeRateUsdBrl: decimal4(exchangeRateUsdBrl),
      notes: notes || null,
      updatedById: user.id
    },
    create: {
      invoiceCycleMonth,
      costCenter,
      kwaiHourlyUsd: decimal4(kwaiHourlyUsd),
      globalHourlyUsd: decimal4(globalHourlyUsd),
      trainingHourlyUsd: decimal4(trainingHourlyUsd),
      exchangeRateUsdBrl: decimal4(exchangeRateUsdBrl),
      notes: notes || null,
      createdById: user.id,
      updatedById: user.id
    }
  });
  await auditFinanceiro(user.id, "FinanceCycleParameter", saved.id, "FINANCEIRO_PARAMETER_SAVED", {
    invoiceCycleMonth,
    costCenter,
    kwaiHourlyUsd,
    globalHourlyUsd,
    trainingHourlyUsd,
    exchangeRateUsdBrl,
    notes
  }, AuditAction.EDICAO);
  return { data: mapFinanceiroParameter(saved) };
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

export async function exportFinanceiroTemplate(actor: Actor): Promise<XlsxExportPayload | { error: string; status?: number }> {
  const user = await requireFinanceiroUser(actor);
  if ("error" in user) return user;
  await auditFinanceiro(user.id, "Financeiro", "template", "FINANCEIRO_TEMPLATE_DOWNLOADED", { headers: FINANCEIRO_TEMPLATE_HEADERS }, AuditAction.EDICAO);
  return {
    fileName: "template_financeiro.xlsx",
    sheetName: "Template Financeiro",
    headers: FINANCEIRO_TEMPLATE_HEADERS,
    rows: []
  };
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
  const analytics = await buildFinanceiroAnalytics(records, filters);
  await auditFinanceiro(user.id, "Financeiro", "export", "FINANCEIRO_EXPORTED", { filters, rows: records.length }, AuditAction.EDICAO);
  return {
    fileName: `financeiro_${new Date().toISOString().slice(0, 10)}.xlsx`,
    sheetName: "Consolidado",
    headers: ["max_hours_capacity", "billable_hours_actual", "training_hours", "aderence_percent", "difference_hours", "penalty_percent"],
    rows: [[summary.maxHoursCapacity, summary.billableHoursActual, summary.trainingHours, `${summary.adherencePercent}%`, summary.differenceHours, `${summary.penaltyPercent}%`]],
    sheets: [
      {
        sheetName: "Historico por ciclo",
        headers: ["invoice_cycle_month", "cost_center", "status", "max_hours_capacity", "billable_hours_actual", "training_hours", "adherence_percent", "difference_hours", "penalty_percent", "notes", "source", "created_at", "updated_at"],
        rows: records.map((record) => [record.invoiceCycleMonth, record.costCenter, financeRecordStatusLabel(record.status), minutesToHours(record.maxHoursCapacityMinutes), minutesToHours(record.billableHoursActualMinutes), minutesToHours(record.trainingHoursMinutes), `${Number(record.adherencePercent)}%`, minutesToHours(record.differenceMinutes), `${Number(record.penaltyPercent)}%`, record.notes ?? "", record.source ?? "", record.createdAt.toISOString(), record.updatedAt.toISOString()])
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
      },
      {
        sheetName: "Valores",
        headers: ["invoice_cycle_month", "cost_center", "status", "kwai_revenue_usd", "global_revenue_usd", "training_revenue_usd", "total_revenue_usd", "exchange_rate_usd_brl", "total_revenue_brl"],
        rows: analytics.rows.map((row) => [row.invoiceCycleMonth, row.costCenter, row.statusLabel, row.values.kwaiRevenueUsd, row.values.globalRevenueUsd, row.values.trainingRevenueUsd, row.values.totalRevenueUsd, row.values.exchangeRateUsdBrl, row.values.totalRevenueBrl])
      },
      {
        sheetName: "Custos",
        headers: ["invoice_cycle_month", "cost_center", "status", "custo_aprovado_brl", "custo_projetado_brl", "gross_billing_brl", "final_billing_brl"],
        rows: analytics.rows.map((row) => [row.invoiceCycleMonth, row.costCenter, row.statusLabel, row.costs.approvedCostBrl, row.costs.projectedCostBrl, row.costs.grossAmountBrl, row.costs.finalAmountBrl])
      },
      {
        sheetName: "Resultado",
        headers: ["invoice_cycle_month", "cost_center", "status", "receita_brl", "custo_brl", "resultado_brl", "margem_percent"],
        rows: analytics.rows.map((row) => [row.invoiceCycleMonth, row.costCenter, row.statusLabel, row.values.totalRevenueBrl, row.costs.finalAmountBrl, row.result.resultBrl, `${row.result.marginPercent}%`])
      },
      {
        sheetName: "Parametros",
        headers: ["invoice_cycle_month", "cost_center", "kwai_hourly_usd", "global_hourly_usd", "training_hourly_usd", "exchange_rate_usd_brl", "origem"],
        rows: analytics.parameters.map((row) => [row.invoiceCycleMonth, row.costCenter, row.kwaiHourlyUsd, row.globalHourlyUsd, row.trainingHourlyUsd, row.exchangeRateUsdBrl, row.isDefault ? "Padrao" : "Salvo"])
      }
    ]
  };
}

function buildFinanceiroWhere(filters: FinanceiroFilters = {}) {
  const where: Prisma.FinanceInvoiceCycleRecordWhereInput = {};
  const and: Prisma.FinanceInvoiceCycleRecordWhereInput[] = [];
  const month = normalizeFinanceiroMonth(filters.invoiceCycleMonth);
  if (month) {
    where.invoiceCycleMonth = month;
  }
  const costCenterWhere = financeRecordCostCenterWhere(filters.costCenter);
  if (costCenterWhere) and.push(costCenterWhere);
  if (filters.source && filters.source !== "Todos") where.source = filters.source;
  if (filters.search?.trim()) {
    const search = filters.search.trim();
    and.push({
      OR: [
        { costCenter: { contains: search, mode: "insensitive" } },
        { notes: { contains: search, mode: "insensitive" } },
        { source: { contains: search, mode: "insensitive" } }
      ]
    });
  }
  if (and.length) where.AND = and;
  return where;
}

function financeRecordCostCenterWhere(value?: string | null): Prisma.FinanceInvoiceCycleRecordWhereInput | null {
  if (!value || value === "Todos") return null;
  const selected = normalizeFinanceRecordCostCenter(value);
  if (!selected) return { id: "__financeiro_no_cost_center__" };
  return { costCenter: { equals: selected, mode: "insensitive" } };
}

function financeAllowedParameterCostCenterWhere(value?: string | null): Prisma.FinanceCycleParameterWhereInput {
  const hasExplicitFilter = Boolean(value && value !== "Todos");
  const selected = normalizeFinanceCostCenter(value);
  if (hasExplicitFilter && !selected) return { id: "__financeiro_no_allowed_cost_center__" };
  if (selected) return { costCenter: { equals: selected, mode: "insensitive" } };
  return { OR: FINANCEIRO_ALLOWED_COST_CENTERS.map((costCenter) => ({ costCenter: { equals: costCenter, mode: "insensitive" as const } })) };
}

function financeEmployeeWhere(selectedCostCenter?: string | null): Prisma.EmployeeProfileWhereInput {
  const selected = normalizeFinanceCostCenter(selectedCostCenter);
  const and: Prisma.EmployeeProfileWhereInput[] = [
    { deletedAt: null },
    { OR: FINANCEIRO_ALLOWED_COST_CENTERS.map((costCenter) => ({ lob: { name: { equals: costCenter, mode: "insensitive" as const } } })) },
    { OR: FINANCEIRO_ALLOWED_CONTRACT_TYPES.map((contractType) => ({ contractType: { equals: contractType, mode: "insensitive" as const } })) }
  ];
  if (selected) and.push({ lob: { name: { equals: selected, mode: "insensitive" } } });
  return { AND: and };
}

function normalizeFinanceCostCenter(value?: string | null) {
  const normalized = text(value).toUpperCase();
  return (FINANCEIRO_ALLOWED_COST_CENTERS as readonly string[]).find((item) => item === normalized) ?? "";
}

function normalizeFinanceRecordCostCenter(value?: string | null, invoiceCycleMonth?: string | null) {
  const allowed = normalizeFinanceCostCenter(value);
  if (allowed) return allowed;
  const normalized = text(value).toUpperCase();
  if (!normalized) return "";
  return invoiceCycleMonth && isFinanceNewFlowMonth(invoiceCycleMonth) ? "" : normalized;
}

function isFinanceCostCenterAllowed(value?: string | null) {
  return Boolean(normalizeFinanceCostCenter(value));
}

function isFinanceNewFlowMonth(month?: string | null) {
  return Boolean(month && month >= FINANCEIRO_MIN_REFERENCE_MONTH);
}

function buildFinanceCostCenterOptions(values: string[]) {
  const options = unique([...FINANCEIRO_ALLOWED_COST_CENTERS, ...values.map((value) => text(value).toUpperCase()).filter(Boolean)]);
  const defaultOrder = new Map((FINANCEIRO_ALLOWED_COST_CENTERS as readonly string[]).map((value, index) => [value, index]));
  return ["Todos", ...options.sort((a, b) => {
    const orderA = defaultOrder.get(a) ?? 999;
    const orderB = defaultOrder.get(b) ?? 999;
    return orderA - orderB || a.localeCompare(b);
  })];
}

function parseFinanceiroImportRow(row: Record<string, unknown>, rowNumber: number, seen: Map<string, number>): FinanceiroPreviewRow {
  const errors: string[] = [];
  const warnings: string[] = [];
  const invoiceCycleMonth = normalizeFinanceiroMonth(rowValue(row, ["invoice_cycle_month", "ciclo_da_invoice", "ciclo da invoice", "ciclo", "invoice cycle", "invoice month"]));
  const rawCostCenter = text(rowValue(row, ["cost_center", "cost center", "cost of center", "centro de custo"]));
  const costCenter = normalizeFinanceRecordCostCenter(rawCostCenter, invoiceCycleMonth);
  const rawStatus = rowValue(row, ["status", "status_financeiro", "situacao", "situação"]);
  const status = normalizeFinanceRecordStatus(rawStatus);
  const targetFallback = rowValue(row, ["billable_hours_target", "billable hours target", "billable hours meta", "billable hours (meta)", "meta"]);
  const maxHours = parseHours(rowValue(row, ["max_hours_capacity", "max hours capacity", "max hours", "capacity"])) ?? parseHours(targetFallback);
  const actualHours = parseHours(rowValue(row, ["billable_hours_actual", "billable hours actual", "billable hours real", "billable hours (real)", "real"]));
  const trainingHours = parseHours(rowValue(row, ["training_hours", "training hours", "horas_treinamento", "horas de treinamento", "treinamento"]));
  const importedAdherence = parsePercent(rowValue(row, ["adherence_percent", "aderence_percent", "aderence %", "adherence %", "aderence", "adherence"]));
  const importedDifference = parseHours(rowValue(row, ["difference_hours", "difference", "diferença", "diferenca"]));
  const penalty = parsePercent(rowValue(row, ["penalty_percent", "penalty %", "penalty", "penalidade"]));
  const notes = text(rowValue(row, ["notes", "observacao", "observação", "comentario", "comentário"]));
  const source = text(rowValue(row, ["source", "fonte"])) || FINANCEIRO_DEFAULT_SOURCE;

  if (!invoiceCycleMonth) errors.push("Ciclo da invoice inválido.");
  if (!rawCostCenter) errors.push("LOB é obrigatória.");
  if (rawCostCenter && !costCenter) errors.push("LOB inválida.");
  if (invoiceCycleMonth && isFinanceNewFlowMonth(invoiceCycleMonth) && rawCostCenter && !normalizeFinanceCostCenter(rawCostCenter)) errors.push("LOB permitidas a partir de Junho/2026: ADS, CEC, COMMENTS, VIDEO e PROJECT.");
  if (!isEmpty(rawStatus) && !status) errors.push("Status financeiro inválido.");
  if (maxHours === null) errors.push("Max Hours inválido.");
  if (actualHours === null) errors.push("Billable Hours Real inválido.");
  if (trainingHours === null && !isEmpty(rowValue(row, ["training_hours", "training hours", "horas_treinamento", "horas de treinamento", "treinamento"]))) errors.push("Training Hours inválido.");
  if (penalty === null) errors.push("Penalty % inválido.");

  const key = financeRecordKey(invoiceCycleMonth, costCenter);
  if (key) {
    const first = seen.get(key);
    if (first) errors.push(`Linha duplicada no arquivo. Primeira ocorrência na linha ${first}.`);
    else seen.set(key, rowNumber);
  }

  const safeTarget = maxHours ?? 0;
  const safeActual = actualHours ?? 0;
  const adherencePercent = importedAdherence ?? calculateAdherence(safeActual, safeTarget);
  const differenceMinutes = importedDifference ?? safeActual - safeTarget;
  if (importedAdherence === null) warnings.push("Aderence % calculado automaticamente.");
  if (importedDifference === null) warnings.push("Difference calculado automaticamente.");

  return {
    rowNumber,
    invoiceCycleMonth,
    costCenter,
    status: status || "PROJECAO",
    maxHoursCapacityMinutes: maxHours ?? 0,
    billableHoursTargetMinutes: safeTarget,
    billableHoursActualMinutes: safeActual,
    trainingHoursMinutes: trainingHours ?? 0,
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
        billableHoursActual: minutesToHours(row.billableHoursActualMinutes),
        trainingHours: minutesToHours(row.trainingHoursMinutes),
        status: financeRecordStatusLabel(row.status),
        adherencePercent: `${formatNumber(row.adherencePercent)}%`,
        differenceHours: minutesToHours(row.differenceMinutes),
        penaltyPercent: `${formatNumber(row.penaltyPercent)}%`
      }
    }))
  };
}

function buildFinanceiroSummary(records: Array<{ maxHoursCapacityMinutes: number; billableHoursActualMinutes: number; trainingHoursMinutes: number; differenceMinutes: number; penaltyPercent: Prisma.Decimal | number }>) {
  const maxMinutes = records.reduce((sum, row) => sum + row.maxHoursCapacityMinutes, 0);
  const actualMinutes = records.reduce((sum, row) => sum + row.billableHoursActualMinutes, 0);
  const trainingMinutes = records.reduce((sum, row) => sum + row.trainingHoursMinutes, 0);
  const differenceMinutes = records.reduce((sum, row) => sum + row.differenceMinutes, 0);
  const penaltyPercent = records.length ? round2(records.reduce((sum, row) => sum + Number(row.penaltyPercent), 0) / records.length) : 0;
  return {
    maxHoursCapacity: minutesToHours(maxMinutes),
    maxHoursCapacityMinutes: maxMinutes,
    billableHoursActual: minutesToHours(actualMinutes),
    billableHoursActualMinutes: actualMinutes,
    trainingHours: minutesToHours(trainingMinutes),
    trainingHoursMinutes: trainingMinutes,
    adherencePercent: calculateAdherence(actualMinutes, maxMinutes),
    differenceHours: minutesToHours(differenceMinutes),
    differenceMinutes,
    penaltyPercent,
    recordsCount: records.length
  };
}

async function buildFinanceiroAnalytics(
  records: Array<{ invoiceCycleMonth: string; costCenter: string; status: string; billableHoursActualMinutes: number; trainingHoursMinutes: number; maxHoursCapacityMinutes: number; differenceMinutes: number }>,
  filters: FinanceiroFilters
) {
  const selectedMonth = normalizeFinanceiroMonth(filters.invoiceCycleMonth);
  const selectedCostCenter = normalizeFinanceCostCenter(filters.costCenter);
  const currentMonth = currentReferenceMonth();
  const hasHistoricalCostCenterFilter = Boolean(filters.costCenter && filters.costCenter !== "Todos" && !selectedCostCenter);
  if ((selectedMonth && selectedMonth < FINANCEIRO_MIN_REFERENCE_MONTH) || hasHistoricalCostCenterFilter) {
    return emptyFinanceiroAnalytics(currentMonth);
  }
  const recordMonths = unique(records.map((record) => record.invoiceCycleMonth).filter((month) => month >= FINANCEIRO_MIN_REFERENCE_MONTH));
  const months = unique([...(selectedMonth ? [selectedMonth] : recordMonths), currentMonth]).filter(Boolean);
  const parameterWhere: Prisma.FinanceCycleParameterWhereInput = {};
  if (selectedMonth) parameterWhere.invoiceCycleMonth = selectedMonth;
  else if (months.length) parameterWhere.invoiceCycleMonth = { in: months };
  const parameterCostCenterWhere = financeAllowedParameterCostCenterWhere(selectedCostCenter);
  if (parameterCostCenterWhere) Object.assign(parameterWhere, parameterCostCenterWhere);

  const [parameters, billingCycles, billingInvoices] = await Promise.all([
    prisma.financeCycleParameter.findMany({ where: parameterWhere, orderBy: [{ invoiceCycleMonth: "desc" }, { costCenter: "asc" }] }),
    prisma.billingCycle.findMany({
      where: { referenceMonth: { in: months } },
      select: { referenceMonth: true, status: true, closedAt: true }
    }),
    prisma.billingEmployeeInvoice.findMany({
      where: {
        referenceMonth: { in: months },
        employee: financeEmployeeWhere(selectedCostCenter)
      },
      select: {
        referenceMonth: true,
        approvedMinutes: true,
        projectedMinutes: true,
        totalConsideredMinutes: true,
        hourlyRate: true,
        grossAmount: true,
        finalAmount: true,
        employee: { select: { lob: { select: { name: true } } } }
      }
    })
  ]);

  const cyclesByMonth = new Map(billingCycles.map((cycle) => [cycle.referenceMonth, cycle]));
  const parametersByKey = new Map(parameters.map((parameter) => [financeRecordKey(parameter.invoiceCycleMonth, parameter.costCenter), parameter]));
  const billingByKey = groupBillingFinanceRows(billingInvoices, cyclesByMonth);
  const recordsByKey = new Map(records.map((record) => [financeRecordKey(record.invoiceCycleMonth, record.costCenter), record]));
  const keys = unique([
    ...Array.from(recordsByKey.keys()),
    ...Array.from(parametersByKey.keys()),
    ...Array.from(billingByKey.keys())
  ]);

  const rows = keys.map((key) => {
    const [invoiceCycleMonth, ...costCenterParts] = key.split(":");
    const normalizedCostCenter = costCenterParts.join(":");
    const record = recordsByKey.get(key);
    const storedParameter = parametersByKey.get(key);
    const storedBilling = billingByKey.get(key);
    const costCenter = normalizeFinanceCostCenter(record?.costCenter ?? storedParameter?.costCenter ?? storedBilling?.costCenter ?? normalizedCostCenter);
    const billing = storedBilling ?? emptyBillingBucket(invoiceCycleMonth, costCenter);
    const parameter = storedParameter ?? defaultFinanceParameter(invoiceCycleMonth, costCenter);
    const parameterView = mapFinanceiroParameter(parameter, !parametersByKey.has(key));
    const status = normalizeFinanceRecordStatus(record?.status) || "PROJECAO";
    const statusLabel = financeRecordStatusLabel(status);
    const totalCostBrl = billing.finalAmountBrl;
    const actualHours = (record?.billableHoursActualMinutes ?? 0) / 60;
    const trainingHours = (record?.trainingHoursMinutes ?? 0) / 60;
    const kwaiRevenueUsd = round2(actualHours * parameterView.kwaiHourlyUsd);
    const globalRevenueUsd = round2(actualHours * parameterView.globalHourlyUsd);
    const trainingRevenueUsd = round2(trainingHours * parameterView.trainingHourlyUsd);
    const totalRevenueUsd = round2(globalRevenueUsd + trainingRevenueUsd);
    const exchangeRate = parameterView.exchangeRateUsdBrl;
    const totalRevenueBrl = roundMoney(totalRevenueUsd * exchangeRate);
    const resultBrl = roundMoney(totalRevenueBrl - totalCostBrl);
    const marginPercent = totalRevenueBrl > 0 ? round2((resultBrl / totalRevenueBrl) * 100) : 0;
    return {
      key,
      invoiceCycleMonth,
      invoiceCycleLabel: formatReferenceMonth(invoiceCycleMonth),
      costCenter,
      status,
      statusLabel,
      parameters: parameterView,
      hours: {
        maxHoursCapacity: minutesToHours(record?.maxHoursCapacityMinutes ?? 0),
        billableActual: minutesToHours(record?.billableHoursActualMinutes ?? 0),
        training: minutesToHours(record?.trainingHoursMinutes ?? 0)
      },
      costs: {
        approvedCostBrl: billing.approvedCostBrl,
        projectedCostBrl: billing.projectedCostBrl,
        grossAmountBrl: billing.grossAmountBrl,
        finalAmountBrl: totalCostBrl
      },
      values: {
        kwaiRevenueUsd,
        globalRevenueUsd,
        trainingRevenueUsd,
        totalRevenueUsd,
        totalRevenueBrl,
        exchangeRateUsdBrl: exchangeRate
      },
      result: {
        resultBrl,
        marginPercent
      }
    };
  }).filter((row) => {
    if (!isFinanceCostCenterAllowed(row.costCenter)) return false;
    if (row.invoiceCycleMonth < FINANCEIRO_MIN_REFERENCE_MONTH) return false;
    if (selectedCostCenter && normalizeFinanceCostCenter(row.costCenter) !== selectedCostCenter) return false;
    if (selectedMonth && row.invoiceCycleMonth !== selectedMonth) return false;
    return true;
  }).sort((a, b) => b.invoiceCycleMonth.localeCompare(a.invoiceCycleMonth) || a.costCenter.localeCompare(b.costCenter));

  const summaries = rows.reduce((acc, row) => {
    acc.maxMinutes += parseDisplayMinutes(row.hours.maxHoursCapacity);
    acc.actualMinutes += parseDisplayMinutes(row.hours.billableActual);
    acc.trainingMinutes += parseDisplayMinutes(row.hours.training);
    acc.revenueUsd += row.values.totalRevenueUsd;
    acc.revenueBrl += row.values.totalRevenueBrl;
    acc.costBrl += row.costs.finalAmountBrl;
    acc.resultBrl += row.result.resultBrl;
    return acc;
  }, { maxMinutes: 0, actualMinutes: 0, trainingMinutes: 0, revenueUsd: 0, revenueBrl: 0, costBrl: 0, resultBrl: 0 });

  return {
    currentMonth,
    hoursSummary: {
      maxHoursCapacity: minutesToHours(summaries.maxMinutes),
      billableActual: minutesToHours(summaries.actualMinutes),
      training: minutesToHours(summaries.trainingMinutes)
    },
    valueSummary: {
      revenueUsd: round2(summaries.revenueUsd),
      revenueBrl: roundMoney(summaries.revenueBrl)
    },
    costSummary: {
      costBrl: roundMoney(summaries.costBrl)
    },
    resultSummary: {
      resultBrl: roundMoney(summaries.resultBrl),
      marginPercent: summaries.revenueBrl > 0 ? round2((summaries.resultBrl / summaries.revenueBrl) * 100) : 0
    },
    rows,
    parameters: rows.map((row) => row.parameters)
  };
}

function emptyFinanceiroAnalytics(currentMonth: string) {
  return {
    currentMonth,
    hoursSummary: {
      maxHoursCapacity: "0:00",
      billableActual: "0:00",
      training: "0:00"
    },
    valueSummary: {
      revenueUsd: 0,
      revenueBrl: 0
    },
    costSummary: {
      costBrl: 0
    },
    resultSummary: {
      resultBrl: 0,
      marginPercent: 0
    },
    rows: [],
    parameters: []
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
  const status = normalizeFinanceRecordStatus(record.status) || "PROJECAO";
  return {
    id: record.id,
    invoiceCycleMonth: record.invoiceCycleMonth,
    invoiceCycleLabel: formatReferenceMonth(record.invoiceCycleMonth),
    costCenter: record.costCenter,
    status,
    statusLabel: financeRecordStatusLabel(status),
    maxHoursCapacityMinutes: record.maxHoursCapacityMinutes,
    maxHoursCapacity: minutesToHours(record.maxHoursCapacityMinutes),
    billableHoursTargetMinutes: record.billableHoursTargetMinutes,
    billableHoursTarget: minutesToHours(record.billableHoursTargetMinutes),
    billableHoursActualMinutes: record.billableHoursActualMinutes,
    billableHoursActual: minutesToHours(record.billableHoursActualMinutes),
    trainingHoursMinutes: record.trainingHoursMinutes,
    trainingHours: minutesToHours(record.trainingHoursMinutes),
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

type FinanceParameterLike = {
  id?: string;
  invoiceCycleMonth: string;
  costCenter: string;
  kwaiHourlyUsd: Prisma.Decimal | number;
  globalHourlyUsd: Prisma.Decimal | number;
  trainingHourlyUsd: Prisma.Decimal | number;
  exchangeRateUsdBrl: Prisma.Decimal | number;
  notes?: string | null;
  updatedAt?: Date;
};

type FinanceBillingBucket = {
  invoiceCycleMonth: string;
  costCenter: string;
  approvedMinutes: number;
  projectedMinutes: number;
  approvedCostBrl: number;
  projectedCostBrl: number;
  grossAmountBrl: number;
  finalAmountBrl: number;
};

type FinanceScheduleBucket = {
  invoiceCycleMonth: string;
  costCenter: string;
  projectableMinutes: number;
  scheduledOpenMinutes: number;
  presentMinutes: number;
  dayOffSaleMinutes: number;
  absenceMinutes: number;
  trainingMinutes: number;
};

type FinanceActualScheduleBucket = {
  invoiceCycleMonth: string;
  costCenter: string;
  elapsedProjectableMinutes: number;
  elapsedAbsenceMinutes: number;
};

type FinanceApprovedHoursBucket = {
  invoiceCycleMonth: string;
  costCenter: string;
  approvedMinutes: number;
};

function mapFinanceiroParameter(parameter: FinanceParameterLike, isDefault = false) {
  return {
    id: parameter.id ?? "",
    invoiceCycleMonth: parameter.invoiceCycleMonth,
    invoiceCycleLabel: formatReferenceMonth(parameter.invoiceCycleMonth),
    costCenter: parameter.costCenter,
    kwaiHourlyUsd: round4(Number(parameter.kwaiHourlyUsd)),
    globalHourlyUsd: round4(Number(parameter.globalHourlyUsd)),
    trainingHourlyUsd: round4(Number(parameter.trainingHourlyUsd)),
    exchangeRateUsdBrl: round4(Number(parameter.exchangeRateUsdBrl)),
    notes: parameter.notes ?? "",
    updatedAt: parameter.updatedAt ? formatDateTime(parameter.updatedAt) : "",
    isDefault
  };
}

function defaultFinanceParameter(invoiceCycleMonth: string, costCenter: string): FinanceParameterLike {
  return {
    invoiceCycleMonth,
    costCenter,
    kwaiHourlyUsd: FINANCEIRO_DEFAULT_KWAI_HOURLY_USD,
    globalHourlyUsd: FINANCEIRO_DEFAULT_GLOBAL_HOURLY_USD,
    trainingHourlyUsd: FINANCEIRO_DEFAULT_TRAINING_HOURLY_USD,
    exchangeRateUsdBrl: 0,
    notes: null
  };
}

function groupBillingFinanceRows(
  invoices: Array<{
    referenceMonth: string;
    approvedMinutes: number;
    projectedMinutes: number;
    hourlyRate: Prisma.Decimal | number;
    grossAmount: Prisma.Decimal | number;
    finalAmount: Prisma.Decimal | number;
    employee: { lob: { name: string } };
  }>,
  cyclesByMonth: Map<string, { referenceMonth: string; status: string; closedAt: Date | null }>
) {
  const buckets = new Map<string, FinanceBillingBucket>();
  for (const invoice of invoices) {
    const costCenter = normalizeFinanceCostCenter(invoice.employee.lob.name);
    if (!costCenter) continue;
    const key = financeRecordKey(invoice.referenceMonth, costCenter);
    const bucket = buckets.get(key) ?? emptyBillingBucket(invoice.referenceMonth, costCenter);
    const closedMonth = isFinanceMonthClosed(invoice.referenceMonth, cyclesByMonth.get(invoice.referenceMonth));
    const hourlyRate = Number(invoice.hourlyRate);
    const approvedMinutes = Math.max(0, invoice.approvedMinutes);
    const projectedMinutes = closedMonth ? 0 : Math.max(0, invoice.projectedMinutes);
    bucket.approvedMinutes += approvedMinutes;
    bucket.projectedMinutes += projectedMinutes;
    bucket.approvedCostBrl = roundMoney(bucket.approvedCostBrl + (approvedMinutes / 60) * hourlyRate);
    bucket.projectedCostBrl = roundMoney(bucket.projectedCostBrl + (projectedMinutes / 60) * hourlyRate);
    bucket.grossAmountBrl = roundMoney(bucket.grossAmountBrl + Number(invoice.grossAmount));
    bucket.finalAmountBrl = roundMoney(bucket.finalAmountBrl + Number(invoice.finalAmount));
    buckets.set(key, bucket);
  }
  return buckets;
}

async function listFinanceiroProjectionSchedules(months: string[], selectedCostCenter: string) {
  const openMonths = months.filter((month) => !isFinanceMonthClosed(month));
  if (!openMonths.length) return [];
  const periods = openMonths.map(monthPeriod);
  const start = new Date(Math.min(...periods.map((period) => period.start.getTime())));
  const end = new Date(Math.max(...periods.map((period) => period.end.getTime())));
  return prisma.schedule.findMany({
    where: {
      deletedAt: null,
      date: { gte: start, lte: end },
      status: { in: [...FINANCEIRO_PROJECTABLE_SCHEDULE_STATUSES, ...FINANCEIRO_ABSENCE_SCHEDULE_STATUSES, ...FINANCEIRO_TRAINING_SCHEDULE_STATUSES] },
      employee: financeEmployeeWhere(selectedCostCenter)
    },
    select: {
      employeeId: true,
      date: true,
      status: true,
      employee: { select: { lob: { select: { name: true } } } }
    }
  });
}

async function listFinanceiroApprovedWorkHours(months: string[], selectedCostCenter: string) {
  if (!months.length) return [];
  const periods = months.map(monthPeriod);
  const start = new Date(Math.min(...periods.map((period) => period.start.getTime())));
  const end = new Date(Math.max(...periods.map((period) => period.end.getTime())));
  return prisma.workHourRecord.findMany({
    where: {
      date: { gte: start, lte: end },
      status: { in: FINANCEIRO_APPROVED_WORK_HOUR_STATUSES },
      employee: financeEmployeeWhere(selectedCostCenter)
    },
    select: {
      employeeId: true,
      date: true,
      effectiveHours: true,
      employee: { select: { lob: { select: { name: true } } } }
    }
  });
}

function groupFinanceSchedules(
  schedules: Array<{ employeeId: string; date: Date; status: string; employee: { lob: { name: string } } }>,
  cyclesByMonth: Map<string, { referenceMonth: string; status: string; closedAt: Date | null }>,
  workedDayKeys: Set<string>,
  projectionStartDateKey: string
) {
  const futureBuckets = new Map<string, FinanceScheduleBucket>();
  const actualBuckets = new Map<string, FinanceActualScheduleBucket>();
  for (const schedule of schedules) {
    const invoiceCycleMonth = schedule.date.toISOString().slice(0, 7);
    if (isFinanceMonthClosed(invoiceCycleMonth, cyclesByMonth.get(invoiceCycleMonth))) continue;
    const costCenter = normalizeFinanceCostCenter(schedule.employee.lob.name);
    if (!costCenter) continue;
    const key = financeRecordKey(invoiceCycleMonth, costCenter);
    const minutes = 480;
    const scheduleDateKey = formatFinanceDateKey(schedule.date);
    if (scheduleDateKey <= projectionStartDateKey) {
      const bucket = actualBuckets.get(key) ?? emptyActualScheduleBucket(invoiceCycleMonth, costCenter);
      if ((FINANCEIRO_PROJECTABLE_SCHEDULE_STATUSES as readonly string[]).includes(schedule.status)) bucket.elapsedProjectableMinutes += minutes;
      if ((FINANCEIRO_ABSENCE_SCHEDULE_STATUSES as readonly string[]).includes(schedule.status)) bucket.elapsedAbsenceMinutes += minutes;
      actualBuckets.set(key, bucket);
      continue;
    }
    if (workedDayKeys.has(financeEmployeeDateKey(schedule.employeeId, schedule.date))) continue;
    const bucket = futureBuckets.get(key) ?? emptyScheduleBucket(invoiceCycleMonth, costCenter);
    if (schedule.status === "ESCALADO") bucket.scheduledOpenMinutes += minutes;
    if (schedule.status === "PRESENTE") bucket.presentMinutes += minutes;
    if (schedule.status === "VENDA_FOLGA_APROVADA") bucket.dayOffSaleMinutes += minutes;
    if ((FINANCEIRO_PROJECTABLE_SCHEDULE_STATUSES as readonly string[]).includes(schedule.status)) bucket.projectableMinutes += minutes;
    if ((FINANCEIRO_ABSENCE_SCHEDULE_STATUSES as readonly string[]).includes(schedule.status)) bucket.absenceMinutes += minutes;
    if ((FINANCEIRO_TRAINING_SCHEDULE_STATUSES as readonly string[]).includes(schedule.status)) bucket.trainingMinutes += minutes;
    futureBuckets.set(key, bucket);
  }
  return { futureBuckets, actualBuckets };
}

function groupFinanceApprovedWorkHours(workHours: Array<{ employeeId: string; date: Date; effectiveHours: number; employee: { lob: { name: string } } }>) {
  const buckets = new Map<string, FinanceApprovedHoursBucket>();
  const workedDayKeys = new Set<string>();
  for (const record of workHours) {
    const invoiceCycleMonth = record.date.toISOString().slice(0, 7);
    const costCenter = normalizeFinanceCostCenter(record.employee.lob.name);
    if (!costCenter) continue;
    const key = financeRecordKey(invoiceCycleMonth, costCenter);
    const dayKey = financeEmployeeDateKey(record.employeeId, record.date);
    const bucket = buckets.get(key) ?? { invoiceCycleMonth, costCenter, approvedMinutes: 0 };
    bucket.approvedMinutes += Math.max(0, Math.round(Number(record.effectiveHours ?? 0) * 60));
    workedDayKeys.add(dayKey);
    buckets.set(key, bucket);
  }
  return { buckets, workedDayKeys };
}

function financeEmployeeDateKey(employeeId: string, date: Date) {
  return `${employeeId}:${formatFinanceDateKey(date)}`;
}

function formatFinanceDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function currentSaoPauloDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? String(date.getUTCFullYear());
  const month = parts.find((part) => part.type === "month")?.value ?? String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = parts.find((part) => part.type === "day")?.value ?? String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function emptyBillingBucket(invoiceCycleMonth: string, costCenter: string): FinanceBillingBucket {
  return {
    invoiceCycleMonth,
    costCenter,
    approvedMinutes: 0,
    projectedMinutes: 0,
    approvedCostBrl: 0,
    projectedCostBrl: 0,
    grossAmountBrl: 0,
    finalAmountBrl: 0
  };
}

function emptyScheduleBucket(invoiceCycleMonth: string, costCenter: string): FinanceScheduleBucket {
  return {
    invoiceCycleMonth,
    costCenter,
    projectableMinutes: 0,
    scheduledOpenMinutes: 0,
    presentMinutes: 0,
    dayOffSaleMinutes: 0,
    absenceMinutes: 0,
    trainingMinutes: 0
  };
}

function emptyActualScheduleBucket(invoiceCycleMonth: string, costCenter: string): FinanceActualScheduleBucket {
  return {
    invoiceCycleMonth,
    costCenter,
    elapsedProjectableMinutes: 0,
    elapsedAbsenceMinutes: 0
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
  if (fieldName === "status") return financeRecordStatusLabel(String(record[fieldName] ?? ""));
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

function monthPeriod(referenceMonth: string) {
  const [year, month] = referenceMonth.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  return { start, end };
}

function isFinanceMonthClosed(month: string, cycle?: { status?: string | null; closedAt?: Date | null } | null) {
  if (!month) return true;
  if (month < currentReferenceMonth()) return true;
  if (cycle?.closedAt) return true;
  return cycle?.status ? FINANCEIRO_CLOSED_BILLING_STATUSES.has(cycle.status) : false;
}

function parseDisplayMinutes(value: string) {
  const sign = value.startsWith("-") ? -1 : 1;
  const clean = value.replace(/^[+-]/, "");
  const [hours, minutes] = clean.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0;
  return sign * (hours * 60 + minutes);
}

function parseMoneyNumber(value: unknown, fallback?: number): number | null {
  if (isEmpty(value)) return fallback ?? null;
  if (typeof value === "number") return Number.isFinite(value) ? round4(value) : null;
  const parsed = Number(text(value).replace(/\s/g, "").replace("R$", "").replace("$", "").replace(",", "."));
  return Number.isFinite(parsed) ? round4(parsed) : null;
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

function parseOptionalHours(value: unknown, label: string): number | string {
  if (isEmpty(value)) return 0;
  const parsed = parseHours(value);
  return parsed === null ? `${label} inválido.` : parsed;
}

function parsePercent(value: unknown): number | null {
  if (isEmpty(value)) return null;
  if (typeof value === "number" && Number.isFinite(value)) return round2(value);
  const parsed = Number(text(value).replace("%", "").replace(",", ".").trim());
  return Number.isFinite(parsed) ? round2(parsed) : null;
}

function normalizeFinanceRecordStatus(value?: unknown): FinanceiroRecordStatus | "" {
  const normalized = text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!normalized) return "PROJECAO";
  if (["projecao", "projection", "projetado", "projetada"].includes(normalized)) return "PROJECAO";
  if (["em_validacao", "validacao", "em_revisao", "revisao", "validation", "review"].includes(normalized)) return "EM_VALIDACAO";
  if (["fechado", "closed", "finalizado"].includes(normalized)) return "FECHADO";
  return "";
}

function financeRecordStatusLabel(value?: string | null) {
  const status = normalizeFinanceRecordStatus(value) || "PROJECAO";
  if (status === "FECHADO") return "Fechado";
  if (status === "EM_VALIDACAO") return "Em validação";
  return "Projeção";
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

function decimal4(value: number) {
  return new Prisma.Decimal(round4(value).toFixed(4));
}

function round4(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 10000) / 10000;
}

function roundMoney(value: number) {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
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

function unique<T>(items: T[]) {
  return Array.from(new Set(items.filter(Boolean)));
}
