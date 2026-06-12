import { Prisma, PrismaClient } from "@prisma/client";

import { maskPixKey, standardizeExistingPixKey } from "../src/lib/pix-key";

const prisma = new PrismaClient();
const args = new Set(process.argv.slice(2));
const allowedArgs = new Set(["--dry-run", "--apply"]);
const unknownArgs = Array.from(args).filter((arg) => !allowedArgs.has(arg));
const apply = args.has("--apply");
const dryRun = args.has("--dry-run");

type EmployeeRow = {
  id: string;
  fullName: string;
  wbLogin: string;
  pixKey: string | null;
  pixKeyType: string | null;
};

type SensitiveRow = {
  employeeId: string;
  bankData: Prisma.JsonValue;
};

type AnalysisRow = {
  employee: EmployeeRow;
  sensitive?: SensitiveRow;
  bankData: Record<string, unknown>;
  sourcePixKey: string;
  sourcePixKeyType: string;
  normalizedPixKey: string;
  normalizedPixKeyType: string;
  status: string;
  action: "Manter" | "Normalizar" | "Correção manual necessária";
  message: string;
  updateProfile: boolean;
  updateBankData: boolean;
};

function printUsage() {
  console.error("Use: npm run db:standardize-pix-keys -- --dry-run");
  console.error(" ou: npm run db:standardize-pix-keys -- --apply");
}

function asRecord(value: Prisma.JsonValue | undefined): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function jsonText(value: unknown) {
  return typeof value === "string" ? value : "";
}

function pixText(value: unknown) {
  const text = jsonText(value).trim();
  const comparable = text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
  if (!text || ["nao informado", "nao informada", "n/a", "na", "-"].includes(comparable)) return "";
  return text;
}

function hasPixData(row: SensitiveRow) {
  const bankData = asRecord(row.bankData);
  return Boolean(pixText(bankData.pixKey) || pixText(bankData.pixKeyType));
}

function analyzeEmployee(employee: EmployeeRow, sensitive?: SensitiveRow): AnalysisRow | null {
  const bankData = asRecord(sensitive?.bankData);
  const sourcePixKeyType = pixText(employee.pixKeyType) || pixText(bankData.pixKeyType);
  const sourcePixKey = pixText(employee.pixKey) || pixText(bankData.pixKey);
  if (!sourcePixKeyType && !sourcePixKey) return null;

  const validation = standardizeExistingPixKey(sourcePixKeyType, sourcePixKey);
  const normalizedPixKeyType = validation.pixKeyType;
  const normalizedPixKey = validation.normalizedValue;
  const updateProfile = validation.valid && ((employee.pixKey ?? "") !== normalizedPixKey || (employee.pixKeyType ?? "") !== normalizedPixKeyType);
  const updateBankData = validation.valid && Boolean(sensitive) && (jsonText(bankData.pixKey) !== normalizedPixKey || jsonText(bankData.pixKeyType) !== normalizedPixKeyType);
  const needsUpdate = updateProfile || updateBankData;

  return {
    employee,
    sensitive,
    bankData,
    sourcePixKey,
    sourcePixKeyType,
    normalizedPixKey,
    normalizedPixKeyType,
    status: validation.status,
    action: validation.valid ? (needsUpdate ? "Normalizar" : "Manter") : "Correção manual necessária",
    message: validation.message ?? (needsUpdate ? "Valor será padronizado." : "Valor já está padronizado."),
    updateProfile,
    updateBankData
  };
}

