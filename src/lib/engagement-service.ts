import { AnonymousFeedbackStatus, ClimateQuestionType, Prisma } from "@prisma/client";

import type { Actor } from "@/lib/mock-db";
import {
  canExportAnonymousFeedback,
  canManageAnonymousFeedback,
  canSubmitAnonymousFeedback,
  canViewAnonymousFeedbackAdmin,
  isAgentEmployee,
  normalizeRole
} from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export class EngagementError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "EngagementError";
    this.status = status;
  }
}

type AuthenticatedUser = Prisma.UserGetPayload<{
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

type ClimateSurveyWithDetails = Prisma.ClimateSurveyGetPayload<{
  include: {
    questions: true;
    answers: {
      include: {
        question: true;
      };
    };
    responses: {
      include: {
        answers: {
          include: {
            question: true;
          };
        };
      };
    };
  };
}>;

export type AnonymousFeedbackInput = {
  category: string;
  urgency: string;
  comment: string;
  allowContact?: boolean;
  evidenceUrl?: string;
};

export type AnonymousFeedbackFilters = {
  startDate?: string;
  endDate?: string;
  category?: string;
  urgency?: string;
  status?: string;
  lobId?: string;
  lob?: string;
  jobTitle?: string;
  search?: string;
  page?: number;
  limit?: number;
};

export type ClimateSurveyInput = {
  id?: string;
  title: string;
  description?: string;
  startsAt: string;
  endsAt: string;
  anonymous?: boolean;
  status?: string;
  targetType?: string;
  targetValue?: string;
  questions?: Array<{
    text: string;
    type: string;
    options?: string[];
    required?: boolean;
  }>;
};

export type ClimateAnswerInput = {
  surveyId: string;
  answers: Array<{ questionId: string; value?: unknown }>;
};

const feedbackStatusLabels: Record<AnonymousFeedbackStatus, string> = {
  RECEBIDO: "Novo",
  EM_ANALISE: "Em análise",
  PLANO_DE_ACAO: "Em análise",
  CONCLUIDO: "Resolvido",
  ARQUIVADO: "Arquivado"
};

const defaultClimateQuestions = [
  "De forma geral, estou satisfeito(a) em trabalhar na empresa.",
  "Sinto que tenho um ambiente saudável para trabalhar.",
  "Meu supervisor/líder me apoia quando preciso de ajuda.",
  "Recebo orientações claras sobre o que é esperado de mim.",
  "Tenho abertura para falar com minha liderança sobre dificuldades.",
  "A comunicação da operação é clara.",
  "Meu cronograma é claro e fácil de acompanhar.",
  "Minha carga de trabalho está equilibrada.",
  "Tenho as ferramentas e acessos necessários para realizar meu trabalho.",
  "Sinto que meu trabalho é reconhecido.",
  "O que está funcionando bem?",
  "O que precisa melhorar?"
];

export async function listAnonymousFeedback(actor: Actor, filters: AnonymousFeedbackFilters = {}) {
  const user = await requireUser(actor);
  requireAnonymousFeedbackAdmin(user);

  const page = Math.max(1, Number(filters.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(filters.limit) || 25));
  const where = await buildAnonymousFeedbackWhere(filters);

  const [items, total, statusCounts, urgencyCounts] = await Promise.all([
    prisma.anonymousFeedback.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit
    }),
    prisma.anonymousFeedback.count({ where }),
    prisma.anonymousFeedback.groupBy({ by: ["status"], where, _count: { _all: true } }),
    prisma.anonymousFeedback.groupBy({ by: ["urgency"], where, _count: { _all: true } })
  ]);

  const lobIds = [...new Set(items.map((item) => item.lobId).filter(Boolean))] as string[];
  const contactIds = [...new Set(items.filter((item) => item.allowContact).map((item) => item.contactUserId).filter(Boolean))] as string[];
  const [lobs, contacts] = await Promise.all([
    lobIds.length ? prisma.lob.findMany({ where: { id: { in: lobIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    contactIds.length
      ? prisma.user.findMany({
          where: { id: { in: contactIds } },
          select: { id: true, name: true, email: true, employeeProfile: { select: { wbLogin: true } } }
        })
      : Promise.resolve([])
  ]);
  const lobMap = new Map(lobs.map((lob) => [lob.id, lob.name]));
  const contactMap = new Map(contacts.map((contact) => [contact.id, contact]));
  const statusMap = countMap(statusCounts.map((row) => [row.status, row._count._all]));
  const urgencyMap = countMap(urgencyCounts.map((row) => [row.urgency, row._count._all]));

  return {
    data: items.map((item) => serializeAnonymousFeedback(item, lobMap, contactMap)),
    summary: {
      total,
      new: statusMap.RECEBIDO ?? 0,
      inReview: (statusMap.EM_ANALISE ?? 0) + (statusMap.PLANO_DE_ACAO ?? 0),
      resolved: statusMap.CONCLUIDO ?? 0,
      archived: statusMap.ARQUIVADO ?? 0,
      critical: urgencyMap.CRITICA ?? 0
    },
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit))
    }
  };
}

