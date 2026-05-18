import { EquipmentStatus, Prisma } from "@prisma/client";

import type { Actor } from "@/lib/mock-db";
import { normalizeRole } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const equipmentStatusLabels: Record<EquipmentStatus, string> = {
  DISPONIVEL: "Disponível",
  ENTREGUE: "Em uso",
  FUNCIONANDO: "Em uso",
  EM_ATENCAO: "Em manutenção",
  EM_MANUTENCAO: "Em manutenção",
  INOPERANTE: "Inativo",
  DEVOLVIDO: "Devolvido",
  PERDIDO: "Extraviado",
  BLOQUEADO: "Inativo",
  SUBSTITUIDO: "Devolvido"
};

const statusAliases: Record<string, EquipmentStatus> = {
  DISPONIVEL: "DISPONIVEL",
  "DISPONÍVEL": "DISPONIVEL",
  "EM USO": "ENTREGUE",
  ENTREGUE: "ENTREGUE",
  FUNCIONANDO: "FUNCIONANDO",
  "EM MANUTENCAO": "EM_MANUTENCAO",
  "EM MANUTENÇÃO": "EM_MANUTENCAO",
  MANUTENCAO: "EM_MANUTENCAO",
  MANUTENÇÃO: "EM_MANUTENCAO",
  DEVOLVIDO: "DEVOLVIDO",
  EXTRAVIADO: "PERDIDO",
  PERDIDO: "PERDIDO",
  INATIVO: "BLOQUEADO",
  INOPERANTE: "INOPERANTE"
};

const allowedTypes = ["Notebook", "Desktop", "Monitor", "Headset", "Mouse", "Teclado", "Cadeira", "Celular", "Outro"];

export type EquipmentInput = {
  id?: string;
  numeroSerie?: string;
  code?: string;
  serial?: string;
  responsibleEmployeeId?: string;
  responsavelWbLogin?: string;
  responsavelEmail?: string;
  responsavelNome?: string;
  deliveredAt?: string;
  dataEntrega?: string;
  type?: string;
  tipoEquipamento?: string;
  model?: string;
  modelo?: string;
  status?: string;
  observation?: string;
  observacao?: string;
};

export type EquipmentQuery = {
  status?: string;
  type?: string;
  search?: string;
  responsible?: string;
  model?: string;
  deliveredFrom?: string;
  deliveredTo?: string;
};

export type EquipmentPreviewRow = {
  rowNumber: number;
  numeroSerie: string;
  type: string;
  model: string;
  status: string;
  responsible: string;
  deliveredAt: string;
  action: "create" | "update" | "ignore";
  errors: string[];
  warnings: string[];
  normalized?: EquipmentInput;
};

async function getActorUser(actor: Actor) {
  return prisma.user.findUnique({ where: { email: actor.email }, include: { role: true, employeeProfile: true } });
}

function canViewEquipmentRole(role: string) {
  return ["ADMIN", "GESTOR", "WFM", "TI", "SUPERVISOR"].includes(normalizeRole(role));
}

function canManageEquipmentRole(role: string) {
  return ["ADMIN", "TI"].includes(normalizeRole(role));
}

function normalizeStatus(value?: string | null) {
  const key = String(value ?? "").trim().toUpperCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  return statusAliases[key] ?? statusAliases[key.replaceAll("_", " ")] ?? null;
}

function normalizeType(value?: string | null) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const found = allowedTypes.find((type) => type.toLowerCase() === raw.toLowerCase());
  return found ?? raw;
}

function parseDate(value?: string | null) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = br ? new Date(Date.UTC(Number(br[3]), Number(br[2]) - 1, Number(br[1]))) : iso ? new Date(`${raw}T00:00:00.000Z`) : new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(date?: Date | null) {
  if (!date) return "";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(date);
}

function serialize(value: unknown) {
  return JSON.parse(JSON.stringify(value, (_key, current) => current instanceof Date ? current.toISOString() : current));
}

