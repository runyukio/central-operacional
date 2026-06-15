import { FormalFeedbackStatus, FormalFeedbackType, Prisma } from "@prisma/client";

import type { Actor } from "@/lib/mock-db";
import { isAgentJobTitle } from "@/lib/job-title-normalization";
import { normalizeRole } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import type { XlsxExportPayload } from "@/lib/xlsx-export";

export class FormalFeedbackError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "FormalFeedbackError";
    this.status = status;
  }
}

type FormalFeedbackUser = Prisma.UserGetPayload<{
  include: {
    role: true;
    employeeProfile: {
      include: {
        lob: true;
        supervisor: true;
      };
    };
  };
}>;

const feedbackInclude = {
  employee: {
    include: {
      user: true,
      lob: true,
      supervisor: true
    }
  },
  author: {
    include: {
      role: true,
      employeeProfile: true
    }
  },
  acknowledgedBy: true
} satisfies Prisma.FormalFeedbackInclude;

type FormalFeedbackWithRelations = Prisma.FormalFeedbackGetPayload<{ include: typeof feedbackInclude }>;

export type FormalFeedbackFilters = {
  startDate?: string;
  endDate?: string;
  employeeId?: string;
  authorId?: string;
  type?: string;
  category?: string;
  status?: string;
  lob?: string;
  jobTitle?: string;
  skill?: string;
  supervisor?: string;
  search?: string;
  page?: number;
  limit?: number;
};

export type CreateFormalFeedbackInput = {
  employeeId: string;
  type: string;
  category: string;
  title: string;
  description: string;
};

export type AcknowledgeFormalFeedbackInput = {
  response?: string;
};

export const formalFeedbackCategories = [
  "Produtividade",
  "Qualidade",
  "ABS / Presença",
  "Atrasos",
  "Conduta",
  "Comportamento",
  "Reconhecimento positivo",
  "Alinhamento operacional",
  "Comunicação",
  "Outro"
];

const creatorRoles = new Set(["ADMIN", "GESTOR", "SUPERVISOR", "WFM", "RH", "COORDENADOR", "GERENTE"]);
const allFeedbackRoles = new Set(["ADMIN", "GESTOR", "WFM", "RH", "COORDENADOR", "GERENTE"]);
const formalFeedbackEnabled = false;

const statusLabels: Record<FormalFeedbackStatus, string> = {
  PENDENTE_CIENCIA: "Pendente de ciência",
  VISUALIZADO: "Visualizado",
  CIENTE: "Ciente",
  ARQUIVADO: "Arquivado"
};

const typeLabels: Record<FormalFeedbackType, string> = {
  POSITIVO: "Positivo",
  CORRETIVO: "Corretivo"
};

export async function listFormalFeedbacks(actor: Actor, filters: FormalFeedbackFilters = {}) {
  const user = await requireUser(actor);
  const page = Math.max(1, Number(filters.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(filters.limit) || 25));
  const where = await buildFormalFeedbackWhere(user, filters);

  const [items, total, statusCounts, typeCounts, employeeOptions] = await Promise.all([
    prisma.formalFeedback.findMany({
      where,
      include: feedbackInclude,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit
    }),
    prisma.formalFeedback.count({ where }),
    prisma.formalFeedback.groupBy({ by: ["status"], where, _count: { _all: true } }),
    prisma.formalFeedback.groupBy({ by: ["type"], where, _count: { _all: true } }),
    getFormalFeedbackEmployeeOptionsForUser(user)
  ]);

  const statusMap = countMap(statusCounts.map((row) => [row.status, row._count._all]));
  const typeMap = countMap(typeCounts.map((row) => [row.type, row._count._all]));

  return {
    data: items.map(serializeFormalFeedback),
    summary: {
      total,
      pending: statusMap.PENDENTE_CIENCIA ?? 0,
      viewed: statusMap.VISUALIZADO ?? 0,
      acknowledged: statusMap.CIENTE ?? 0,
      positive: typeMap.POSITIVO ?? 0,
      corrective: typeMap.CORRETIVO ?? 0
    },
    permissions: {
      canCreate: canCreateFormalFeedback(user),
      canExport: canExportFormalFeedback(user)
    },
    viewer: {
      employeeId: user.employeeProfile?.id ?? "",
      role: normalizeRole(user.role.name)
    },
    options: {
      categories: formalFeedbackCategories,
      employees: employeeOptions
    },
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit))
    }
  };
}