export async function createAnonymousFeedback(actor: Actor, input: AnonymousFeedbackInput) {
  const user = await requireUser(actor);
  if (!user.employeeProfile) {
    throw new EngagementError("Seu usuário não está vinculado a um cadastro de colaborador.", 403);
  }
  if (!canSubmitAnonymousFeedback(permissionUserFromAuthenticatedUser(user))) {
    throw new EngagementError("Seu perfil possui acesso administrativo ao Feedback Anônimo. Use a visão administrativa.", 403);
  }
  const category = input.category.trim();
  const message = input.comment.trim();
  if (!category) throw new EngagementError("Categoria é obrigatória.");
  if (!message || message.length < 8) throw new EngagementError("Comentário é obrigatório e deve ter pelo menos 8 caracteres.");

  const feedback = await prisma.anonymousFeedback.create({
    data: {
      category,
      message,
      urgency: normalizeUrgency(input.urgency),
      allowContact: Boolean(input.allowContact),
      contactUserId: input.allowContact ? user.id : null,
      evidenceUrl: input.evidenceUrl?.trim() || null,
      lobId: user.employeeProfile?.lobId ?? null,
      jobTitle: user.employeeProfile?.roleTitle ?? null
    }
  });

  await prisma.auditLog.create({
    data: {
      actorId: input.allowContact ? user.id : null,
      action: "CRIACAO",
      entity: "AnonymousFeedback",
      entityId: feedback.id,
      after: {
        category: feedback.category,
        urgency: feedback.urgency,
        allowContact: feedback.allowContact,
        anonymous: !feedback.allowContact
      },
      reason: "ANONYMOUS_FEEDBACK_SUBMITTED"
    }
  }).catch(() => undefined);

  return {
    data: {
      id: feedback.id,
      status: feedbackStatusLabels[feedback.status],
      identityStored: feedback.allowContact,
      message: "Feedback enviado com sucesso. Obrigado por compartilhar sua percepção."
    }
  };
}

export async function updateAnonymousFeedbackStatus(actor: Actor, input: { id: string; status: string }) {
  const user = await requireUser(actor);
  requireAnonymousFeedbackManager(user);
  const status = normalizeFeedbackStatus(input.status);
  const current = await prisma.anonymousFeedback.findUnique({ where: { id: input.id } });
  if (!current) throw new EngagementError("Feedback não encontrado.", 404);

  const updated = await prisma.anonymousFeedback.update({
    where: { id: input.id },
    data: {
      status,
      resolvedAt: status === "CONCLUIDO" ? new Date() : null,
      resolvedById: status === "CONCLUIDO" ? user.id : null
    }
  });

  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      action: "EDICAO",
      entity: "AnonymousFeedback",
      entityId: updated.id,
      before: { status: current.status },
      after: { status: updated.status },
      reason: "ANONYMOUS_FEEDBACK_STATUS_UPDATED"
    }
  }).catch(() => undefined);

  return { data: serializeAnonymousFeedback(updated, new Map(), new Map()) };
}