async function findResponsible(input: EquipmentInput) {
  if (input.responsibleEmployeeId) {
    return prisma.employeeProfile.findFirst({ where: { id: input.responsibleEmployeeId, deletedAt: null } });
  }
  const wbLogin = input.responsavelWbLogin?.trim();
  if (wbLogin) {
    return prisma.employeeProfile.findFirst({ where: { wbLogin: { equals: wbLogin, mode: "insensitive" }, deletedAt: null } });
  }
  const email = input.responsavelEmail?.trim();
  if (email) {
    return prisma.employeeProfile.findFirst({ where: { user: { email: { equals: email, mode: "insensitive" } }, deletedAt: null } });
  }
  const name = input.responsavelNome?.trim();
  if (name) {
    const matches = await prisma.employeeProfile.findMany({
      where: { fullName: { contains: name, mode: "insensitive" }, deletedAt: null },
      take: 2
    });
    if (matches.length === 1) return matches[0];
  }
  return null;
}

function formatEquipment(equipment: Prisma.EquipmentGetPayload<{ include: { employee: { include: { user: true } }; histories: true } }>) {
  const lastHistory = equipment.histories[0];
  return {
    id: equipment.id,
    code: equipment.code,
    serial: equipment.serial ?? equipment.code,
    type: equipment.type,
    model: equipment.model ?? "",
    employeeId: equipment.employeeId ?? "",
    employee: equipment.employee?.fullName ?? "Sem responsável",
    employeeWbLogin: equipment.employee?.wbLogin ?? "",
    employeeEmail: equipment.employee?.user?.email ?? "",
    status: equipmentStatusLabels[equipment.status] ?? String(equipment.status),
    rawStatus: equipment.status,
    delivered: formatDate(equipment.deliveredAt),
    deliveredAt: equipment.deliveredAt?.toISOString().slice(0, 10) ?? "",
    impact: equipment.impact === "ALTO" ? "Alto" : equipment.impact === "MEDIO" ? "Médio" : "Baixo",
    observation: lastHistory?.reason ?? "",
    updatedAt: equipment.updatedAt.toISOString()
  };
}

export async function listEquipment(actor: Actor, query: EquipmentQuery = {}) {
  const user = await getActorUser(actor);
  if (!user || !canViewEquipmentRole(user.role.name)) return { data: [], summary: emptyEquipmentSummary(), canManage: false };

  const search = query.search?.trim();
  const responsible = query.responsible?.trim();
  const status = query.status && query.status !== "Todos" ? normalizeStatus(query.status) : null;
  const type = query.type && query.type !== "Todos" ? query.type : undefined;
  const model = query.model?.trim();
  const deliveredFrom = parseDate(query.deliveredFrom);
  const deliveredTo = parseDate(query.deliveredTo);
  const filters: Prisma.EquipmentWhereInput[] = [];
  if (status) filters.push({ status });
  if (type) filters.push({ type });
  if (model) filters.push({ model: { contains: model, mode: "insensitive" } });
  if (responsible) {
    filters.push({
      employee: {
        OR: [
          { fullName: { contains: responsible, mode: "insensitive" } },
          { wbLogin: { contains: responsible, mode: "insensitive" } },
          { user: { email: { contains: responsible, mode: "insensitive" } } }
        ]
      }
    });
  }
  if (search) {
    filters.push({
      OR: [
        { code: { contains: search, mode: "insensitive" } },
        { serial: { contains: search, mode: "insensitive" } },
        { type: { contains: search, mode: "insensitive" } },
        { model: { contains: search, mode: "insensitive" } },
        { employee: { fullName: { contains: search, mode: "insensitive" } } },
        { employee: { wbLogin: { contains: search, mode: "insensitive" } } }
      ]
    });
  }
  if (deliveredFrom || deliveredTo) filters.push({ deliveredAt: { ...(deliveredFrom ? { gte: deliveredFrom } : {}), ...(deliveredTo ? { lte: deliveredTo } : {}) } });
  if (normalizeRole(user.role.name) === "SUPERVISOR" && user.employeeProfile) filters.push({ employee: { supervisorId: user.employeeProfile.id } });

  const where: Prisma.EquipmentWhereInput = { deletedAt: null, ...(filters.length ? { AND: filters } : {}) };
  const [rows, allActive] = await Promise.all([
    prisma.equipment.findMany({
      where,
      include: {
        employee: { include: { user: true } },
        histories: { orderBy: { createdAt: "desc" }, take: 1 }
      },
      orderBy: { updatedAt: "desc" },
      take: 300
    }),
    prisma.equipment.findMany({ where: { deletedAt: null }, select: { status: true, employeeId: true } })
  ]);

  return {
    data: rows.map(formatEquipment),
    summary: {
      total: allActive.length,
      inUse: allActive.filter((item) => ["ENTREGUE", "FUNCIONANDO"].includes(item.status)).length,
      available: allActive.filter((item) => item.status === "DISPONIVEL").length,
      maintenance: allActive.filter((item) => ["EM_MANUTENCAO", "EM_ATENCAO", "INOPERANTE"].includes(item.status)).length,
      returned: allActive.filter((item) => ["DEVOLVIDO", "SUBSTITUIDO"].includes(item.status)).length,
      pending: allActive.filter((item) => !item.employeeId || ["PERDIDO", "BLOQUEADO"].includes(item.status)).length
    },
    canManage: canManageEquipmentRole(user.role.name)
  };
}

