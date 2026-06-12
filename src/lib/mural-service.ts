import { AuditAction, AnnouncementStatus, Prisma, Priority } from "@prisma/client";

import type { Actor } from "@/lib/mock-db";
import { normalizeRole } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export type MuralPostInput = {
  title?: string;
  content?: string;
  contentType?: string;
  imageUrl?: string;
  mediaUrl?: string;
  externalUrl?: string;
  attachmentUrl?: string;
  targetRoles?: string[];
  targetLobIds?: string[];
  priority?: string;
  isPinned?: boolean;
  status?: string;
  expiresAt?: string;
};

type MuralUser = Prisma.UserGetPayload<{
  include: {
    role: true;
    employeeProfile: { include: { lob: true } };
  };
}>;

const roleAudienceMap: Record<string, string[]> = {
  ADMIN: ["ADMINISTRADORES"],
  GESTOR: ["GESTAO"],
  MANAGEMENT: ["GESTAO"],
  COORDENADOR: ["GESTAO"],
  GERENTE: ["GESTAO"],
  SUPERVISOR: ["SUPERVISORES"],
  WFM: ["WFM"],
  RH: ["RH"],
  QUALIDADE: ["GESTAO"],
  TI: ["GESTAO"],
  COLABORADOR: ["AGENTES"]
};

export class MuralError extends Error {
  status: number;
  fields?: Record<string, string>;

  constructor(message: string, status = 400, fields?: Record<string, string>) {
    super(message);
    this.name = "MuralError";
    this.status = status;
    this.fields = fields;
  }
}

export async function listMuralPosts(actor: Actor, filters: URLSearchParams) {
  const user = await requireMuralUser(actor);
  const isAdmin = canManageMural(user);
  const statusFilter = normalizeStatus(filters.get("status") ?? undefined);
  const priorityFilter = normalizePriority(filters.get("priority") ?? undefined);
  const typeFilter = filters.get("contentType")?.trim();
  const search = filters.get("q")?.trim();
  const lobFilter = filters.get("lobId")?.trim();
  const now = new Date();

  const where: Prisma.AnnouncementWhereInput = {
    deletedAt: null,
    ...(isAdmin ? (statusFilter ? { status: statusFilter } : {}) : { status: "PUBLICADO" }),
    ...(priorityFilter ? { priority: priorityFilter } : {}),
    ...(typeFilter && typeFilter !== "Todos" ? { contentType: typeFilter } : {}),
    ...(search
      ? { OR: [{ title: { contains: search, mode: "insensitive" } }, { content: { contains: search, mode: "insensitive" } }] }
      : {})
  };
  if (!isAdmin) {
    where.AND = [
      { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }
    ];
  }

  const posts = await prisma.announcement.findMany({
    where,
    include: { author: { select: { name: true, email: true, role: { select: { name: true } } } } },
    orderBy: [{ isPinned: "desc" }, { priority: "desc" }, { publishAt: "desc" }],
    take: Math.min(100, Math.max(10, Number(filters.get("limit")) || 50))
  });
  const filteredPosts = posts.filter((post) => {
    if (isAdmin && lobFilter && lobFilter !== "Todos") {
      const targetLobs = jsonStringArray(post.targetLobIds);
      return !targetLobs.length || targetLobs.includes(lobFilter);
    }
    return true;
  });
  return {
    data: filteredPosts.filter((post) => isAdmin || isPostVisibleToUser(post, user)).map((post) => mapMuralPost(post, user, isAdmin)),
    canManage: isAdmin
  };
}

export async function getMuralPost(actor: Actor, id: string) {
  const user = await requireMuralUser(actor);
  const isAdmin = canManageMural(user);
  const post = await prisma.announcement.findFirst({
    where: { id, deletedAt: null },
    include: { author: { select: { name: true, email: true, role: { select: { name: true } } } } }
  });
  if (!post || (!isAdmin && !isPostVisibleToUser(post, user))) throw new MuralError("Aviso não encontrado.", 404);
  return { data: mapMuralPost(post, user, isAdmin), canManage: isAdmin };
}

export async function createMuralPost(actor: Actor, input: MuralPostInput) {
  const user = await requireMuralUser(actor);
  requireManageMural(user);
  const data = validatePostInput(input);
  const post = await prisma.announcement.create({
    data: {
      ...data,
      category: data.contentType,
      targetAudience: data.targetRoles.includes("TODOS") ? "Todos" : data.targetRoles.join(", "),
      authorId: user.id,
      authorRole: user.role.name,
      publishAt: new Date()
    }
  });
  await auditMural(user.id, post.id, "MURAL_POST_CREATED", post);
  return { data: post };
}

export async function updateMuralPost(actor: Actor, id: string, input: MuralPostInput) {
  const user = await requireMuralUser(actor);
  requireManageMural(user);
  const previous = await prisma.announcement.findFirst({ where: { id, deletedAt: null } });
  if (!previous) throw new MuralError("Aviso não encontrado.", 404);
  const data = validatePostInput(input);
  const post = await prisma.announcement.update({
    where: { id },
    data: {
      ...data,
      category: data.contentType,
      targetAudience: data.targetRoles.includes("TODOS") ? "Todos" : data.targetRoles.join(", ")
    }
  });
  await auditMural(user.id, id, "MURAL_POST_UPDATED", { previous, post });
  return { data: post };
}

