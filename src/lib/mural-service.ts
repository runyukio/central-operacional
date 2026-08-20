import { AuditAction, AnnouncementStatus, Prisma, Priority } from "@prisma/client";

import type { Actor } from "@/lib/mock-db";
import { normalizeRole } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { dateStamp, type XlsxExportPayload } from "@/lib/xlsx-export";

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
  requiresAcknowledgement?: boolean;
  status?: string;
  expiresAt?: string;
};

export type MuralAcknowledgementFilters = {
  status?: string | null;
  lobId?: string | null;
  role?: string | null;
  supervisorId?: string | null;
  q?: string | null;
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
  COLABORADOR: ["AGENTES"],
  CLIENT: ["CLIENT"]
};

type MuralPostForVisibility = {
  targetRoles?: Prisma.JsonValue | null;
  targetLobIds?: Prisma.JsonValue | null;
  status: AnnouncementStatus;
  expiresAt?: Date | null;
};

type MuralPostWithAuthor = Prisma.AnnouncementGetPayload<{
  include: {
    author: { select: { name: true; email: true; role: { select: { name: true } } } };
    acknowledgements: { select: { acknowledgedAt: true; userId: true } };
  };
}>;

type MuralEligibleUser = Prisma.UserGetPayload<{
  include: {
    role: true;
    employeeProfile: {
      include: {
        lob: { select: { name: true } };
        supervisor: { select: { fullName: true; wbLogin: true } };
      };
    };
  };
}>;

type MuralAcknowledgementSummary = {
  eligible: number;
  acknowledged: number;
  pending: number;
  adherence: number | null;
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
    include: {
      author: { select: { name: true, email: true, role: { select: { name: true } } } },
      acknowledgements: { where: { userId: user.id }, select: { userId: true, acknowledgedAt: true } }
    },
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
  const visiblePosts = filteredPosts.filter((post) => isAdmin || isPostVisibleToUser(post, user));
  const summaries = await buildAcknowledgementSummaries(visiblePosts, isAdmin);
  return {
    data: visiblePosts.map((post) => mapMuralPost(post, user, isAdmin, summaries.get(post.id))),
    canManage: isAdmin
  };
}

export async function getMuralPost(actor: Actor, id: string) {
  const user = await requireMuralUser(actor);
  const isAdmin = canManageMural(user);
  const post = await prisma.announcement.findFirst({
    where: { id, deletedAt: null },
    include: {
      author: { select: { name: true, email: true, role: { select: { name: true } } } },
      acknowledgements: { where: { userId: user.id }, select: { userId: true, acknowledgedAt: true } }
    }
  });
  if (!post || (!isAdmin && !isPostVisibleToUser(post, user))) throw new MuralError("Aviso não encontrado.", 404);
  const summary = post.requiresAcknowledgement ? await buildAcknowledgementSummary(post) : undefined;
  return { data: mapMuralPost(post, user, isAdmin, summary), canManage: isAdmin };
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
  if (post.requiresAcknowledgement && post.status === "PUBLICADO") {
    await notifyMuralAcknowledgementAudience(post, user.id);
  }
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
  if (post.requiresAcknowledgement && post.status === "PUBLICADO" && (!previous.requiresAcknowledgement || previous.status !== "PUBLICADO")) {
    await notifyMuralAcknowledgementAudience(post, user.id);
  }
  if (previous.requiresAcknowledgement !== post.requiresAcknowledgement) {
    await auditMural(user.id, id, "MURAL_POST_REQUIRE_ACK_UPDATED", { previous: previous.requiresAcknowledgement, next: post.requiresAcknowledgement });
  }
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
  if (post.requiresAcknowledgement && post.status === "PUBLICADO") {
    await notifyMuralAcknowledgementAudience(post, user.id);
  }
  await auditMural(user.id, id, "MURAL_POST_STATUS_UPDATED", { status: nextStatus });
  return { data: post };
}