export async function saveEquipment(actor: Actor, input: EquipmentInput) {
  const user = await getActorUser(actor);
  if (!user || !canManageEquipmentRole(user.role.name)) return { error: "Você não tem permissão para gerenciar equipamentos." };

  const code = String(input.numeroSerie ?? input.code ?? input.serial ?? "").trim();
  const type = normalizeType(input.tipoEquipamento ?? input.type);
  const model = String(input.modelo ?? input.model ?? "").trim();
  const status = normalizeStatus(input.status);
  const deliveredAt = parseDate(input.dataEntrega ?? input.deliveredAt);
  const observation = String(input.observacao ?? input.observation ?? "").trim();
  if (!code) return { error: "Número de série é obrigatório." };
  if (!type) return { error: "Tipo de equipamento é obrigatório." };
  if (!model) return { error: "Modelo é obrigatório." };
  if (!status) return { error: "Status inválido." };
  if (!deliveredAt) return { error: "Data de entrega inválida." };
  const responsible = await findResponsible(input);
  if (!responsible) return { error: "Responsável não encontrado." };

  const existing = input.id
    ? await prisma.equipment.findFirst({ where: { id: input.id, deletedAt: null }, include: { employee: true } })
    : await prisma.equipment.findFirst({ where: { code, deletedAt: null }, include: { employee: true } });

  const saved = await prisma.$transaction(async (tx) => {
    const data = {
      code,
      serial: code,
      type,
      model,
      status,
      deliveredAt,
      employeeId: responsible.id
    };
    const equipment = existing
      ? await tx.equipment.update({ where: { id: existing.id }, data })
      : await tx.equipment.create({ data: { ...data, impact: "BAIXO" } });

    await tx.equipmentHistory.create({
      data: {
        equipmentId: equipment.id,
        actorId: user.id,
        action: existing ? "Atualização de equipamento" : "Cadastro de equipamento",
        before: serialize(existing),
        after: serialize(equipment),
        reason: observation || undefined
      }
    });
    await tx.auditLog.create({
      data: {
        actorId: user.id,
        action: existing ? "EDICAO" : "CRIACAO",
        entity: "Equipment",
        entityId: equipment.id,
        reason: observation || (existing ? "Atualização de equipamento" : "Cadastro de equipamento"),
        previousValue: serialize(existing),
        newValue: serialize(equipment)
      }
    });
    return equipment;
  });

  return { success: true, data: saved, message: existing ? "Equipamento atualizado com sucesso." : "Equipamento cadastrado com sucesso." };
}

export async function deleteEquipment(actor: Actor, id: string) {
  const user = await getActorUser(actor);
  if (!user || !canManageEquipmentRole(user.role.name)) return { error: "Você não tem permissão para excluir equipamentos." };
  const existing = await prisma.equipment.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return { error: "Equipamento não encontrado." };
  await prisma.$transaction(async (tx) => {
    await tx.equipment.update({ where: { id }, data: { deletedAt: new Date() } });
    await tx.auditLog.create({
      data: {
        actorId: user.id,
        action: "EXCLUSAO",
        entity: "Equipment",
        entityId: id,
        reason: "Equipamento inativado manualmente",
        previousValue: serialize(existing),
        newValue: { deletedAt: true }
      }
    });
  });
  return { success: true, message: "Equipamento removido da lista ativa." };
}

