import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const dryRun = args.has("--dry-run") || !apply;

const autoFixToActiveStatuses = [
  "Escalado",
  "ESCALADO",
  "Presente",
  "PRESENTE",
  "Falta",
  "FALTA",
  "Ausente",
  "AUSENTE",
  "Folga",
  "FOLGA",
  "Férias",
  "FERIAS",
  "Atraso",
  "ATRASO",
  "Saída antecipada",
  "SAIDA_ANTECIPADA",
  "Troca aprovada",
  "TROCA_APROVADA",
  "Venda de folga aprovada",
  "VENDA_FOLGA_APROVADA",
  "Folga aprovada",
  "FOLGA_APROVADA",
  "Sem escala",
  "SEM_ESCALA",
  "Sem cronograma",
  "Erro de escala",
  "Erro de cronograma",
  "ERRO_ESCALA",
  "Feriado",
  "FERIADO",
  "Conflito",
  "CONFLITO",
  "Descoberto",
  "DESCOBERTO"
];

const manualReviewStatuses = [
  "Afastado",
  "AFASTADO",
  "Treinamento",
  "TREINAMENTO"
];

function statusWhere(statuses: string[]) {
  return {
    OR: statuses.map((status) => ({
      operationalStatus: { equals: status, mode: "insensitive" as const }
    }))
  };
}

function summarizeRows(rows: Array<{ id: string; wbLogin: string; fullName: string; operationalStatus: string; deletedAt: Date | null }>, suggestion: string) {
  return rows.slice(0, 50).map((row) => ({
    id: row.id,
    wbLogin: row.wbLogin,
    nome: row.fullName,
    statusAtual: row.operationalStatus,
    sugestao: suggestion
  }));
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

async function main() {
  const [fixableRows, reviewRows] = await Promise.all([
    prisma.employeeProfile.findMany({
      where: {
        deletedAt: null,
        ...statusWhere(autoFixToActiveStatuses)
      },
      select: { id: true, wbLogin: true, fullName: true, operationalStatus: true, deletedAt: true },
      orderBy: [{ operationalStatus: "asc" }, { fullName: "asc" }]
    }),
    prisma.employeeProfile.findMany({
      where: {
        OR: [
          { deletedAt: { not: null }, ...statusWhere(autoFixToActiveStatuses) },
          statusWhere(manualReviewStatuses)
        ]
      },
      select: { id: true, wbLogin: true, fullName: true, operationalStatus: true, deletedAt: true },
      orderBy: [{ operationalStatus: "asc" }, { fullName: "asc" }]
    })
  ]);

  const summary = {
    corrigiveisParaAtivo: fixableRows.length,
    requeremRevisaoManual: reviewRows.length,
    totalEncontrado: fixableRows.length + reviewRows.length
  };

  if (dryRun) {
    console.log("Dry-run de reconciliação de status do colaborador. Nada foi alterado.");
    console.table(summary);
    if (fixableRows.length) {
      console.log("Colaboradores que podem ser corrigidos automaticamente para Ativo:");
      console.table(summarizeRows(fixableRows, "Ativo"));
      if (fixableRows.length > 50) console.log(`Exibindo 50 de ${fixableRows.length} registros corrigíveis.`);
    }
    if (reviewRows.length) {
      console.log("Colaboradores com status ambíguo ou cadastro removido que exigem revisão manual:");
      console.table(summarizeRows(reviewRows, "Revisar manualmente"));
      if (reviewRows.length > 50) console.log(`Exibindo 50 de ${reviewRows.length} registros para revisão.`);
    }
    console.log("Para aplicar somente as correções seguras: npm run db:reconcile-employee-status -- --apply");
    return;
  }

  const now = new Date();
  let updatedCount = 0;

  await prisma.$transaction(async (tx) => {
    for (const chunk of chunkArray(fixableRows, 500)) {
      const updated = await tx.employeeProfile.updateMany({
        where: { id: { in: chunk.map((row) => row.id) } },
        data: { operationalStatus: "Ativo", updatedAt: now }
      });
      updatedCount += updated.count;
    }

    await tx.auditLog.create({
      data: {
        action: "EDICAO",
        entity: "EmployeeProfile",
        reason: "RECONCILE_EMPLOYEE_STATUS_FROM_SCHEDULE_STATUS",
        previousValue: {
          autoFixToActiveStatuses,
          manualReviewStatuses,
          fixableCount: fixableRows.length,
          manualReviewCount: reviewRows.length
        },
        newValue: {
          statusAplicado: "Ativo",
          corrigidos: updatedCount,
          mantidosParaRevisaoManual: reviewRows.length
        }
      }
    });
  });

  console.log("Reconciliação de status do colaborador aplicada.");
  console.table({
    corrigidosParaAtivo: updatedCount,
    mantidosParaRevisaoManual: reviewRows.length
  });
  if (reviewRows.length) {
    console.log("Ainda existem registros ambíguos para revisar manualmente:");
    console.table(summarizeRows(reviewRows, "Revisar manualmente"));
  }
}

main()
  .catch((error) => {
    console.error("Falha ao reconciliar status do colaborador.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