export async function deleteMuralPost(actor: Actor, id: string) {
  const user = await requireMuralUser(actor);
  requireManageMural(user);
  const existing = await prisma.announcement.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new MuralError("Aviso não encontrado.", 404);
  const deletedAt = new Date();
  const post = await prisma.$transaction(async (tx) => {
    const deleted = await tx.announcement.update({
      where: { id },
      data: { deletedAt }
    });
    await tx.notification.updateMany({
      where: { entity: "MuralPost", entityId: id, isRead: false },
      data: { isRead: true, readAt: deletedAt }
    });
    return deleted;
  });
  await auditMural(user.id, id, "MURAL_POST_DELETED", { title: existing.title, deletedAt }, AuditAction.EXCLUSAO);
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

export async function acknowledgeMuralPost(actor: Actor, id: string) {
  const user = await requireMuralUser(actor);
  const post = await prisma.announcement.findFirst({
    where: { id, deletedAt: null },
    include: {
      author: { select: { name: true, email: true, role: { select: { name: true } } } },
      acknowledgements: { where: { userId: user.id }, select: { userId: true, acknowledgedAt: true } }
    }
  });
  if (!post || !isPostVisibleToUser(post, user)) throw new MuralError("Aviso não encontrado.", 404);
  if (!post.requiresAcknowledgement) throw new MuralError("Este comunicado não exige ciência.", 400);

  await prisma.muralPostAcknowledgement.upsert({
    where: { postId_userId: { postId: post.id, userId: user.id } },
    update: {},
    create: {
      postId: post.id,
      userId: user.id,
      employeeId: user.employeeProfile?.id ?? null,
      roleAtAcknowledgement: normalizeRole(user.role.name),
      lobIdAtAcknowledgement: user.employeeProfile?.lobId ?? null
    }
  });

  await prisma.notification.updateMany({
    where: { userId: user.id, entity: "MuralPost", entityId: post.id, category: "MURAL_ACKNOWLEDGEMENT", isRead: false },
    data: { isRead: true, readAt: new Date() }
  });

  await auditMural(user.id, post.id, "MURAL_POST_ACKNOWLEDGED", {
    userId: user.id,
    employeeId: user.employeeProfile?.id ?? null
  }, AuditAction.CONFIRMACAO_LEITURA);

  const refreshed = await prisma.announcement.findFirst({
    where: { id: post.id },
    include: {
      author: { select: { name: true, email: true, role: { select: { name: true } } } },
      acknowledgements: { where: { userId: user.id }, select: { userId: true, acknowledgedAt: true } }
    }
  });
  return {
    data: refreshed ? mapMuralPost(refreshed, user, canManageMural(user), await buildAcknowledgementSummary(refreshed)) : null,
    message: "Ciência registrada com sucesso."
  };
}

export async function listMuralPostAcknowledgements(actor: Actor, id: string, filters: MuralAcknowledgementFilters = {}) {
  const user = await requireMuralUser(actor);
  requireManageMural(user);
  const post = await findMuralPostForAcknowledgement(id);
  const payload = await buildAcknowledgementPanel(post, filters);
  return { ...payload, canManage: true };
}

export async function exportMuralPostAcknowledgements(actor: Actor, id: string, filters: MuralAcknowledgementFilters = {}): Promise<XlsxExportPayload> {
  const user = await requireMuralUser(actor);
  requireManageMural(user);
  const post = await findMuralPostForAcknowledgement(id);
  const payload = await buildAcknowledgementPanel(post, filters);

  await auditMural(user.id, post.id, "MURAL_ACKNOWLEDGEMENT_EXPORT", {
    postId: post.id,
    rows: payload.data.length
  }, AuditAction.UPLOAD);

  return {
    fileName: `aderencia_mural_${dateStamp()}_${post.id}.xlsx`,
    sheetName: "Aderencia Mural",
    headers: [
      "titulo_post",
      "post_id",
      "parceiro",
      "wb_login",
      "email",
      "role",
      "lob",
      "supervisor",
      "status_ciencia",
      "ciente_em",
      "criado_em_post",
      "publico_alvo_roles",
      "publico_alvo_lobs"
    ],
    rows: payload.data.map((row) => [
      post.title,
      post.id,
      row.name,
      row.wbLogin,
      row.email,
      row.role,
      row.lob,
      row.supervisor,
      row.status,
      row.acknowledgedAt ? formatDateTime(row.acknowledgedAt) : "",
      formatDateTime(post.createdAt),
      jsonStringArray(post.targetRoles).join(", "),
      payload.targetLobs.join(", ")
    ])
  };
}

export async function getMuralPendingAcknowledgementCount(actor: Actor) {
  const user = await requireMuralUser(actor);
  const posts = await prisma.announcement.findMany({
    where: {
      deletedAt: null,
      status: "PUBLICADO",
      requiresAcknowledgement: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
    },
    include: {
      author: { select: { name: true, email: true, role: { select: { name: true } } } },
      acknowledgements: { where: { userId: user.id }, select: { userId: true, acknowledgedAt: true } }
    }
  });
  const pending = posts.filter((post) => isPostVisibleToUser(post, user) && !post.acknowledgements.length);
  return { count: pending.length, postIds: pending.map((post) => post.id) };
}

async function requireMuralUser(actor: Actor): Promise<MuralUser> {
  if (!actor.email) throw new MuralError("Faça login para acessar o Mural.", 401);
  const user = await prisma.user.findUnique({
    where: { email: actor.email },
    include: { role: true, employeeProfile: { include: { lob: true } } }
  });
  if (!user || user.status !== "ACTIVE") throw new MuralError("Usuário ativo não encontrado.", 401);
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
    requiresAcknowledgement: Boolean(input.requiresAcknowledgement),
    expiresAt
  };
}