export async function previewEquipmentImport(actor: Actor, rows: Array<Record<string, unknown>>) {
  const user = await getActorUser(actor);
  if (!user || !canManageEquipmentRole(user.role.name)) return { success: false, message: "Você não tem permissão para importar equipamentos.", rows: [], summary: emptyPreviewSummary() };

  const codes = rows.map((row) => text(row.numero_serie)).filter(Boolean);
  const existing = await prisma.equipment.findMany({ where: { code: { in: codes }, deletedAt: null }, select: { code: true } });
  const existingCodes = new Set(existing.map((item) => item.code.toLowerCase()));
  const previewRows: EquipmentPreviewRow[] = [];
  for (const [index, row] of rows.entries()) {
    const numeroSerie = text(row.numero_serie);
    const type = normalizeType(text(row.tipo_equipamento));
    const model = text(row.modelo);
    const status = normalizeStatus(text(row.status));
    const deliveredAt = parseDate(text(row.data_entrega));
    const normalized: EquipmentInput = {
      numeroSerie,
      tipoEquipamento: type,
      modelo: model,
      status: status ? equipmentStatusLabels[status] : text(row.status),
      dataEntrega: deliveredAt?.toISOString().slice(0, 10) ?? text(row.data_entrega),
      responsavelWbLogin: text(row.responsavel_wb_login),
      responsavelEmail: text(row.responsavel_email),
      responsavelNome: text(row.responsavel_nome),
      observacao: text(row.observacao)
    };
    const responsible = await findResponsible(normalized);
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!numeroSerie) errors.push("Número de série é obrigatório.");
    if (!type) errors.push("Tipo de equipamento é obrigatório.");
    if (!model) errors.push("Modelo é obrigatório.");
    if (!status) errors.push("Status inválido.");
    if (!deliveredAt) errors.push("Data de entrega inválida.");
    if (!responsible) errors.push("Responsável não encontrado.");
    previewRows.push({
      rowNumber: index + 2,
      numeroSerie,
      type,
      model,
      status: status ? equipmentStatusLabels[status] : text(row.status),
      responsible: responsible?.fullName ?? text(row.responsavel_nome) ?? text(row.responsavel_wb_login) ?? "Sem responsável",
      deliveredAt: deliveredAt ? formatDate(deliveredAt) : text(row.data_entrega),
      action: errors.length ? "ignore" : existingCodes.has(numeroSerie.toLowerCase()) ? "update" : "create",
      errors,
      warnings,
      normalized: { ...normalized, responsibleEmployeeId: responsible?.id }
    });
  }

  return {
    success: true,
    summary: {
      totalRows: previewRows.length,
      validRows: previewRows.filter((row) => !row.errors.length).length,
      errorRows: previewRows.filter((row) => row.errors.length).length,
      warningRows: previewRows.filter((row) => row.warnings.length).length,
      createdRows: previewRows.filter((row) => row.action === "create").length,
      updatedRows: previewRows.filter((row) => row.action === "update").length
    },
    rows: previewRows
  };
}

export async function commitEquipmentImport(actor: Actor, rows: EquipmentPreviewRow[]) {
  const user = await getActorUser(actor);
  if (!user || !canManageEquipmentRole(user.role.name)) return { error: "Você não tem permissão para importar equipamentos." };
  const validRows = rows.filter((row) => !row.errors.length && row.normalized);
  let createdRows = 0;
  let updatedRows = 0;
  for (const row of validRows) {
    const existing = await prisma.equipment.findFirst({ where: { code: row.numeroSerie, deletedAt: null }, select: { id: true } });
    const result = await saveEquipment(actor, row.normalized!);
    if (!("error" in result)) {
      if (existing) updatedRows += 1;
      else createdRows += 1;
    }
  }
  return {
    success: true,
    message: "Importação de equipamentos concluída.",
    summary: { createdRows, updatedRows, skippedRows: rows.length - validRows.length, errorRows: rows.filter((row) => row.errors.length).length }
  };
}

export async function exportEquipmentCsv(actor: Actor, query: EquipmentQuery = {}) {
  const payload = await listEquipment(actor, query);
  const headers = ["numero_serie", "tipo_equipamento", "modelo", "responsavel", "responsavel_wb_login", "data_entrega", "status", "observacao"];
  const rows = payload.data.map((item) => [item.serial, item.type, item.model, item.employee, item.employeeWbLogin, item.delivered, item.status, item.observation]);
  return [headers, ...rows].map((row) => row.map(csvCell).join(";")).join("\n");
}

function emptyEquipmentSummary() {
  return { total: 0, inUse: 0, available: 0, maintenance: 0, returned: 0, pending: 0 };
}

function emptyPreviewSummary() {
  return { totalRows: 0, validRows: 0, errorRows: 0, warningRows: 0, createdRows: 0, updatedRows: 0 };
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}