export async function exportAnonymousFeedbackXlsxData(actor: Actor, filters: AnonymousFeedbackFilters = {}) {
  const user = await requireUser(actor);
  if (!canExportAnonymousFeedback(permissionUserFromAuthenticatedUser(user))) {
    throw new EngagementError("Você não tem permissão para exportar Feedback Anônimo.", 403);
  }
  const result = await listAnonymousFeedback(actor, { ...filters, page: 1, limit: 10000 });
  const rows = result.data.map((item) => [
    item.createdAt,
    item.category,
    item.urgencyLabel,
    item.statusLabel,
    item.comment,
    item.lob ?? "",
    item.jobTitle ?? "",
    item.allowContact ? "Sim" : "Não",
    item.resolvedAt ?? ""
  ]);
  return {
    headers: ["data", "categoria", "urgencia", "status", "comentario", "lob", "cargo_funcao", "contato_permitido", "resolvido_em"],
    rows,
    sheetName: "Feedback",
    fileName: `feedback_anonimo_${new Date().toISOString().slice(0, 10)}.xlsx`
  };
}

export async function listClimateSurveys(actor: Actor) {
  const user = await requireUser(actor);
  const role = normalizeRole(user.role.name);

  if (role === "ADMIN") {
    const surveys = await prisma.climateSurvey.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        questions: { orderBy: { order: "asc" } },
        answers: { include: { question: true } },
        responses: { include: { answers: { include: { question: true } } } }
      }
    });
    return {
      mode: "admin" as const,
      data: surveys.map(serializeClimateSurveyAdmin),
      summary: buildClimateAdminSummary(surveys)
    };
  }

  if (role !== "COLABORADOR") {
    throw new EngagementError("Você não tem permissão para acessar Pesquisa de Clima.", 403);
  }

  const now = new Date();
  const surveys = await prisma.climateSurvey.findMany({
    where: {
      startsAt: { lte: now },
      endsAt: { gte: now }
    },
    orderBy: { endsAt: "asc" },
    include: {
      questions: { orderBy: { order: "asc" } },
      answers: false,
      responses: {
        where: { respondentUserId: user.id },
        select: { id: true, submittedAt: true }
      }
    }
  });

  return {
    mode: "collaborator" as const,
    data: surveys
      .filter((survey) => isSurveyOpenStatus(survey.status))
      .filter((survey) => isSurveyTargetedToEmployee(survey, user))
      .map((survey) => ({
        id: survey.id,
        title: survey.title,
        description: survey.description,
        anonymous: survey.anonymous,
        status: survey.status,
        startsAt: survey.startsAt.toISOString(),
        endsAt: survey.endsAt.toISOString(),
        answered: survey.responses.length > 0,
        questions: survey.questions.map(serializeClimateQuestion)
      }))
  };
}

export async function createClimateSurvey(actor: Actor, input: ClimateSurveyInput) {
  const user = await requireUser(actor);
  requireAdmin(user);
  const title = input.title.trim();
  if (!title) throw new EngagementError("Título é obrigatório.");
  const startsAt = parseDateValue(input.startsAt, "Data inicial inválida.");
  const endsAt = parseDateValue(input.endsAt, "Data final inválida.", true);
  if (startsAt > endsAt) throw new EngagementError("Data final deve ser maior ou igual à data inicial.");

  const questions = normalizeClimateQuestions(input.questions);
  const survey = await prisma.climateSurvey.create({
    data: {
      title,
      description: input.description?.trim() || "Pesquisa de clima operacional.",
      anonymous: input.anonymous ?? true,
      status: normalizeClimateStatus(input.status),
      targetType: normalizeTargetType(input.targetType),
      targetValue: input.targetValue?.trim() || null,
      startsAt,
      endsAt,
      createdById: user.id,
      questions: {
        create: questions.map((question, index) => ({
          text: question.text,
          type: question.type,
          options: question.options?.length ? question.options : Prisma.JsonNull,
          required: question.required,
          order: index + 1
        }))
      }
    },
    include: {
      questions: { orderBy: { order: "asc" } },
      answers: { include: { question: true } },
      responses: { include: { answers: { include: { question: true } } } }
    }
  });

  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      action: "CRIACAO",
      entity: "ClimateSurvey",
      entityId: survey.id,
      after: { title: survey.title, status: survey.status, anonymous: survey.anonymous },
      reason: "CLIMATE_SURVEY_CREATED"
    }
  }).catch(() => undefined);

  return { data: serializeClimateSurveyAdmin(survey) };
}