function reportRow(row: AnalysisRow) {
  return {
    nome: row.employee.fullName,
    wb_login: row.employee.wbLogin,
    tipo_chave_pix: row.sourcePixKeyType || "Não informado",
    chave_pix: maskPixKey(row.sourcePixKey, row.sourcePixKeyType) || "Não informada",
    status: row.status,
    acao: row.action,
    mensagem: row.message
  };
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

async function main() {
  if (unknownArgs.length || (apply && dryRun) || (!apply && !dryRun)) {
    if (unknownArgs.length) console.error(`Argumento(s) inválido(s): ${unknownArgs.join(", ")}`);
    if (apply && dryRun) console.error("Escolha apenas um modo: --dry-run ou --apply.");
    if (!apply && !dryRun) console.error("Informe o modo de execução.");
    printUsage();
    process.exitCode = 1;
    return;
  }

  const sensitiveRows = await prisma.employeeSensitiveData.findMany({
    select: {
      employeeId: true,
      bankData: true
    }
  });
  const sensitiveByEmployeeId = new Map(sensitiveRows.map((row) => [row.employeeId, row]));
  const sensitiveEmployeeIdsWithPix = sensitiveRows.filter(hasPixData).map((row) => row.employeeId);

  const employees = await prisma.employeeProfile.findMany({
    where: {
      OR: [
        { pixKey: { not: null } },
        { pixKeyType: { not: null } },
        { id: { in: sensitiveEmployeeIdsWithPix } }
      ]
    },
    select: {
      id: true,
      fullName: true,
      wbLogin: true,
      pixKey: true,
      pixKeyType: true
    },
    orderBy: { fullName: "asc" }
  });

  const analysis = employees
    .map((employee) => analyzeEmployee(employee, sensitiveByEmployeeId.get(employee.id)))
    .filter((row): row is AnalysisRow => Boolean(row));
  const toNormalize = analysis.filter((row) => row.action === "Normalizar");
  const invalidRows = analysis.filter((row) => row.action === "Correção manual necessária");
  const alreadyValid = analysis.filter((row) => row.action === "Manter");

  const summary = {
    "Total analisado": analysis.length,
    "Já padronizados": alreadyValid.length,
    "Normalizáveis com segurança": toNormalize.length,
    "Inválidos / revisão manual": invalidRows.length,
    "Sem tipo de chave": analysis.filter((row) => row.status === "MISSING_TYPE").length,
    "Sem chave": analysis.filter((row) => row.status === "MISSING_KEY").length
  };

  console.table(summary);
  if (analysis.length) {
    console.log("Amostra do relatório:");
    console.table(analysis.slice(0, 100).map(reportRow));
    if (analysis.length > 100) console.log(`Exibindo 100 de ${analysis.length} registros analisados.`);
  }

  if (dryRun) {
    console.log("Dry-run concluído. Nenhum dado foi alterado.");
    console.log("Para aplicar somente normalizações seguras: npm run db:standardize-pix-keys -- --apply");
    return;
  }

  let updatedProfiles = 0;
  let updatedSensitiveRows = 0;

  for (const chunk of chunkArray(toNormalize, 100)) {
    await prisma.$transaction(async (tx) => {
      for (const row of chunk) {
        if (row.updateProfile) {
          await tx.employeeProfile.update({
            where: { id: row.employee.id },
            data: {
              pixKey: row.normalizedPixKey,
              pixKeyType: row.normalizedPixKeyType
            }
          });
          updatedProfiles += 1;
        }

        if (row.updateBankData && row.sensitive) {
          await tx.employeeSensitiveData.update({
            where: { employeeId: row.employee.id },
            data: {
              bankData: {
                ...row.bankData,
                pixKey: row.normalizedPixKey,
                pixKeyType: row.normalizedPixKeyType
              }
            }
          });
          updatedSensitiveRows += 1;
        }
      }
    });
  }

  await prisma.auditLog.create({
    data: {
      actorId: null,
      action: "EDICAO",
      entity: "EmployeeProfile",
      entityId: "STANDARDIZE_PIX_KEYS",
      reason: "STANDARDIZE_PIX_KEYS",
      previousValue: {
        totalAnalyzed: analysis.length,
        normalizable: toNormalize.length,
        invalidManualReview: invalidRows.length
      },
      newValue: {
        updatedProfiles,
        updatedSensitiveRows,
        source: "scripts/standardize-pix-keys.ts",
        samples: toNormalize.slice(0, 20).map((row) => ({
          wbLogin: row.employee.wbLogin,
          typeBefore: row.sourcePixKeyType,
          typeAfter: row.normalizedPixKeyType,
          pixBeforeMasked: maskPixKey(row.sourcePixKey, row.sourcePixKeyType),
          pixAfterMasked: maskPixKey(row.normalizedPixKey, row.normalizedPixKeyType)
        }))
      }
    }
  });

  console.log("Padronização concluída.");
  console.table({
    "EmployeeProfile atualizados": updatedProfiles,
    "EmployeeSensitiveData.bankData atualizados": updatedSensitiveRows,
    "Mantidos para revisão manual": invalidRows.length
  });
  if (invalidRows.length) {
    console.log("Registros que ainda exigem correção manual:");
    console.table(invalidRows.slice(0, 100).map(reportRow));
  }
}

main()
  .catch((error) => {
    console.error("Falha ao padronizar Chaves PIX.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
