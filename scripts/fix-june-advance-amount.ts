import { Prisma, PrismaClient } from "@prisma/client";

import { MONTHLY_ADVANCE_FIXED_AMOUNT } from "../src/lib/monthly-advance-constants";

const prisma = new PrismaClient();

const REFERENCE_MONTH = "2026-06";
const args = new Set(process.argv.slice(2));
const allowedArgs = new Set(["--dry-run", "--apply"]);
const unknownArgs = Array.from(args).filter((arg) => !allowedArgs.has(arg));
const apply = args.has("--apply");
const dryRun = args.has("--dry-run");

function printUsage() {
  console.error("Use: npm run db:fix-june-advance-amount -- --dry-run");
  console.error(" ou: npm run db:fix-june-advance-amount -- --apply");
}

function decimal(value: number) {
  return new Prisma.Decimal(value.toFixed(2));
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

  const records = await prisma.monthlyAdvanceRecord.findMany({
    where: {
      referenceMonth: REFERENCE_MONTH,
      optIn: true,
      status: { not: "REMOVED" }
    },
    select: {
      id: true,
      employeeId: true,
      amount: true,
      finalAmount: true,
      hasDiscount: true,
      discountAmount: true,
      discountReason: true,
      employee: {
        select: {
          fullName: true,
          wbLogin: true
        }
      }
    },
    orderBy: { employee: { fullName: "asc" } }
  });

  const toUpdate = records.filter((record) =>
    Number(record.amount) !== MONTHLY_ADVANCE_FIXED_AMOUNT ||
    Number(record.finalAmount) !== MONTHLY_ADVANCE_FIXED_AMOUNT ||
    record.hasDiscount ||
    record.discountAmount !== null ||
    Boolean(record.discountReason)
  );

  console.table({
    "Mês de referência": REFERENCE_MONTH,
    "Aderentes encontrados": records.length,
    "Aderentes com valor diferente de R$300": toUpdate.length,
    "Aderentes que seriam atualizados": toUpdate.length
  });

  if (!toUpdate.length) {
    console.log("Nenhum registro de Junho precisa de correção.");
    return;
  }

  console.log("Primeiros registros que serão ajustados:");
  console.table(toUpdate.slice(0, 20).map((record) => ({
    wb_login: record.employee.wbLogin,
    nome: record.employee.fullName,
    valor_atual: Number(record.amount),
    valor_novo: MONTHLY_ADVANCE_FIXED_AMOUNT
  })));

  if (dryRun) {
    console.log("Dry-run concluído. Nada foi alterado.");
    console.log("Para aplicar: npm run db:fix-june-advance-amount -- --apply");
    return;
  }

  const ids = toUpdate.map((record) => record.id);
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.monthlyAdvanceRecord.updateMany({
      where: { id: { in: ids } },
      data: {
        amount: decimal(MONTHLY_ADVANCE_FIXED_AMOUNT),
        finalAmount: decimal(MONTHLY_ADVANCE_FIXED_AMOUNT),
        hasDiscount: false,
        discountAmount: null,
        discountReason: null
      }
    });
    await tx.auditLog.create({
      data: {
        actorId: null,
        action: "EDICAO",
        entity: "MonthlyAdvanceRecord",
        entityId: `FIX_JUNE_ADVANCE_AMOUNT_${REFERENCE_MONTH}`,
        reason: "FIX_JUNE_ADVANCE_AMOUNT",
        previousValue: {
          referenceMonth: REFERENCE_MONTH,
          affectedRecordIds: ids,
          count: toUpdate.length
        },
        newValue: {
          referenceMonth: REFERENCE_MONTH,
          amount: MONTHLY_ADVANCE_FIXED_AMOUNT,
          finalAmount: MONTHLY_ADVANCE_FIXED_AMOUNT,
          hasDiscount: false,
          count: updated.count,
          source: "scripts/fix-june-advance-amount.ts"
        }
      }
    });
    return updated;
  });

  console.log(`Registros de Junho aderentes atualizados para R$300,00: ${result.count}.`);
}

main()
  .catch((error) => {
    console.error("Falha ao corrigir valores de adiantamento de Junho.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