export async function updateClimateSurveyStatus(actor: Actor, input: Partial<ClimateSurveyInput> & { id: string; status?: string }) {
  const user = await requireUser(actor);
  requireAdmin(user);
  const current = await prisma.climateSurvey.findUnique({ where: { id: input.id } });
  if (!current) throw new EngagementError("Pesquisa não encontrada.", 404);
  const hasDraftFields = Boolean(input.title || input.description || input.startsAt || input.endsAt || input.targetType || input.targetValue !== undefined || input.anonymous !== undefined);
  if (hasDraftFields && normalizeClimateStatus(current.status) !== "RASCUNHO") {
    throw new EngagementError("Somente pesquisas em rascunho podem ser editadas.");
  }

  const updated = await prisma.climateSurvey.update({
    where: { id: input.id },
    data: {
      ...(input.status ? { status: normalizeClimateStatus(input.status) } : {}),
      ...(input.title ? { title: input.title.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description?.trim() || "Pesquisa de clima operacional." } : {}),
      ...(input.startsAt ? { startsAt: parseDateValue(input.startsAt, "Data inicial inválida.") } : {}),
      ...(input.endsAt ? { endsAt: parseDateValue(input.endsAt, "Data final inválida.", true) } : {}),
      ...(input.anonymous !== undefined ? { anonymous: input.anonymous } : {}),
      ...(input.targetType ? { targetType: normalizeTargetType(input.targetType) } : {}),
      ...(input.targetValue !== undefined ? { targetValue: input.targetValue?.trim() || null } : {})
    },
    include: {
      questions: { orderBy: { order: "asc" } },
      answers: { include: { question: true } },
      responses: { include: { answers: { include: { question: true } } } }
    }
  });

  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      action: "EDICAO",
      entity: "ClimateSurvey",
      entityId: updated.id,
      before: { status: current.status },
      after: { status: updated.status },
      reason: "CLIMATE_SURVEY_STATUS_UPDATED"
    }
  }).catch(() => undefined);

  return { data: serializeClimateSurveyAdmin(updated) };
}