export async function getFormalFeedbackDetail(actor: Actor, id: string) {
  const user = await requireUser(actor);
  const feedback = await prisma.formalFeedback.findFirst({
    where: { id, deletedAt: null },
    include: feedbackInclude
  });
  if (!feedback) throw new FormalFeedbackError("Feedback não encontrado.", 404);
  if (!canViewFormalFeedback(user, feedback)) throw new FormalFeedbackError("Você não tem permissão para visualizar este feedback.", 403);

  if (user.employeeProfile?.id === feedback.employeeId && feedback.status === "PENDENTE_CIENCIA") {
    const viewed = await prisma.formalFeedback.update({
      where: { id: feedback.id },
      data: { status: "VISUALIZADO", viewedAt: new Date(), updatedById: user.id },
      include: feedbackInclude
    });
    await auditFormalFeedback(user.id, viewed.id, viewed.employeeId, "CONFIRMACAO_LEITURA", "FORMAL_FEEDBACK_VIEWED", { status: "VISUALIZADO" });
    return { data: serializeFormalFeedback(viewed) };
  }

  return { data: serializeFormalFeedback(feedback) };
}

export async function createFormalFeedback(actor: Actor, input: CreateFormalFeedbackInput) {
  const user = await requireUser(actor);
  if (!canCreateFormalFeedback(user)) {
    throw new FormalFeedbackError("Você não tem permissão para criar Feedback Formal.", 403);
  }

  const employeeId = input.employeeId?.trim();
  const type = normalizeFormalFeedbackType(input.type);
  const category = input.category?.trim();
  const title = input.title?.trim();
  const description = input.description?.trim();

  if (!employeeId) throw new FormalFeedbackError("Colaborador é obrigatório.");
  if (!category) throw new FormalFeedbackError("Categoria é obrigatória.");
  if (!formalFeedbackCategories.includes(category)) throw new FormalFeedbackError("Categoria inválida.");
  if (!title) throw new FormalFeedbackError("Título é obrigatório.");
  if (!description) throw new FormalFeedbackError("Descrição é obrigatória.");

  const employee = await prisma.employeeProfile.findFirst({
    where: { id: employeeId, deletedAt: null },
    include: { user: true, lob: true, supervisor: true }
  });
  if (!employee) throw new FormalFeedbackError("Colaborador não encontrado.", 404);
  if (!isAgentJobTitle(employee.roleTitle)) {
    throw new FormalFeedbackError("Feedback Formal deve ser criado para colaboradores/agentes operacionais.");
  }
  if (!canCreateFeedbackForEmployee(user, employee)) {
    throw new FormalFeedbackError("Supervisor só pode criar feedback para colaboradores do próprio time.", 403);
  }

  const feedback = await prisma.formalFeedback.create({
    data: {
      employeeId: employee.id,
      authorId: user.id,
      authorRole: normalizeRole(user.role.name),
      type,
      category,
      title,
      description,
      status: "PENDENTE_CIENCIA"
    },
    include: feedbackInclude
  });

  if (employee.userId) {
    await prisma.notification.create({
      data: {
        userId: employee.userId,
        title: "Novo feedback recebido",
        body: "Você recebeu um novo feedback. Acesse para ler e confirmar ciência.",
        category: "FEEDBACK_FORMAL",
        type: "INFO",
        entity: "FormalFeedback",
        entityId: feedback.id,
        href: `/feedbacks?id=${encodeURIComponent(feedback.id)}`
      }
    }).catch(() => undefined);
  }

  await auditFormalFeedback(user.id, feedback.id, employee.id, "CRIACAO", "FORMAL_FEEDBACK_CREATED", {
    type: feedback.type,
    category: feedback.category,
    title: feedback.title
  });

  return { data: serializeFormalFeedback(feedback), message: "Feedback enviado com sucesso." };
}

