import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const adminEmail = process.env.INITIAL_ADMIN_EMAIL ?? "admin@central.com";
const adminPassword = process.env.INITIAL_ADMIN_PASSWORD ?? "Central@123";

async function main() {
  const roles = [
    ["ADMIN", "Administrador"],
    ["GESTOR", "Gestão"],
    ["SUPERVISOR", "Supervisor"],
    ["COLABORADOR", "Colaborador"],
    ["WFM", "WFM / Planejamento"],
    ["QUALIDADE", "Qualidade"],
    ["RH", "RH"],
    ["TI", "Logística / TI"]
  ] as const;

  for (const [name, label] of roles) {
    await prisma.role.upsert({
      where: { name },
      update: { label },
      create: { name, label }
    });
  }

  for (const [name, startsAt, endsAt, color] of [
    ["Manhã", "06:00", "14:00", "#10B981"],
    ["Tarde", "14:00", "22:00", "#2563EB"],
    ["Noite", "22:00", "06:00", "#7C3AED"],
    ["Backoffice", "08:00", "16:00", "#F59E0B"]
  ] as const) {
    await prisma.shift.upsert({
      where: { name },
      update: { startsAt, endsAt, color },
      create: { name, startsAt, endsAt, color }
    });
  }

  for (const [name, description] of [
    ["ALL", "Atuação transversal / staff / multi-LOB"],
    ["CEC", "LOB disponível para importação real"],
    ["TNS", "LOB disponível para importação real"],
    ["ADS", "LOB disponível para importação real"]
  ] as const) {
    await prisma.lob.upsert({
      where: { name },
      update: { description },
      create: { name, description }
    });
  }

  for (const [key, label] of [
    ["requests.manage", "Gerenciar solicitações"],
    ["schedules.manage", "Gerenciar escalas"],
    ["registrations.approve", "Aprovar cadastros"],
    ["audit.view", "Visualizar auditoria"]
  ] as const) {
    await prisma.permission.upsert({
      where: { key },
      update: { label },
      create: { key, label }
    });
  }

  for (const [name, area] of [
    ["Troca de Folga", "WFM"],
    ["Venda de Folga", "WFM"],
    ["Solicitação de Dia de Folga", "WFM"],
    ["Ajuste de escala", "WFM"],
    ["Correção de escala", "WFM"],
    ["Equipamento", "TI"],
    ["Acesso", "Operações"],
    ["RH", "RH"],
    ["Qualidade", "Qualidade"],
    ["WFM", "WFM"],
    ["Operação", "Operações"],
    ["Suporte geral", "Operações"]
  ] as const) {
    await prisma.requestType.upsert({
      where: { name },
      update: { area, requiresApproval: true },
      create: { name, area, slaHours: area === "WFM" ? 24 : 48, requiresApproval: true }
    });
  }

  const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: "ADMIN" } });
  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: { name: "Admin Central", status: "ACTIVE", roleId: adminRole.id },
    create: {
      email: adminEmail,
      name: "Admin Central",
      passwordHash: await bcrypt.hash(adminPassword, 10),
      roleId: adminRole.id,
      status: "ACTIVE"
    }
  });

  const permissions = await prisma.permission.findMany();
  for (const permission of permissions) {
    await prisma.userPermission.upsert({
      where: { userId_permissionId: { userId: admin.id, permissionId: permission.id } },
      update: { granted: true },
      create: { userId: admin.id, permissionId: permission.id, granted: true }
    });
  }

  await prisma.systemConfig.upsert({
    where: { key: "seed_mode" },
    update: { value: { mode: "prod-minimal" } },
    create: { key: "seed_mode", value: { mode: "prod-minimal" } }
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