export async function submitClimateSurveyAnswer(actor: Actor, input: ClimateAnswerInput) {
  const user = await requireUser(actor);
  const role = normalizeRole(user.role.name);
  if (role !== "COLABORADOR") throw new EngagementError("Apenas colaboradores podem responder pesquisas de clima.", 403);

  const survey = await prisma.climateSurvey.findUnique({
    where: { id: input.surveyId },
    include: { questions: { orderBy: { order: "asc" } } }
  });
  if (!survey) throw new EngagementError("Pesquisa não encontrada.", 404);
  if (!isSurveyOpenStatus(survey.status) || !isDateWithinSurveyWindow(survey)) {
    throw new EngagementError("Esta pesquisa não está aberta para resposta.");
  }
  if (!isSurveyTargetedToEmployee(survey, user)) {
    throw new EngagementError("Esta pesquisa não está disponível para o seu público.");
  }

  const previous = await prisma.climateSurveyResponse.findUnique({
    where: { surveyId_respondentUserId: { surveyId: survey.id, respondentUserId: user.id } }
  });
  if (previous) throw new EngagementError("Você já respondeu esta pesquisa.");

  const answersByQuestion = new Map(input.answers.map((answer) => [answer.questionId, answer.value ?? ""]));
  for (const question of survey.questions) {
    const answerValue = answersByQuestion.get(question.id);
    if (question.required && (!answersByQuestion.has(question.id) || String(answerValue ?? "").trim() === "")) {
      throw new EngagementError(`Responda a pergunta obrigatória: ${question.text}`);
    }
  }

  const created = await prisma.$transaction(async (tx) => {
    const response = await tx.climateSurveyResponse.create({
      data: {
        surveyId: survey.id,
        respondentUserId: user.id,
        employeeId: user.employeeProfile?.id ?? null,
        metadata: {
          lob: user.employeeProfile?.lob?.name ?? null,
          lobId: user.employeeProfile?.lobId ?? null,
          jobTitle: user.employeeProfile?.roleTitle ?? null,
          supervisor: user.employeeProfile?.supervisor?.fullName ?? null,
          supervisorId: user.employeeProfile?.supervisorId ?? null
        }
      }
    });
    await tx.climateAnswer.createMany({
      data: survey.questions
        .filter((question) => answersByQuestion.has(question.id))
        .map((question) => ({
          surveyId: survey.id,
          questionId: question.id,
          responseId: response.id,
          respondentId: user.id,
          value: answersByQuestion.get(question.id) as Prisma.InputJsonValue
        }))
    });
    return response;
  });

  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      action: "CRIACAO",
      entity: "ClimateSurveyResponse",
      entityId: created.id,
      after: { surveyId: survey.id, anonymous: survey.anonymous },
      reason: "CLIMATE_SURVEY_ANSWERED"
    }
  }).catch(() => undefined);

  return { data: { id: created.id, message: "Pesquisa respondida com sucesso." } };
}

export async function exportClimateSurveyXlsxData(actor: Actor) {
  const user = await requireUser(actor);
  requireAdmin(user);
  const surveys = await prisma.climateSurvey.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      questions: { orderBy: { order: "asc" } },
      answers: { include: { question: true } },
      responses: { include: { answers: { include: { question: true } } } }
    }
  });

  const rows: Array<Array<string | number | boolean | null | undefined>> = [];
  for (const survey of surveys) {
    for (const response of survey.responses) {
      const metadata = parseMetadata(response.metadata);
      for (const answer of response.answers) {
        rows.push([
          survey.title,
          response.submittedAt.toISOString(),
          answer.question.text,
          stringifyAnswerValue(answer.value),
          metadata.lob,
          metadata.jobTitle,
          metadata.supervisor,
          survey.anonymous ? "Sim" : "Não"
        ]);
      }
    }
  }

  return {
    headers: ["pesquisa", "data_resposta", "pergunta", "resposta", "lob", "cargo_funcao", "supervisor", "anonima"],
    rows,
    sheetName: "Pesquisa de Clima",
    fileName: `pesquisa_clima_${new Date().toISOString().slice(0, 10)}.xlsx`
  };
}

async function buildAnonymousFeedbackWhere(filters: AnonymousFeedbackFilters): Promise<Prisma.AnonymousFeedbackWhereInput> {
  const where: Prisma.AnonymousFeedbackWhereInput = {};
  const status = filters.status && filters.status !== "Todos" ? normalizeFeedbackStatus(filters.status) : null;
  const urgency = filters.urgency && filters.urgency !== "Todos" ? normalizeUrgency(filters.urgency) : null;
  if (status) where.status = status;
  if (urgency) where.urgency = urgency;
  if (filters.category && filters.category !== "Todos") where.category = filters.category;
  if (filters.lobId && filters.lobId !== "Todos") where.lobId = filters.lobId;
  if (filters.lob?.trim() && filters.lob !== "Todos") {
    const lobs = await prisma.lob.findMany({
      where: { name: { contains: filters.lob.trim(), mode: "insensitive" } },
      select: { id: true }
    });
    where.lobId = lobs.length ? { in: lobs.map((lob) => lob.id) } : "__sem_lob_compativel__";
  }
  if (filters.jobTitle && filters.jobTitle !== "Todos") where.jobTitle = { contains: filters.jobTitle, mode: "insensitive" };
  if (filters.search?.trim()) {
    where.message = { contains: filters.search.trim(), mode: "insensitive" };
  }
  const start = filters.startDate ? parseDateValue(filters.startDate, "Data inicial inválida.") : null;
  const end = filters.endDate ? parseDateValue(filters.endDate, "Data final inválida.", true) : null;
  if (start || end) where.createdAt = { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) };
  return where;
}

