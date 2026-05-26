import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const args = new Set(process.argv.slice(2));
const shouldApply = args.has("--apply");
const isDryRun = args.has("--dry-run") || !shouldApply;

async function main() {
  if (!isDryRun && !shouldApply) {
    throw new Error("Use --dry-run para simular ou --apply para aplicar.");
  }

  const employees = await prisma.employeeProfile.findMany({
    where: { deletedAt: null, managerId: { not: null } },
    select: {
      id: true,
      fullName: true,
      wbLogin: true,
      supervisorId: true,
      managerId: true,
      supervisor: { select: { fullName: true, wbLogin: true } },
      manager: { select: { fullName: true, wbLogin: true } }
    },
    orderBy: { fullName: "asc" }
  });

  const toCopy = employees.filter((employee) => employee.managerId && !employee.supervisorId);
  const conflicts = employees.filter((employee) => employee.managerId && employee.supervisorId && employee.managerId !== employee.supervisorId);
  const alreadySame = employees.filter((employee) => employee.managerId && employee.supervisorId && employee.managerId === employee.supervisorId);

  console.log("Migração managerId -> supervisorId");
  console.log(`Modo: ${shouldApply ? "APPLY" : "DRY-RUN"}`);
  console.log(`Registros com managerId: ${employees.length}`);
  console.log(`Copiáveis para supervisorId vazio: ${toCopy.length}`);
  console.log(`Já alinhados: ${alreadySame.length}`);
  console.log(`Conflitos preservados: ${conflicts.length}`);

  if (toCopy.length) {
    console.log("\nAmostra copiável:");
    toCopy.slice(0, 20).forEach((employee) => {
      console.log(`- ${employee.fullName} (${employee.wbLogin}) -> ${employee.manager?.fullName ?? employee.managerId}`);
    });
  }

  if (conflicts.length) {
    console.log("\nConflitos não serão sobrescritos:");
    conflicts.slice(0, 20).forEach((employee) => {
      console.log(`- ${employee.fullName} (${employee.wbLogin}) supervisor=${employee.supervisor?.fullName ?? employee.supervisorId} manager=${employee.manager?.fullName ?? employee.managerId}`);
    });
  }

  if (!shouldApply) {
    console.log("\nDry-run concluído. Nenhum dado foi alterado.");
    return;
  }

  if (!toCopy.length) {
    console.log("\nNenhum registro para atualizar.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const employee of toCopy) {
      await tx.employeeProfile.update({
        where: { id: employee.id },
        data: { supervisorId: employee.managerId }
      });
    }

    await tx.auditLog.create({
      data: {
        actorId: null,
        action: "EDICAO",
        entity: "EmployeeProfile",
        entityId: "manager-to-supervisor-migration",
        reason: "Migração segura de managerId para supervisorId",
        previousValue: { count: toCopy.length },
        newValue: {
          copiedToSupervisorId: toCopy.length,
          conflictsPreserved: conflicts.length,
          source: "scripts/migrate-manager-to-supervisor.ts"
        }
      }
    });
  });

  console.log(`\nAtualização concluída. ${toCopy.length} registro(s) receberam supervisorId a partir de managerId.`);
  if (conflicts.length) console.log(`${conflicts.length} conflito(s) foram preservados sem sobrescrever supervisorId existente.`);
}

main()
  .catch((error) => {
    console.error("Falha na migração managerId -> supervisorId:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