function normalizeTargetRoles(values?: string[]) {
  const allowed = new Set(["TODOS", "AGENTES", "SUPERVISORES", "ADMINISTRADORES", "WFM", "RH", "GESTAO", "CLIENT"]);
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

function isPostVisibleToUser(post: MuralPostForVisibility, user: MuralUser) {
  if (post.status !== "PUBLICADO") return false;
  if (post.expiresAt && post.expiresAt <= new Date()) return false;
  return isPostTargetedToUser(post, user);
}

function isPostTargetedToUser(post: Pick<MuralPostForVisibility, "targetRoles" | "targetLobIds">, user: Pick<MuralEligibleUser | MuralUser, "role" | "employeeProfile">) {
  const targetRoles = jsonStringArray(post.targetRoles);
  const targetLobs = jsonStringArray(post.targetLobIds);
  const roleMatches = !targetRoles.length || targetRoles.includes("TODOS") || viewerAudiences(user).some((audience) => targetRoles.includes(audience));
  const lobMatches = !targetLobs.length || Boolean(user.employeeProfile?.lobId && targetLobs.includes(user.employeeProfile.lobId));
  return roleMatches && lobMatches;
}

function viewerAudiences(user: Pick<MuralEligibleUser | MuralUser, "role">) {
  const role = normalizeRole(user.role.name);
  return [role, ...(roleAudienceMap[role] ?? [])].map(normalizeAudienceToken);
}

function roleMatchesAcknowledgementFilter(role: string, filter: string) {
  const roleToken = normalizeRole(role);
  const filterToken = normalizeAudienceToken(filter);
  if (!filterToken || filterToken === "TODOS") return true;
  const audiences = [roleToken, ...(roleAudienceMap[roleToken] ?? [])].map(normalizeAudienceToken);
  return audiences.includes(filterToken);
}

function mapMuralPost(post: MuralPostWithAuthor, user: MuralUser, canManage: boolean, acknowledgementSummary?: MuralAcknowledgementSummary) {
  const ownAcknowledgement = post.acknowledgements[0]?.acknowledgedAt ?? null;
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
    requiresAcknowledgement: post.requiresAcknowledgement,
    acknowledgedByViewer: Boolean(ownAcknowledgement),
    viewerAcknowledgedAt: ownAcknowledgement?.toISOString() ?? "",
    acknowledgementStatus: post.requiresAcknowledgement ? (ownAcknowledgement ? "Ciente" : "Pendente de ciência") : "Não exige ciência",
    acknowledgementSummary: acknowledgementSummary ?? null,
    publishAt: post.publishAt.toISOString(),
    expiresAt: post.expiresAt?.toISOString() ?? "",
    archivedAt: post.archivedAt?.toISOString() ?? "",
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
    canManage
  };
}