export async function acknowledgeFormalFeedback(actor: Actor, id: string, input: AcknowledgeFormalFeedbackInput = {}) {
  const user = await requireUser(actor);
  if (!user.employeeProfile) throw new FormalFeedbackError("Seu usuário não está vinculado a um colaborador.", 403);

  const feedback = await prisma.formalFeedback.findFirst({
    where: { id, deletedAt: null },
    include: feedbackInclude
  });
  if (!feedback) throw new FormalFeedbackError("Feedback não encontrado.", 404);
  if (feedback.employeeId !== user.employeeProfile.id) {
    throw new FormalFeedbackError("Você só pode confirmar ciência dos próprios feedbacks.", 403);
  }
  if (feedback.status === "CIENTE") {
    return { data: serializeFormalFeedback(feedback), message: "Ciência já registrada." };
  }
  if (feedback.status === "ARQUIVADO") {
    throw new FormalFeedbackError("Feedback arquivado não pode receber ciência.", 400);
  }

  const response = input.response?.trim() || null;
  const updated = await prisma.formalFeedback.update({
    where: { id: feedback.id },
    data: {
      status: "CIENTE",
      acknowledgedAt: new Date(),
      acknowledgedById: user.id,
      employeeResponse: response,
      updatedById: user.id
    },
    include: feedbackInclude
  });

  await prisma.notification.updateMany({
    where: { userId: user.id, entity: "FormalFeedback", entityId: feedback.id, isRead: false },
    data: { isRead: true, readAt: new Date() }
  }).catch(() => undefined);

  await auditFormalFeedback(user.id, updated.id, updated.employeeId, "CONFIRMACAO_LEITURA", "FORMAL_FEEDBACK_ACKNOWLEDGED", {
    acknowledgedAt: updated.acknowledgedAt,
    hasEmployeeResponse: Boolean(response)
  });

  return { data: serializeFormalFeedback(updated), message: "Ciência registrada com sucesso." };
}

export async function archiveFormalFeedback(actor: Actor, id: string) {
  const user = await requireUser(actor);
  const feedback = await prisma.formalFeedback.findFirst({
    where: { id, deletedAt: null },
    include: feedbackInclude
  });
  if (!feedback) throw new FormalFeedbackError("Feedback não encontrado.", 404);
  if (!canManageFormalFeedback(user, feedback)) {
    throw new FormalFeedbackError("Você não tem permissão para arquivar este feedback.", 403);
  }

  const updated = await prisma.formalFeedback.update({
    where: { id: feedback.id },
    data: { status: "ARQUIVADO", archivedAt: new Date(), updatedById: user.id },
    include: feedbackInclude
  });

  await auditFormalFeedback(user.id, updated.id, updated.employeeId, "EDICAO", "FORMAL_FEEDBACK_ARCHIVED", {
    previousStatus: feedback.status,
    status: updated.status
  });

  return { data: serializeFormalFeedback(updated), message: "Feedback arquivado." };
}

export async function exportFormalFeedbackXlsxData(actor: Actor, filters: FormalFeedbackFilters = {}): Promise<XlsxExportPayload> {
  const user = await requireUser(actor);
  if (!canExportFormalFeedback(user)) {
    throw new FormalFeedbackError("Você não tem permissão para exportar Feedback Formal.", 403);
  }
  const where = await buildFormalFeedbackWhere(user, filters);
  const rows = await prisma.formalFeedback.findMany({
    where,
    include: feedbackInclude,
    orderBy: { createdAt: "desc" },
    take: 10000
  });

  await auditFormalFeedback(user.id, null, user.employeeProfile?.id ?? null, "UPLOAD", "FORMAL_FEEDBACK_EXPORTED", {
    filters,
    exportedRows: rows.length
  });

  return {
    fileName: `feedback_formal_${new Date().toISOString().slice(0, 10)}.xlsx`,
    sheetName: "Feedback Formal",
    headers: [
      "data_feedback",
      "colaborador",
      "wb_login",
      "lob",
      "supervisor_colaborador",
      "autor_feedback",
      "role_autor",
      "tipo_feedback",
      "categoria",
      "titulo",
      "descricao",
      "status",
      "ciente_em",
      "resposta_agente",
      "criado_em",
      "atualizado_em"
    ],
    rows: rows.map((feedback) => [
      formatDateTime(feedback.sentAt),
      feedback.employee.fullName,
      feedback.employee.wbLogin,
      feedback.employee.lob.name,
      feedback.employee.supervisor?.fullName ?? "",
      feedback.author.name,
      feedback.authorRole,
      typeLabels[feedback.type],
      feedback.category,
      feedback.title,
      feedback.description,
      statusLabels[feedback.status],
      feedback.acknowledgedAt ? formatDateTime(feedback.acknowledgedAt) : "",
      feedback.employeeResponse ?? "",
      formatDateTime(feedback.createdAt),
      formatDateTime(feedback.updatedAt)
    ])
  };
}

