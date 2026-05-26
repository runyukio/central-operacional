import { PrismaClient } from "@prisma/client";

import { normalizeComparableJobTitle } from "../src/lib/job-title-normalization";

const prisma = new PrismaClient();

const args = new Set(process.argv.slice(2));
const allowedArgs = new Set(["--dry-run", "--apply"]);
const unknownArgs = Array.from(args).filter((arg) => !allowedArgs.has(arg));
const apply = args.has("--apply");
const dryRun = args.has("--dry-run");

function printUsage() {
  console.error("Use: npm run db:normalize-job-title-agente -- --dry-run");
  console.error(" ou: npm run db:normalize-job-title-agente -- --apply");
}

function countByRoleTitle(employees: Array<{ roleTitle: string }>) {
  return employees.reduce<Record<string, number>>((acc, employee) => {
    acc[employee.roleTitle] = (acc[employee.roleTitle] ?? 0) + 1;
    return acc;
  }, {});
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

  const candidates = await prisma.employeeProfile.findMany({
    where: {
      roleTitle: { contains: "moderador", mode: "insensitive" }
    },
    select: {
      id: true,
      fullName: true,
      wbLogin: true,
      roleTitle: true
    },
    orderBy: { fullName: "asc" }
  });
  const employeesToUpdate = candidates.filter((employee) => normalizeComparableJobTitle(employee.roleTitle) === "moderador de conteudo");
  const beforeByTitle = countByRoleTitle(employeesToUpdate);

  if (!employeesToUpdate.length) {
    console.log("Nenhum registro encontrado.");
    console.table({
      "Colaboradores com cargo Moderador de Conteúdo": 0,
      "Colaboradores que seriam atualizados para Agente": 0
    });
    return;
  }

  console.table({
    "Colaboradores com cargo Moderador de Conteúdo": employeesToUpdate.length,
    "Colaboradores que seriam atualizados para Agente": employeesToUpdate.length
  });
  console.log("Resumo por valor atual:");
  console.table(beforeByTitle);
  console.log("Primeiros registros:");
  console.table(employeesToUpdate.slice(0, 20).map((employee) => ({
    wb_login: employee.wbLogin,
    nome: employee.fullName,
    cargo_atual: employee.roleTitle,
    cargo_novo: "Agente"
  })));

  if (dryRun) {
    console.log("Dry-run concluído. Nada foi alterado.");
    console.log("Para aplicar: npm run db:normalize-job-title-agente -- --apply");
    return;
  }

  const ids = employeesToUpdate.map((employee) => employee.id);
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.employeeProfile.updateMany({
      where: { id: { in: ids } },
      data: { roleTitle: "Agente" }
    });
    await tx.auditLog.create({
      data: {
        actorId: null,
        action: "EDICAO",
        entity: "EmployeeProfile",
        entityId: "NORMALIZE_JOB_TITLE_AGENTE",
        reason: "NORMALIZE_JOB_TITLE",
        previousValue: {
          normalizedFrom: beforeByTitle,
          count: employeesToUpdate.length
        },
        newValue: {
          roleTitle: "Agente",
          count: updated.count,
          source: "scripts/normalize-job-title-agente.ts"
        }
      }
    });
    return updated;
  });

  console.log(`Atualização concluída. ${result.count} colaborador(es) alterado(s) para Agente.`);
}

main()
  .catch((error) => {
    console.error("Falha ao normalizar cargo/função para Agente.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