async function buildAcknowledgementSummaries(posts: MuralPostWithAuthor[], includeSummary: boolean) {
  const map = new Map<string, MuralAcknowledgementSummary>();
  await Promise.all(posts.map(async (post) => {
    if (!post.requiresAcknowledgement) return;
    if (!includeSummary && !post.requiresAcknowledgement) return;
    map.set(post.id, await buildAcknowledgementSummary(post));
  }));
  return map;
}

async function buildAcknowledgementSummary(post: Pick<AnnouncementForAcknowledgement, "id" | "targetRoles" | "targetLobIds">) {
  const eligible = await getEligibleAcknowledgementUsers(post);
  if (!eligible.length) {
    return { eligible: 0, acknowledged: 0, pending: 0, adherence: null };
  }
  const acknowledged = await prisma.muralPostAcknowledgement.count({
    where: { postId: post.id, userId: { in: eligible.map((user) => user.id) } }
  });
  return {
    eligible: eligible.length,
    acknowledged,
    pending: Math.max(0, eligible.length - acknowledged),
    adherence: Math.round((acknowledged / eligible.length) * 1000) / 10
  };
}

type AnnouncementForAcknowledgement = Prisma.AnnouncementGetPayload<{
  include: {
    author: { select: { name: true; email: true; role: { select: { name: true } } } };
  };
}>;

async function findMuralPostForAcknowledgement(id: string) {
  const post = await prisma.announcement.findFirst({
    where: { id, deletedAt: null },
    include: { author: { select: { name: true, email: true, role: { select: { name: true } } } } }
  });
  if (!post) throw new MuralError("Aviso não encontrado.", 404);
  if (!post.requiresAcknowledgement) throw new MuralError("Este comunicado não exige ciência.", 400);
  return post;
}

async function getEligibleAcknowledgementUsers(post: Pick<AnnouncementForAcknowledgement, "targetRoles" | "targetLobIds">) {
  const users = await prisma.user.findMany({
    where: { status: "ACTIVE" },
    include: {
      role: true,
      employeeProfile: {
        include: {
          lob: { select: { name: true } },
          supervisor: { select: { fullName: true, wbLogin: true } }
        }
      }
    },
    orderBy: { name: "asc" }
  });
  return users.filter((user) => {
    if (user.employeeProfile?.deletedAt) return false;
    // Aderência do Mural é sempre a interseção entre público-alvo e LOB alvo do comunicado.
    // Usuários fora de qualquer uma dessas duas regras não entram como cientes nem pendentes.
    return isPostTargetedToUser(post, user);
  });
}