export async function getFormalFeedbackProfileSummary(actor: Actor, employeeId: string) {
  const user = await requireUser(actor);
  const employee = await prisma.employeeProfile.findFirst({
    where: { id: employeeId, deletedAt: null },
    include: { user: true, lob: true, supervisor: true }
  });
  if (!employee) throw new FormalFeedbackError("Colaborador não encontrado.", 404);
  if (!canViewFormalFeedbackForEmployee(user, employee)) {
    throw new FormalFeedbackError("Você não tem permissão para visualizar histórico de feedbacks deste colaborador.", 403);
  }

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const [pending, totalMonth, latest, recent] = await Promise.all([
    prisma.formalFeedback.count({ where: { employeeId, deletedAt: null, status: { in: ["PENDENTE_CIENCIA", "VISUALIZADO"] } } }),
    prisma.formalFeedback.count({ where: { employeeId, deletedAt: null, createdAt: { gte: monthStart } } }),
    prisma.formalFeedback.findFirst({ where: { employeeId, deletedAt: null }, include: feedbackInclude, orderBy: { createdAt: "desc" } }),
    prisma.formalFeedback.findMany({ where: { employeeId, deletedAt: null }, include: feedbackInclude, orderBy: { createdAt: "desc" }, take: 5 })
  ]);

  return {
    pending,
    totalMonth,
    latest: latest ? serializeFormalFeedback(latest) : null,
    recent: recent.map(serializeFormalFeedback)
  };
}

function canCreateFormalFeedback(user: FormalFeedbackUser) {
  return user.status === "ACTIVE" && creatorRoles.has(normalizeRole(user.role.name));
}

function canExportFormalFeedback(user: FormalFeedbackUser) {
  const role = normalizeRole(user.role.name);
  return user.status === "ACTIVE" && (role === "SUPERVISOR" || allFeedbackRoles.has(role));
}

function canManageFormalFeedback(user: FormalFeedbackUser, feedback: FormalFeedbackWithRelations) {
  const role = normalizeRole(user.role.name);
  if (allFeedbackRoles.has(role)) return true;
  if (role === "SUPERVISOR") {
    return feedback.authorId === user.id || Boolean(user.employeeProfile?.id && feedback.employee.supervisorId === user.employeeProfile.id);
  }
  return false;
}

function canViewFormalFeedback(user: FormalFeedbackUser, feedback: FormalFeedbackWithRelations) {
  if (user.status !== "ACTIVE") return false;
  if (user.employeeProfile?.id === feedback.employeeId) return true;
  return canManageFormalFeedback(user, feedback);
}

function canViewFormalFeedbackForEmployee(
  user: FormalFeedbackUser,
  employee: { id: string; supervisorId?: string | null }
) {
  const role = normalizeRole(user.role.name);
  if (user.status !== "ACTIVE") return false;
  if (user.employeeProfile?.id === employee.id) return true;
  if (allFeedbackRoles.has(role)) return true;
  if (role === "SUPERVISOR") return Boolean(user.employeeProfile?.id && employee.supervisorId === user.employeeProfile.id);
  return false;
}

function canCreateFeedbackForEmployee(user: FormalFeedbackUser, employee: { supervisorId?: string | null }) {
  const role = normalizeRole(user.role.name);
  if (allFeedbackRoles.has(role)) return true;
  if (role === "SUPERVISOR") return Boolean(user.employeeProfile?.id && employee.supervisorId === user.employeeProfile.id);
  return false;
}

