import { AuditAction, PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const dryRun = args.includes("--dry-run") || !apply;
const fileArg = argValue("--file") ?? "/Users/lucaskawakami/Downloads/Quality.xlsx";
const wbFilter = normalizeWbLogin(argValue("--wb"));

type ParsedQualityRow = {
  rowNumber: number;
  wbLogin: string;
  employeeId: string;
  lobId: string | null;
  auditTime: Date;
  auditDate: Date;
  finalResult: string;
  caseOrderId: string;
  auditCaseOrderId: string;
  concatKey: string;
  rawLob: string | null;
  signature: string;
};

function argValue(name: string) {
  const exact = args.findIndex((arg) => arg === name);
  if (exact >= 0) return args[exact + 1];
  const prefixed = args.find((arg) => arg.startsWith(`${name}=`));
  return prefixed ? prefixed.slice(name.length + 1) : undefined;
}

function normalizeWbLogin(value?: string | null) {
  return String(value ?? "").trim().toLowerCase();
}

function text(value: unknown) {
  if (value === null || typeof value === "undefined") return "";
  return String(value).trim();
}

function normalizeKey(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

function normalizeObjectKeys(row: Record<string, unknown>) {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) normalized[normalizeKey(key)] = value;
  return normalized;
}

function rowValue(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const normalizedKey = normalizeKey(key);
    if (Object.prototype.hasOwnProperty.call(row, normalizedKey)) return row[normalizedKey];
  }
  return "";
}

function normalizeExcelDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate(), value.getHours(), value.getMinutes(), value.getSeconds()));
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(Date.UTC(1899, 11, 30));
    date.setUTCDate(date.getUTCDate() + Math.floor(value));
    const fraction = value - Math.floor(value);
    if (fraction > 0) date.setUTCSeconds(Math.round(fraction * 24 * 60 * 60));
    return date;
  }
  const raw = text(value);
  if (!raw) return null;
  const br = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (br) return new Date(Date.UTC(Number(br[3]), Number(br[2]) - 1, Number(br[1]), Number(br[4] ?? 0), Number(br[5] ?? 0), Number(br[6] ?? 0)));
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (iso) return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), Number(iso[4] ?? 0), Number(iso[5] ?? 0), Number(iso[6] ?? 0)));
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateOnly(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function formatDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function buildQualityTaskKey(caseOrderId: string, auditCaseOrderId: string) {
  return caseOrderId && auditCaseOrderId ? `${caseOrderId}${auditCaseOrderId}` : "";
}

function rowSignature(row: {
  employeeId: string | null;
  auditDate?: Date;
  auditTime?: Date;
  finalResult: string;
  caseOrderId: string;
  auditCaseOrderId: string;
}) {
  const date = row.auditDate ?? (row.auditTime ? dateOnly(row.auditTime) : null);
  return [
    row.employeeId ?? "",
    date ? formatDateKey(date) : "",
    row.finalResult.trim(),
    row.caseOrderId.trim(),
    row.auditCaseOrderId.trim()
  ].join("|");
}

function increment(map: Map<string, number>, key: string, amount = 1) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function decrement(map: Map<string, number>, key: string) {
  const current = map.get(key) ?? 0;
  if (current <= 1) map.delete(key);
  else map.set(key, current - 1);
}

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}

function readWorkbookRows(filePath: string) {
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const preferred = ["qualidade", "quality", "plan1"];
  const sheetName = workbook.SheetNames.find((name) => preferred.includes(normalizeKey(name))) ?? workbook.SheetNames[0];
  if (!sheetName) throw new Error("Planilha de Qualidade não encontrada.");
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], { defval: "" }).map(normalizeObjectKeys);
}