async function buildAcknowledgementPanel(post: AnnouncementForAcknowledgement, filters: MuralAcknowledgementFilters = {}) {
  const eligible = await getEligibleAcknowledgementUsers(post);
  const acknowledgements = await prisma.muralPostAcknowledgement.findMany({
    where: { postId: post.id, userId: { in: eligible.map((user) => user.id) } },
    select: { userId: true, acknowledgedAt: true }
  });
  const acknowledgedByUser = new Map(acknowledgements.map((ack) => [ack.userId, ack.acknowledgedAt]));
  const targetLobIds = jsonStringArray(post.targetLobIds);
  const lobNames = targetLobIds.length
    ? await prisma.lob.findMany({ where: { id: { in: targetLobIds } }, select: { name: true } }).then((rows) => rows.map((lob) => lob.name))
    : ["Todas"];

  const normalizedStatus = normalizeAudienceToken(filters.status ?? "");
  const roleFilter = normalizeAudienceToken(filters.role ?? "");
  const search = normalizeSearch(filters.q ?? "");
  const rows = eligible
    .map((user) => {
      const acknowledgedAt = acknowledgedByUser.get(user.id) ?? null;
      return {
        userId: user.id,
        employeeId: user.employeeProfile?.id ?? "",
        name: user.employeeProfile?.fullName ?? user.name,
        wbLogin: user.employeeProfile?.wbLogin ?? "",
        email: user.email,
        role: normalizeRole(user.role.name),
        lobId: user.employeeProfile?.lobId ?? "",
        lob: user.employeeProfile?.lob?.name ?? "Sem LOB",
        supervisorId: user.employeeProfile?.supervisorId ?? "",
        supervisor: user.employeeProfile?.supervisor?.fullName ?? "",
        status: acknowledgedAt ? "Ciente" : "Pendente",
        acknowledgedAt: acknowledgedAt?.toISOString() ?? ""
      };
    })
    .filter((row) => {
      if (normalizedStatus === "CIENTE" && row.status !== "Ciente") return false;
      if (normalizedStatus === "PENDENTE" && row.status !== "Pendente") return false;
      if (filters.lobId && filters.lobId !== "Todos" && row.lobId !== filters.lobId) return false;
      if (!roleMatchesAcknowledgementFilter(row.role, roleFilter)) return false;
      if (filters.supervisorId && filters.supervisorId !== "Todos" && row.supervisorId !== filters.supervisorId) return false;
      if (search && !normalizeSearch(`${row.name} ${row.wbLogin} ${row.email}`).includes(search)) return false;
      return true;
    });

  const summary = {
    eligible: eligible.length,
    acknowledged: acknowledgements.length,
    pending: Math.max(0, eligible.length - acknowledgements.length),
    adherence: eligible.length ? Math.round((acknowledgements.length / eligible.length) * 1000) / 10 : null
  };
  return {
    post: {
      id: post.id,
      title: post.title,
      createdAt: post.createdAt.toISOString(),
      targetRoles: jsonStringArray(post.targetRoles),
      targetLobIds
    },
    targetLobs: lobNames,
    summary,
    data: rows
  };
}

async function notifyMuralAcknowledgementAudience(post: Pick<AnnouncementForAcknowledgement, "id" | "title" | "targetRoles" | "targetLobIds">, actorId: string) {
  const eligible = await getEligibleAcknowledgementUsers(post);
  if (!eligible.length) return;
  const existing = await prisma.notification.findMany({
    where: { entity: "MuralPost", entityId: post.id, category: "MURAL_ACKNOWLEDGEMENT" },
    select: { userId: true }
  });
  const existingUserIds = new Set(existing.map((notification) => notification.userId));
  const data = eligible
    .filter((user) => !existingUserIds.has(user.id))
    .map((user) => ({
      userId: user.id,
      title: "Comunicado exige ciência",
      body: `Você possui um comunicado pendente de ciência: ${post.title}`,
      category: "MURAL_ACKNOWLEDGEMENT",
      type: "INFO",
      entity: "MuralPost",
      entityId: post.id,
      href: `/mural?postId=${encodeURIComponent(post.id)}`
    }));
  if (data.length) await prisma.notification.createMany({ data });
  await auditMural(actorId, post.id, "MURAL_ACKNOWLEDGEMENT_NOTIFICATIONS_CREATED", { count: data.length });
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

function normalizeSearch(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function formatDateTime(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

async function auditMural(actorId: string, postId: string, reason: string, after: unknown, action: AuditAction = AuditAction.EDICAO) {
  await prisma.auditLog.create({
    data: {
      actorId,
      action,
      entity: "MuralPost",
      entityId: postId,
      after: JSON.parse(JSON.stringify(after)) as Prisma.InputJsonValue,
      reason
    }
  }).catch(() => undefined);
}