async function buildFormalFeedbackWhere(user: FormalFeedbackUser, filters: FormalFeedbackFilters): Promise<Prisma.FormalFeedbackWhereInput> {
  const where: Prisma.FormalFeedbackWhereInput = {
    deletedAt: null,
    ...visibleFormalFeedbackGuard(user)
  };

  const start = parseDateStart(filters.startDate);
  const end = parseDateEnd(filters.endDate);
  if (start || end) where.createdAt = { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) };
  if (filters.employeeId) where.employeeId = filters.employeeId;
  if (filters.authorId) where.authorId = filters.authorId;
  if (filters.type && filters.type !== "Todos") where.type = normalizeFormalFeedbackType(filters.type);
  if (filters.status && filters.status !== "Todos") where.status = normalizeFormalFeedbackStatus(filters.status);
  if (filters.category && filters.category !== "Todos") where.category = filters.category;

  const employeeWhere: Prisma.EmployeeProfileWhereInput = {};
  if (filters.lob?.trim()) employeeWhere.lob = { name: { contains: filters.lob.trim(), mode: "insensitive" } };
  if (filters.jobTitle?.trim()) employeeWhere.roleTitle = { contains: filters.jobTitle.trim(), mode: "insensitive" };
  if (filters.skill?.trim()) employeeWhere.skill = { contains: filters.skill.trim(), mode: "insensitive" };
  if (filters.supervisor?.trim()) employeeWhere.supervisor = { fullName: { contains: filters.supervisor.trim(), mode: "insensitive" } };
  if (Object.keys(employeeWhere).length) where.employee = { is: employeeWhere };

  const search = filters.search?.trim();
  if (search) {
    where.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
      { category: { contains: search, mode: "insensitive" } },
      { employee: { fullName: { contains: search, mode: "insensitive" } } },
      { employee: { wbLogin: { contains: search, mode: "insensitive" } } },
      { employee: { user: { email: { contains: search, mode: "insensitive" } } } },
      { author: { name: { contains: search, mode: "insensitive" } } }
    ];
  }

  return where;
}

function visibleFormalFeedbackGuard(user: FormalFeedbackUser): Prisma.FormalFeedbackWhereInput {
  const role = normalizeRole(user.role.name);
  if (allFeedbackRoles.has(role)) return {};
  if (role === "SUPERVISOR") {
    const supervisorEmployeeId = user.employeeProfile?.id;
    if (!supervisorEmployeeId) return { authorId: user.id };
    return {
      OR: [
        { authorId: user.id },
        { employee: { supervisorId: supervisorEmployeeId } }
      ]
    };
  }
  if (user.employeeProfile?.id) return { employeeId: user.employeeProfile.id };
  return { id: "__no_access__" };
}

async function getFormalFeedbackEmployeeOptionsForUser(user: FormalFeedbackUser) {
  if (!canCreateFormalFeedback(user)) return [];
  const role = normalizeRole(user.role.name);
  const where: Prisma.EmployeeProfileWhereInput = {
    deletedAt: null,
    ...(role === "SUPERVISOR" ? { supervisorId: user.employeeProfile?.id ?? "__no_supervisor__" } : {})
  };
  const employees = await prisma.employeeProfile.findMany({
    where,
    select: {
      id: true,
      fullName: true,
      wbLogin: true,
      roleTitle: true,
      skill: true,
      user: { select: { email: true } },
      lob: { select: { name: true } },
      supervisor: { select: { fullName: true } }
    },
    orderBy: { fullName: "asc" },
    take: 1000
  });
  return employees
    .filter((employee) => isAgentJobTitle(employee.roleTitle))
    .map((employee) => ({
      id: employee.id,
      name: employee.fullName,
      wbLogin: employee.wbLogin,
      email: employee.user?.email ?? "",
      roleTitle: employee.roleTitle,
      skill: employee.skill ?? "",
      lob: employee.lob.name,
      supervisor: employee.supervisor?.fullName ?? "Sem supervisor"
    }));
}