function serializeAnonymousFeedback(
  item: Prisma.AnonymousFeedbackGetPayload<object>,
  lobMap: Map<string, string>,
  contactMap: Map<string, { id: string; name: string; email: string; employeeProfile: { wbLogin: string } | null }>
) {
  const contact = item.allowContact && item.contactUserId ? contactMap.get(item.contactUserId) : null;
  return {
    id: item.id,
    category: item.category,
    urgency: item.urgency,
    urgencyLabel: urgencyLabel(item.urgency),
    comment: item.message,
    status: item.status,
    statusLabel: feedbackStatusLabels[item.status],
    allowContact: item.allowContact,
    contact: contact ? { name: contact.name, email: contact.email, wbLogin: contact.employeeProfile?.wbLogin ?? "" } : null,
    lob: item.lobId ? lobMap.get(item.lobId) ?? "LOB não localizada" : null,
    jobTitle: item.jobTitle,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    resolvedAt: item.resolvedAt?.toISOString() ?? null
  };
}

function serializeClimateSurveyAdmin(survey: ClimateSurveyWithDetails) {
  const results = buildSurveyResults(survey);
  return {
    id: survey.id,
    title: survey.title,
    description: survey.description,
    status: survey.status,
    anonymous: survey.anonymous,
    targetType: survey.targetType,
    targetValue: survey.targetValue,
    startsAt: survey.startsAt.toISOString(),
    endsAt: survey.endsAt.toISOString(),
    createdAt: survey.createdAt.toISOString(),
    questions: survey.questions.map(serializeClimateQuestion),
    results
  };
}

function serializeClimateQuestion(question: { id: string; text: string; type: ClimateQuestionType; options: Prisma.JsonValue | null; required: boolean; order: number }) {
  return {
    id: question.id,
    text: question.text,
    type: question.type,
    typeLabel: climateQuestionTypeLabel(question.type),
    options: normalizeOptions(question.options),
    required: question.required,
    order: question.order
  };
}

function buildSurveyResults(survey: ClimateSurveyWithDetails) {
  const responseAnswers = survey.responses.flatMap((response) => response.answers);
  const legacyAnswers = survey.answers.filter((answer) => !answer.responseId);
  const answers = [...responseAnswers, ...legacyAnswers];
  const responseKeys = new Set<string>();
  for (const response of survey.responses) responseKeys.add(response.id);
  for (const answer of legacyAnswers) responseKeys.add(answer.respondentId ?? answer.createdAt.toISOString());

  const questions = survey.questions.map((question) => {
    const questionAnswers = answers.filter((answer) => answer.questionId === question.id);
    const numericValues = questionAnswers
      .map((answer) => Number(answer.value))
      .filter((value) => Number.isFinite(value));
    const distribution: Record<string, number> = {};
    for (const answer of questionAnswers) {
      const key = stringifyAnswerValue(answer.value);
      distribution[key] = (distribution[key] ?? 0) + 1;
    }
    return {
      id: question.id,
      question: question.text,
      type: question.type,
      answers: questionAnswers.length,
      average: numericValues.length ? Number((numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length).toFixed(2)) : null,
      distribution,
      comments: questionAnswers
        .map((answer) => stringifyAnswerValue(answer.value))
        .filter((value) => value && question.type === "TEXTO_LIVRE")
        .slice(0, 30)
    };
  });
  const numericAverages = questions.map((question) => question.average).filter((value): value is number => typeof value === "number");
  const satisfactionAverage = numericAverages.length ? Number((numericAverages.reduce((sum, value) => sum + value, 0) / numericAverages.length).toFixed(2)) : null;
  const npsQuestion = questions.find((question) => question.type === "NPS_0_10");
  const nps = npsQuestion ? calculateNps(npsQuestion.distribution) : null;

  return {
    responseCount: responseKeys.size,
    satisfactionAverage,
    nps,
    questions
  };
}