export async function updateMuralPostStatus(actor: Actor, id: string, status: string) {
  const user = await requireMuralUser(actor);
  requireManageMural(user);
  const nextStatus = normalizeStatus(status);
  if (!nextStatus) throw new MuralError("Status inválido para o aviso.", 400);
  const post = await prisma.announcement.update({
    where: { id },
    data: {
      status: nextStatus,
      archivedAt: nextStatus === "ARQUIVADO" ? new Date() : null
    }
  });
  await auditMural(user.id, id, "MURAL_POST_STATUS_UPDATED", { status: nextStatus });
  return { data: post };
}

export async function deleteMuralPost(actor: Actor, id: string) {
  const user = await requireMuralUser(actor);
  requireManageMural(user);
  const post = await prisma.announcement.update({ where: { id }, data: { deletedAt: new Date() } });
  await auditMural(user.id, id, "MURAL_POST_DELETED", {});
  return { data: post };
}

export async function listMuralBirthdays(actor: Actor) {
  const user = await requireMuralUser(actor);
  const today = saoPauloParts();
  const sensitiveRows = await prisma.employeeSensitiveData.findMany({ select: { employeeId: true, birthDate: true } });
  const relevant = sensitiveRows.filter((row) => row.birthDate.getUTCMonth() + 1 === today.month);
  const employees = await prisma.employeeProfile.findMany({
    where: { id: { in: relevant.map((row) => row.employeeId) }, deletedAt: null },
    select: { id: true, fullName: true, operationalStatus: true, lob: { select: { name: true } } }
  });
  const employeeById = new Map(employees.filter((employee) => !isTerminated(employee.operationalStatus)).map((employee) => [employee.id, employee]));
  const birthdays = relevant
    .map((row) => {
      const employee = employeeById.get(row.employeeId);
      if (!employee) return null;
      const day = row.birthDate.getUTCDate();
      const month = row.birthDate.getUTCMonth() + 1;
      return {
        employeeId: row.employeeId,
        name: employee.fullName,
        lob: employee.lob?.name ?? "Sem LOB",
        day,
        month,
        dateLabel: `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}`,
        isToday: day === today.day && month === today.month
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((a, b) => a.day - b.day || a.name.localeCompare(b.name, "pt-BR"));
  return {
    data: {
      today: birthdays.filter((item) => item.isToday),
      month: birthdays
    },
    canManage: canManageMural(user)
  };
}

async function requireMuralUser(actor: Actor): Promise<MuralUser> {
  if (!actor.email) throw new MuralError("Faça login para acessar o Mural.", 401);
  const user = await prisma.user.findUnique({
    where: { email: actor.email },
    include: { role: true, employeeProfile: { include: { lob: true } } }
  });
  if (!user || user.status !== "ACTIVE") throw new MuralError("Usuário ativo não encontrado.", 401);
  if (normalizeRole(user.role.name) === "CLIENT") throw new MuralError("Você não tem permissão para acessar o Mural.", 403);
  return user;
}

function canManageMural(user: MuralUser) {
  return normalizeRole(user.role.name) === "ADMIN";
}

function requireManageMural(user: MuralUser) {
  if (!canManageMural(user)) throw new MuralError("Você não tem permissão para gerenciar o Mural.", 403);
}

function validatePostInput(input: MuralPostInput) {
  const title = input.title?.trim() ?? "";
  const content = input.content?.trim() ?? "";
  const contentType = input.contentType?.trim() || "Texto simples";
  const targetRoles = normalizeTargetRoles(input.targetRoles);
  const targetLobIds = normalizeStringArray(input.targetLobIds);
  const priority = normalizePriority(input.priority) ?? "MEDIA";
  const status = normalizeStatus(input.status) ?? "RASCUNHO";
  const fields: Record<string, string> = {};
  if (!title) fields.title = "Título é obrigatório.";
  if (!content) fields.content = "Conteúdo é obrigatório.";
  if (!targetRoles.length) fields.targetRoles = "Público-alvo é obrigatório.";
  const urls = {
    imageUrl: optionalUrl(input.imageUrl, "URL da imagem inválida.", fields, "imageUrl"),
    mediaUrl: optionalUrl(input.mediaUrl, "URL de mídia inválida.", fields, "mediaUrl"),
    externalUrl: optionalUrl(input.externalUrl, "Link externo inválido.", fields, "externalUrl"),
    attachmentUrl: optionalUrl(input.attachmentUrl, "URL do anexo inválida.", fields, "attachmentUrl")
  };
  if (["Texto com link", "Vídeo", "Anexo"].includes(contentType) && !urls.mediaUrl && !urls.externalUrl && !urls.attachmentUrl) {
    fields.mediaUrl = "Informe uma URL para este tipo de conteúdo.";
  }
  const expiresAt = input.expiresAt?.trim() ? new Date(`${input.expiresAt.trim()}T23:59:59.999Z`) : null;
  if (input.expiresAt?.trim() && Number.isNaN(expiresAt?.getTime())) fields.expiresAt = "Data de expiração inválida.";
  if (Object.keys(fields).length) throw new MuralError("Revise os campos do aviso.", 400, fields);
  return {
    title,
    content,
    contentType,
    ...urls,
    targetRoles,
    targetLobIds,
    priority,
    status,
    isPinned: Boolean(input.isPinned),
    expiresAt
  };
}

function normalizeTargetRoles(values?: string[]) {
  const allowed = new Set(["TODOS", "AGENTES", "SUPERVISORES", "ADMINISTRADORES", "WFM", "RH", "GESTAO"]);
  return normalizeStringArray(values).map((value) => normalizeAudienceToken(value)).filter((value) => allowed.has(value));
}

function normalizeStringArray(values?: string[]) {
  return Array.from(new Set((values ?? []).map((value) => String(value ?? "").trim()).filter(Boolean)));
}

function optionalUrl(value: unknown, message: string, fields: Record<string, string>, field: string) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("invalid");
    return url.toString();
  } catch {
    fields[field] = message;
    return null;
  }
}

function normalizeStatus(value?: string | null): AnnouncementStatus | null {
  const token = normalizeAudienceToken(value ?? "");
  const map: Record<string, AnnouncementStatus> = {
    RASCUNHO: "RASCUNHO",
    AGENDADO: "AGENDADO",
    PUBLICADO: "PUBLICADO",
    INATIVO: "INATIVO",
    ARQUIVADO: "ARQUIVADO"
  };
  return map[token] ?? null;
}

function normalizePriority(value?: string | null): Priority | null {
  const token = normalizeAudienceToken(value ?? "");
  const map: Record<string, Priority> = {
    BAIXA: "BAIXA",
    MEDIA: "MEDIA",
    ALTA: "ALTA",
    CRITICA: "CRITICA"
  };
  return map[token] ?? null;
}

function isPostVisibleToUser(post: { targetRoles?: Prisma.JsonValue | null; targetLobIds?: Prisma.JsonValue | null; status: AnnouncementStatus; expiresAt?: Date | null }, user: MuralUser) {
  if (post.status !== "PUBLICADO") return false;
  if (post.expiresAt && post.expiresAt <= new Date()) return false;
  const targetRoles = jsonStringArray(post.targetRoles);
  const targetLobs = jsonStringArray(post.targetLobIds);
  const roleMatches = !targetRoles.length || targetRoles.includes("TODOS") || viewerAudiences(user).some((audience) => targetRoles.includes(audience));
  const lobMatches = !targetLobs.length || Boolean(user.employeeProfile?.lobId && targetLobs.includes(user.employeeProfile.lobId));
  return roleMatches && lobMatches;
}

function viewerAudiences(user: MuralUser) {
  const role = normalizeRole(user.role.name);
  return [role, ...(roleAudienceMap[role] ?? [])].map(normalizeAudienceToken);
}

function mapMuralPost(post: Prisma.AnnouncementGetPayload<{ include: { author: { select: { name: true; email: true; role: { select: { name: true } } } } } }>, user: MuralUser, canManage: boolean) {
  return {
    id: post.id,
    title: post.title,
    content: post.content,
    contentType: post.contentType,
    imageUrl: post.imageUrl,
    mediaUrl: post.mediaUrl,
    externalUrl: post.externalUrl,
    attachmentUrl: post.attachmentUrl,
    targetRoles: jsonStringArray(post.targetRoles),
    targetLobIds: jsonStringArray(post.targetLobIds),
    authorName: post.author.name,
    authorEmail: canManage ? post.author.email : "",
    authorRole: post.authorRole ?? post.author.role.name,
    status: post.status,
    priority: post.priority,
    isPinned: post.isPinned,
    requiresRead: post.requiresRead,
    publishAt: post.publishAt.toISOString(),
    expiresAt: post.expiresAt?.toISOString() ?? "",
    archivedAt: post.archivedAt?.toISOString() ?? "",
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
    canManage
  };
}

function jsonStringArray(value: Prisma.JsonValue | null | undefined) {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

function normalizeAudienceToken(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase().replace(/\s+/g, "_");
}

function isTerminated(status?: string | null) {
  const token = normalizeAudienceToken(status ?? "");
  return ["DESLIGADO", "DESLIGADA", "DESLIGADO_EM_TREINAMENTO", "DESLIGADA_EM_TREINAMENTO", "INATIVO", "DESATIVADO"].includes(token);
}

function saoPauloParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const numberPart = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: numberPart("year"), month: numberPart("month"), day: numberPart("day") };
}

async function auditMural(actorId: string, postId: string, reason: string, after: unknown) {
  await prisma.auditLog.create({
    data: {
      actorId,
      action: AuditAction.EDICAO,
      entity: "MuralPost",
      entityId: postId,
      after: JSON.parse(JSON.stringify(after)) as Prisma.InputJsonValue,
      reason
    }
  }).catch(() => undefined);
}