async function requireUser(actor: Actor): Promise<FormalFeedbackUser> {
  if (!formalFeedbackEnabled) throw new FormalFeedbackError("Este módulo está temporariamente inativo.", 410);
  if (!actor.email) throw new FormalFeedbackError("Faça login para acessar Feedback Formal.", 401);
  const user = await prisma.user.findUnique({
    where: { email: actor.email },
    include: {
      role: true,
      employeeProfile: {
        include: {
          lob: true,
          supervisor: true
        }
      }
    }
  });
  if (!user || user.status !== "ACTIVE" || user.deletedAt) {
    throw new FormalFeedbackError("Usuário sem acesso ativo ao Feedback Formal.", 403);
  }
  return user;
}

function serializeFormalFeedback(feedback: FormalFeedbackWithRelations) {
  return {
    id: feedback.id,
    employeeId: feedback.employeeId,
    employeeName: feedback.employee.fullName,
    wbLogin: feedback.employee.wbLogin,
    employeeEmail: feedback.employee.user?.email ?? "",
    lob: feedback.employee.lob.name,
    supervisor: feedback.employee.supervisor?.fullName ?? "Sem supervisor",
    authorId: feedback.authorId,
    authorName: feedback.author.name,
    authorRole: feedback.authorRole,
    type: feedback.type,
    typeLabel: typeLabels[feedback.type],
    category: feedback.category,
    title: feedback.title,
    description: feedback.description,
    status: feedback.status,
    statusLabel: statusLabels[feedback.status],
    sentAt: formatDateTime(feedback.sentAt),
    viewedAt: feedback.viewedAt ? formatDateTime(feedback.viewedAt) : "",
    acknowledgedAt: feedback.acknowledgedAt ? formatDateTime(feedback.acknowledgedAt) : "",
    acknowledgedBy: feedback.acknowledgedBy?.name ?? "",
    employeeResponse: feedback.employeeResponse ?? "",
    createdAt: formatDateTime(feedback.createdAt),
    updatedAt: formatDateTime(feedback.updatedAt),
    archivedAt: feedback.archivedAt ? formatDateTime(feedback.archivedAt) : ""
  };
}

function normalizeFormalFeedbackType(value: string): FormalFeedbackType {
  const token = normalizeToken(value);
  if (token.includes("CORRET")) return "CORRETIVO";
  if (token.includes("POSIT")) return "POSITIVO";
  throw new FormalFeedbackError("Tipo de feedback inválido.");
}

function normalizeFormalFeedbackStatus(value: string): FormalFeedbackStatus {
  const token = normalizeToken(value);
  if (token.includes("PENDENTE")) return "PENDENTE_CIENCIA";
  if (token.includes("VISUAL")) return "VISUALIZADO";
  if (token.includes("CIENTE")) return "CIENTE";
  if (token.includes("ARQUIV")) return "ARQUIVADO";
  if (["PENDENTE_CIENCIA", "VISUALIZADO", "CIENTE", "ARQUIVADO"].includes(value)) return value as FormalFeedbackStatus;
  throw new FormalFeedbackError("Status de feedback inválido.");
}

function parseDateStart(value?: string) {
  if (!value) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseDateEnd(value?: string) {
  if (!value) return undefined;
  const date = new Date(`${value}T23:59:59.999Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function normalizeToken(value?: string | null) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toUpperCase();
}

function countMap<T extends string>(rows: Array<[T, number]>) {
  return rows.reduce<Partial<Record<T, number>>>((acc, [key, value]) => {
    acc[key] = value;
    return acc;
  }, {});
}

async function auditFormalFeedback(
  actorId: string | null,
  feedbackId: string | null,
  employeeId: string | null,
  action: "CRIACAO" | "EDICAO" | "UPLOAD" | "CONFIRMACAO_LEITURA",
  reason: string,
  after: unknown
) {
  await prisma.auditLog.create({
    data: {
      actorId,
      action,
      entity: "FormalFeedback",
      entityId: feedbackId,
      after: { feedbackId, employeeId, ...(typeof after === "object" && after ? after as Record<string, unknown> : { value: after }) },
      reason
    }
  }).catch(() => undefined);
}