function buildClimateAdminSummary(surveys: ClimateSurveyWithDetails[]) {
  const open = surveys.filter((survey) => isSurveyOpenStatus(survey.status)).length;
  const totalResponses = surveys.reduce((sum, survey) => sum + buildSurveyResults(survey).responseCount, 0);
  const averages = surveys.map((survey) => buildSurveyResults(survey).satisfactionAverage).filter((value): value is number => typeof value === "number");
  const npsValues = surveys.map((survey) => buildSurveyResults(survey).nps).filter((value): value is number => typeof value === "number");
  return {
    open,
    totalResponses,
    responseRate: null,
    satisfactionAverage: averages.length ? Number((averages.reduce((sum, value) => sum + value, 0) / averages.length).toFixed(2)) : null,
    nps: npsValues.length ? Number((npsValues.reduce((sum, value) => sum + value, 0) / npsValues.length).toFixed(0)) : null
  };
}

async function requireUser(actor: Actor): Promise<AuthenticatedUser> {
  if (!actor.email) throw new EngagementError("Faça login para acessar este módulo.", 401);
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
    throw new EngagementError("Usuário sem acesso ativo ao módulo.", 403);
  }
  return user;
}

function requireAdmin(user: AuthenticatedUser) {
  if (normalizeRole(user.role.name) !== "ADMIN") {
    throw new EngagementError("Apenas ADMIN pode executar esta ação.", 403);
  }
}

function requireAnonymousFeedbackAdmin(user: AuthenticatedUser) {
  if (!canViewAnonymousFeedbackAdmin(permissionUserFromAuthenticatedUser(user))) {
    throw new EngagementError("Você não tem permissão para visualizar os feedbacks recebidos.", 403);
  }
}

function requireAnonymousFeedbackManager(user: AuthenticatedUser) {
  if (!canManageAnonymousFeedback(permissionUserFromAuthenticatedUser(user))) {
    throw new EngagementError("Você não tem permissão para gerenciar Feedback Anônimo.", 403);
  }
}

function permissionUserFromAuthenticatedUser(user: AuthenticatedUser) {
  return {
    email: user.email,
    name: user.name,
    role: user.role.name,
    status: user.status,
    roleTitle: user.employeeProfile?.roleTitle ?? null
  };
}

function normalizeUrgency(value?: string | null) {
  const token = normalizeToken(value);
  if (token.includes("CRITIC")) return "CRITICA";
  if (token.includes("ALT")) return "ALTA";
  if (token.includes("MED")) return "MEDIA";
  return "BAIXA";
}

function urgencyLabel(value: string) {
  if (value === "CRITICA") return "Crítica";
  if (value === "ALTA") return "Alta";
  if (value === "MEDIA") return "Média";
  return "Baixa";
}

function normalizeFeedbackStatus(value: string): AnonymousFeedbackStatus {
  const token = normalizeToken(value);
  if (token.includes("ARQUIV")) return "ARQUIVADO";
  if (token.includes("RESOL") || token.includes("CONCL")) return "CONCLUIDO";
  if (token.includes("ANALISE") || token.includes("PLANO")) return "EM_ANALISE";
  return "RECEBIDO";
}

function normalizeClimateStatus(value?: string | null) {
  const token = normalizeToken(value);
  if (token.includes("ENCERR")) return "ENCERRADA";
  if (token.includes("ABERT") || token.includes("ATIV")) return "ABERTA";
  return "RASCUNHO";
}

function isSurveyOpenStatus(status: string) {
  const token = normalizeToken(status);
  return token.includes("ABERT") || token.includes("ATIV");
}

function normalizeQuestionType(value: string): ClimateQuestionType {
  const token = normalizeToken(value);
  if (token.includes("NPS")) return "NPS_0_10";
  if (token.includes("SIM") || token.includes("NAO")) return "SIM_NAO";
  if (token.includes("MULT")) return "MULTIPLA_ESCOLHA";
  if (token.includes("TEXTO")) return "TEXTO_LIVRE";
  return "ESCALA_1_5";
}