async function main() {
  const rawRows = readWorkbookRows(fileArg);
  const wbLogins = unique(rawRows.map((row) => normalizeWbLogin(text(rowValue(row, ["audit_name", "audit name", "wb_login", "wb login"])))).filter(Boolean))
    .filter((wbLogin) => !wbFilter || wbLogin === wbFilter);
  const employees = await prisma.employeeProfile.findMany({
    where: { deletedAt: null, OR: wbLogins.map((wbLogin) => ({ wbLogin: { equals: wbLogin, mode: "insensitive" } })) },
    include: { lob: true }
  });
  const employeeByLogin = new Map(employees.map((employee) => [normalizeWbLogin(employee.wbLogin), employee]));

  const parsedRows: ParsedQualityRow[] = [];
  const invalidRows: Array<{ rowNumber: number; wbLogin: string; errors: string[] }> = [];

  rawRows.forEach((row, index) => {
    const rowNumber = index + 2;
    const wbLogin = normalizeWbLogin(text(rowValue(row, ["audit_name", "audit name", "wb_login", "wb login"])));
    if (wbFilter && wbLogin !== wbFilter) return;
    const employee = employeeByLogin.get(wbLogin);
    const auditTime = normalizeExcelDate(rowValue(row, ["audit_time", "audit_time(年月日)", "audit time", "data"]));
    const finalResult = text(rowValue(row, ["final_result", "final result", "resultado"]));
    const caseOrderId = text(rowValue(row, ["质检case_order_id", "case_order_id", "case order id"]));
    const auditCaseOrderId = text(rowValue(row, ["audit_case_order_id", "audit case order id"]));
    const rawConcat = text(rowValue(row, ["concat"]));
    const concatKey = rawConcat || buildQualityTaskKey(caseOrderId, auditCaseOrderId);
    const rawLob = text(rowValue(row, ["lob"]));
    const errors: string[] = [];

    if (!wbLogin) errors.push("WB/Login é obrigatório.");
    else if (!employee) errors.push("WB/Login não encontrado no cadastro.");
    if (!auditTime) errors.push("Data da auditoria inválida.");
    if (!caseOrderId) errors.push("Case Order ID é obrigatório.");
    if (!auditCaseOrderId) errors.push("Audit Case Order ID é obrigatório.");
    if (!concatKey) errors.push("Concat inválido.");
    if (errors.length || !employee || !auditTime) {
      invalidRows.push({ rowNumber, wbLogin, errors });
      return;
    }

    const parsed = {
      rowNumber,
      wbLogin,
      employeeId: employee.id,
      lobId: employee.lobId,
      auditTime,
      auditDate: dateOnly(auditTime),
      finalResult,
      caseOrderId,
      auditCaseOrderId,
      concatKey,
      rawLob: rawLob || employee.lob?.name || null,
      signature: ""
    };
    parsed.signature = rowSignature(parsed);
    parsedRows.push(parsed);
  });

  const desiredCounts = new Map<string, number>();
  for (const row of parsedRows) increment(desiredCounts, row.signature);

  const employeeIds = unique(parsedRows.map((row) => row.employeeId));
  const minDate = parsedRows.reduce<Date | null>((min, row) => !min || row.auditDate < min ? row.auditDate : min, null);
  const maxDate = parsedRows.reduce<Date | null>((max, row) => !max || row.auditDate > max ? row.auditDate : max, null);
  const existing = employeeIds.length && minDate && maxDate
    ? await prisma.qualityRecord.findMany({
      where: { employeeId: { in: employeeIds }, auditDate: { gte: minDate, lte: maxDate } },
      select: { employeeId: true, auditTime: true, finalResult: true, caseOrderId: true, auditCaseOrderId: true, concatKey: true }
    })
    : [];

  const existingCounts = new Map<string, number>();
  for (const row of existing) increment(existingCounts, rowSignature(row));

  const rowsToInsert: ParsedQualityRow[] = [];
  const availableExisting = new Map(existingCounts);
  for (const row of parsedRows) {
    const count = availableExisting.get(row.signature) ?? 0;
    if (count > 0) {
      decrement(availableExisting, row.signature);
    } else {
      rowsToInsert.push(row);
    }
  }

  const gleiceRows = parsedRows.filter((row) => row.wbLogin === "wb_gleice");
  const gleiceMissingRows = rowsToInsert.filter((row) => row.wbLogin === "wb_gleice");
  console.log("Reconciliação de Performance/Qualidade por XLSX.");
  console.log(`Arquivo: ${fileArg}`);
  console.log(`Modo: ${dryRun ? "dry-run" : "apply"}`);
  if (wbFilter) console.log(`Filtro WB/Login: ${wbFilter}`);
  console.table({
    linhasArquivo: rawRows.length,
    linhasValidasConsideradas: parsedRows.length,
    linhasInvalidas: invalidRows.length,
    registrosExistentesNoBanco: existing.length,
    linhasFaltantesParaInserir: rowsToInsert.length,
    gleiceLinhasArquivo: gleiceRows.length,
    gleiceLinhasFaltantes: gleiceMissingRows.length
  });

  if (invalidRows.length) {
    console.log("Primeiras linhas inválidas:");
    console.table(invalidRows.slice(0, 20).map((row) => ({ linha: row.rowNumber, wb_login: row.wbLogin, erros: row.errors.join("; ") })));
  }
  if (gleiceMissingRows.length) {
    console.log("Linhas da Gleice que faltam no banco:");
    console.table(gleiceMissingRows.map((row) => ({
      linha: row.rowNumber,
      data: formatDateKey(row.auditDate),
      final_result: row.finalResult,
      case_order_id: row.caseOrderId,
      audit_case_order_id: row.auditCaseOrderId,
      concat: row.concatKey
    })));
  }

  if (dryRun) {
    console.log("Dry-run: nada foi alterado.");
    console.log("Para aplicar: npm run db:reconcile-performance-quality -- --apply --file \"/caminho/Quality.xlsx\"");
    return;
  }

  if (!rowsToInsert.length) {
    console.log("Nenhuma linha faltante para inserir.");
    return;
  }

  const systemUser = await prisma.user.findFirst({
    where: { deletedAt: null, role: { name: { in: ["ADMIN", "WFM"] } } },
    orderBy: { createdAt: "asc" },
    select: { id: true }
  });

  const batch = await prisma.performanceImportBatch.create({
    data: {
      type: "QUALITY",
      fileName: fileArg.split(/[\\/]/).at(-1) ?? "Quality.xlsx",
      rowsTotal: rawRows.length,
      rowsValid: parsedRows.length,
      rowsError: invalidRows.length,
      rowsInserted: rowsToInsert.length,
      rowsUpdated: 0,
      status: invalidRows.length ? "PARTIAL" : "SUCCESS",
      errorSummary: invalidRows.slice(0, 20).map((row) => `Linha ${row.rowNumber}: ${row.errors.join("; ")}`).join(" | ") || null,
      importedById: systemUser?.id
    }
  });

  for (let index = 0; index < rowsToInsert.length; index += 500) {
    const chunk = rowsToInsert.slice(index, index + 500);
    await prisma.qualityRecord.createMany({
      data: chunk.map((row) => ({
        auditTime: row.auditTime,
        auditDate: row.auditDate,
        wbLogin: row.wbLogin,
        employeeId: row.employeeId,
        finalResult: row.finalResult,
        caseOrderId: row.caseOrderId,
        auditCaseOrderId: row.auditCaseOrderId,
        concatKey: row.concatKey,
        lobId: row.lobId,
        rawLob: row.rawLob,
        importBatchId: batch.id
      }))
    });
  }

  await prisma.auditLog.create({
    data: {
      actorId: systemUser?.id,
      action: AuditAction.IMPORTACAO,
      entity: "QualityRecord",
      entityId: batch.id,
      reason: "RECONCILE_PERFORMANCE_QUALITY_FROM_XLSX",
      newValue: {
        file: fileArg,
        insertedRows: rowsToInsert.length,
        invalidRows: invalidRows.length,
        wbFilter: wbFilter || null,
        origin: "script"
      }
    }
  });

  console.log("Reconciliação aplicada.");
  console.log(`Linhas inseridas: ${rowsToInsert.length}`);
}

main()
  .catch((error) => {
    console.error("Falha ao reconciliar Performance/Qualidade.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