function climateQuestionTypeLabel(type: ClimateQuestionType) {
  if (type === "NPS_0_10") return "NPS 0 a 10";
  if (type === "SIM_NAO") return "Sim/Não";
  if (type === "MULTIPLA_ESCOLHA") return "Múltipla escolha";
  if (type === "TEXTO_LIVRE") return "Texto livre";
  return "Escala 1 a 5";
}

function normalizeTargetType(value?: string | null) {
  const token = normalizeToken(value);
  if (token.includes("LOB")) return "LOB";
  if (token.includes("CARGO")) return "CARGO_FUNCAO";
  if (token.includes("SUPERV")) return "SUPERVISOR";
  if (token.includes("AGENT") || token.includes("AGENTE")) return "AGENTES";
  return "TODOS";
}

function isSurveyTargetedToEmployee(survey: { targetType: string; targetValue: string | null }, user: AuthenticatedUser) {
  const employee = user.employeeProfile;
  if (!employee) return false;
  const target = normalizeTargetType(survey.targetType);
  if (target === "TODOS") return true;
  if (target === "AGENTES") return isAgentEmployee({ roleTitle: employee.roleTitle });
  if (target === "LOB") return !survey.targetValue || [employee.lobId, employee.lob.name].includes(survey.targetValue);
  if (target === "CARGO_FUNCAO") return !survey.targetValue || employee.roleTitle === survey.targetValue;
  if (target === "SUPERVISOR") return !survey.targetValue || [employee.supervisorId, employee.supervisor?.fullName ?? ""].includes(survey.targetValue);
  return true;
}

function normalizeClimateQuestions(questions?: ClimateSurveyInput["questions"]) {
  const source: NonNullable<ClimateSurveyInput["questions"]> = questions?.filter((question) => question.text.trim()) ?? [];
  const defaultQuestionInputs: NonNullable<ClimateSurveyInput["questions"]> = defaultClimateQuestions.map((text, index) => ({
    text,
    type: index >= 10 ? "TEXTO_LIVRE" : "ESCALA_1_5",
    required: index < 10
  }));
  const finalQuestions = source.length
    ? source
    : defaultQuestionInputs;
  return finalQuestions.map((question) => ({
    text: question.text.trim(),
    type: normalizeQuestionType(question.type),
    options: question.options?.map((option: string) => option.trim()).filter(Boolean) ?? [],
    required: question.required ?? true
  }));
}

function parseDateValue(value: string, message: string, endOfDay = false) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`)
    : new Date(value);
  if (Number.isNaN(date.getTime())) throw new EngagementError(message);
  return date;
}

function isDateWithinSurveyWindow(survey: { startsAt: Date; endsAt: Date }) {
  const now = new Date();
  return survey.startsAt <= now && survey.endsAt >= now;
}

function normalizeOptions(value: Prisma.JsonValue | null) {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function stringifyAnswerValue(value: Prisma.JsonValue | unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((item) => stringifyAnswerValue(item)).join(", ");
  return JSON.stringify(value);
}

function parseMetadata(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { lob: "", jobTitle: "", supervisor: "" };
  const record = value as Record<string, unknown>;
  return {
    lob: String(record.lob ?? ""),
    jobTitle: String(record.jobTitle ?? ""),
    supervisor: String(record.supervisor ?? "")
  };
}

function calculateNps(distribution: Record<string, number>) {
  let promoters = 0;
  let detractors = 0;
  let total = 0;
  for (const [key, count] of Object.entries(distribution)) {
    const value = Number(key);
    if (!Number.isFinite(value)) continue;
    total += count;
    if (value >= 9) promoters += count;
    if (value <= 6) detractors += count;
  }
  return total ? Math.round(((promoters - detractors) / total) * 100) : null;
}

function normalizeToken(value?: string | null) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function countMap<T extends string>(entries: Array<[T, number]>) {
  return Object.fromEntries(entries) as Record<T, number>;
}
