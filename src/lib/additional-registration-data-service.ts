import { Prisma } from "@prisma/client";

import type { Actor } from "@/lib/mock-db";
import { normalizeRole } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import type { XlsxExportPayload } from "@/lib/xlsx-export";

export const ADDITIONAL_REGISTRATION_DATA_NOTIFICATION_TYPE = "ADDITIONAL_REGISTRATION_DATA_REQUIRED";
const ADDITIONAL_DATA_HREF = "/meus-dados/adicionais";

const ethnicityOptions = new Set(["Branca", "Preta", "Parda", "Amarela", "Indígena", "Prefiro não informar"]);
const sexualOrientationOptions = new Set(["Heterossexual", "Homossexual", "Bissexual", "Assexual", "Outra", "Prefiro não informar"]);
const yesNoPreferOptions = new Set(["Sim", "Não", "Prefiro não informar"]);
const yesNoOptions = new Set(["Sim", "Não"]);
const disabilityTypeOptions = new Set(["Física", "Auditiva", "Visual", "Intelectual", "Psicossocial", "Múltipla", "Neurodivergente", "Outra", "Prefiro não informar"]);
const pixKeyTypeOptions = new Set(["CPF", "CNPJ", "E-mail", "Telefone", "Chave aleatória"]);
const pixKeyTypeAliases: Record<string, string> = {
  ALEATORIA: "Chave aleatória",
  ALEATÓRIA: "Chave aleatória",
  CHAVE_ALEATORIA: "Chave aleatória",
  CHAVE_ALEATÓRIA: "Chave aleatória",
  CHAVEALEATORIA: "Chave aleatória",
  CHAVEALEATÓRIA: "Chave aleatória",
  EMAIL: "E-mail",
  E_MAIL: "E-mail",
  EEMAIL: "E-mail",
  TELEFONE: "Telefone",
  PHONE: "Telefone",
  CPF: "CPF",
  CNPJ: "CNPJ"
};

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

type AdditionalDataProfile = NonNullable<AuthenticatedUser["employeeProfile"]>;

export type AdditionalRegistrationDataInput = {
  ethnicity?: string;
  sexualOrientation?: string;
  isPcd?: string;
  pcdDisabilityType?: string;
  pcdDisabilityOther?: string;
  firstJob?: string;
  hasTelemarketingExperience?: string;
  telemarketingWhere?: string;
  pixKeyType?: string;
  pixKey?: string;
};

export class AdditionalRegistrationDataError extends Error {
  status: number;
  fields?: Record<string, string>;

  constructor(message: string, status = 400, fields?: Record<string, string>) {
    super(message);
    this.name = "AdditionalRegistrationDataError";
    this.status = status;
    this.fields = fields;
  }
}

export async function getOwnAdditionalRegistrationData(actor: Actor) {
  const user = await requireActiveUser(actor);
  const employee = requireLinkedEmployee(user);
  const completed = isAdditionalRegistrationDataComplete(employee);

  return {
    data: {
      completed,
      pending: !completed,
      href: ADDITIONAL_DATA_HREF,
      profile: serializeOwnAdditionalData(employee)
    }
  };
}

export async function saveOwnAdditionalRegistrationData(actor: Actor, input: AdditionalRegistrationDataInput) {
  const user = await requireActiveUser(actor);
  const employee = requireLinkedEmployee(user);
  const normalized = validateAdditionalDataInput(input);
  const now = new Date();
  const previousPixKey = employee.pixKey ?? "";
  const previousPixKeyType = employee.pixKeyType ?? "";
  const pixChanged = previousPixKey !== normalized.pixKey || normalizePixKeyType(previousPixKeyType) !== normalized.pixKeyType;

  const updated = await prisma.$transaction(async (tx) => {
    const sensitive = await tx.employeeSensitiveData.findUnique({
      where: { employeeId: employee.id },
      select: { bankData: true }
    });
    const saved = await tx.employeeProfile.update({
      where: { id: employee.id },
      data: {
        ...normalized,
        additionalDataCompletedAt: employee.additionalDataCompletedAt ?? now,
        additionalDataUpdatedAt: now,
        additionalDataSource: "SELF_UPDATE"
      },
      include: {
        lob: true,
        supervisor: true
      }
    });

    await tx.notification.updateMany({
      where: {
        userId: user.id,
        type: ADDITIONAL_REGISTRATION_DATA_NOTIFICATION_TYPE,
        entity: "EmployeeProfile",
        entityId: employee.id,
        deletedAt: null
      },
      data: {
        isRead: true,
        readAt: now,
        deletedAt: now
      }
    });

    await tx.auditLog.create({
      data: {
        actorId: user.id,
        action: employee.additionalDataCompletedAt ? "EDICAO" : "CRIACAO",
        entity: "EmployeeProfile",
        entityId: employee.id,
        after: {
          fields: Object.keys(normalized),
          completed: true,
          source: "SELF_UPDATE"
        },
        reason: "ADDITIONAL_REGISTRATION_DATA_COMPLETED"
      }
    }).catch(() => undefined);

    if (sensitive) {
      const bankData = jsonObject(sensitive.bankData);
      await tx.employeeSensitiveData.update({
        where: { employeeId: employee.id },
        data: {
          bankData: {
            ...bankData,
            pixKey: normalized.pixKey,
            pixKeyType: normalized.pixKeyType
          }
        }
      });
    }

    if (pixChanged) {
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "EDICAO",
          entity: "EmployeeProfile",
          entityId: employee.id,
          previousValue: {
            pixKeyType: previousPixKeyType ? normalizePixKeyType(previousPixKeyType) : "",
            pixKeyMasked: maskPixKey(previousPixKey, previousPixKeyType)
          },
          newValue: {
            pixKeyType: normalized.pixKeyType,
            pixKeyMasked: maskPixKey(normalized.pixKey, normalized.pixKeyType),
            source: "Meu Perfil > Atualizar Dados Adicionais"
          },
          reason: "PIX_KEY_UPDATED_BY_EMPLOYEE"
        }
      }).catch(() => undefined);
    }

    return saved;
  });

  return {
    data: {
      completed: true,
      pending: false,
      href: ADDITIONAL_DATA_HREF,
      profile: serializeOwnAdditionalData(updated)
    },
    message: pixChanged ? "Chave PIX atualizada com sucesso." : "Dados cadastrais adicionais atualizados com sucesso."
  };
}

export async function ensureAdditionalRegistrationDataNotificationForUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      employeeProfile: {
        include: {
          lob: true,
          supervisor: true
        }
      }
    }
  });
  if (!user || !isActiveUserRecord(user) || !user.employeeProfile || !isActiveEmployeeProfile(user.employeeProfile)) return;
  if (isAdditionalRegistrationDataComplete(user.employeeProfile)) {
    await prisma.notification.updateMany({
      where: {
        userId: user.id,
        type: ADDITIONAL_REGISTRATION_DATA_NOTIFICATION_TYPE,
        entity: "EmployeeProfile",
        entityId: user.employeeProfile.id,
        deletedAt: null
      },
      data: { isRead: true, readAt: new Date(), deletedAt: new Date() }
    });
    return;
  }

  const duplicate = await prisma.notification.findFirst({
    where: {
      userId: user.id,
      type: ADDITIONAL_REGISTRATION_DATA_NOTIFICATION_TYPE,
      entity: "EmployeeProfile",
      entityId: user.employeeProfile.id,
      deletedAt: null
    },
    select: { id: true }
  });
  if (duplicate) return;

  await prisma.notification.create({
    data: {
      userId: user.id,
      title: "Atualização cadastral necessária",
      body: "Precisamos que você atualize seus Dados Cadastrais Adicionais. Clique aqui para responder.",
      category: "CADASTRO",
      type: ADDITIONAL_REGISTRATION_DATA_NOTIFICATION_TYPE,
      entity: "EmployeeProfile",
      entityId: user.employeeProfile.id,
      href: ADDITIONAL_DATA_HREF
    }
  });
}

export async function listAdditionalRegistrationDataTracking(actor: Actor, filters: AdditionalDataTrackingFilters = {}) {
  const user = await requireActiveUser(actor);
  requireTrackingPermission(user);

  const where = buildTrackingWhere(filters);
  const employees = await prisma.employeeProfile.findMany({
    where,
    orderBy: [{ fullName: "asc" }],
    include: {
      user: {
        include: { role: true }
      },
      lob: true,
      supervisor: true
    },
    take: 1000
  });
  await ensureAdditionalRegistrationDataNotificationsForEmployees(employees).catch(() => undefined);
  const allRows = employees.map(serializeTrackingRow);
  const rows = filters.status && filters.status !== "Todos"
    ? allRows.filter((row) => row.additionalDataStatus === filters.status)
    : allRows;
  const total = rows.length;
  const completed = rows.filter((row) => row.additionalDataStatus === "Concluído").length;
  const pending = total - completed;

  return {
    data: rows,
    summary: {
      total,
      completed,
      pending,
      completionRate: total ? Number(((completed / total) * 100).toFixed(1)) : 0
    }
  };
}

async function ensureAdditionalRegistrationDataNotificationsForEmployees(employees: Array<Prisma.EmployeeProfileGetPayload<{ include: { user: { include: { role: true } }; lob: true; supervisor: true } }>>) {
  const pending = employees.filter((employee) => employee.userId && employee.user?.status === "ACTIVE" && !employee.user.deletedAt && !isAdditionalRegistrationDataComplete(employee));
  if (!pending.length) return;
  const userIds = pending.map((employee) => employee.userId).filter((value): value is string => Boolean(value));
  const employeeIds = pending.map((employee) => employee.id);
  const existing = await prisma.notification.findMany({
    where: {
      userId: { in: userIds },
      type: ADDITIONAL_REGISTRATION_DATA_NOTIFICATION_TYPE,
      entity: "EmployeeProfile",
      entityId: { in: employeeIds },
      deletedAt: null
    },
    select: { userId: true, entityId: true }
  });
  const existingKeys = new Set(existing.map((notification) => `${notification.userId}:${notification.entityId ?? ""}`));
  const data = pending
    .filter((employee) => employee.userId && !existingKeys.has(`${employee.userId}:${employee.id}`))
    .map((employee) => ({
      userId: employee.userId as string,
      title: "Atualização cadastral necessária",
      body: "Precisamos que você atualize seus Dados Cadastrais Adicionais. Clique aqui para responder.",
      category: "CADASTRO",
      type: ADDITIONAL_REGISTRATION_DATA_NOTIFICATION_TYPE,
      entity: "EmployeeProfile",
      entityId: employee.id,
      href: ADDITIONAL_DATA_HREF
    }));
  if (data.length) await prisma.notification.createMany({ data });
}

export async function exportAdditionalRegistrationDataTracking(actor: Actor, filters: AdditionalDataTrackingFilters = {}): Promise<XlsxExportPayload> {
  const user = await requireActiveUser(actor);
  requireTrackingPermission(user);
  const result = await listAdditionalRegistrationDataTracking(actor, filters);

  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      action: "EDICAO",
      entity: "EmployeeProfile",
      entityId: "ADDITIONAL_REGISTRATION_DATA",
      after: {
        total: result.summary.total,
        completed: result.summary.completed,
        pending: result.summary.pending,
        filters: safeTrackingFilters(filters)
      },
      reason: "ADDITIONAL_REGISTRATION_DATA_TRACKING_EXPORTED"
    }
  }).catch(() => undefined);

  return {
    fileName: `dados_cadastrais_adicionais_${new Date().toISOString().slice(0, 10)}.xlsx`,
    sheetName: "Acompanhamento",
    headers: [
      "nome",
      "wb_login",
      "email",
      "lob",
      "supervisor",
      "cargo_funcao",
      "skill",
      "wave",
      "status_colaborador",
      "dados_adicionais",
      "data_conclusao",
      "etnia",
      "orientacao_sexual",
      "eh_pcd",
      "tipo_deficiencia",
      "tipo_deficiencia_outro",
      "primeiro_emprego",
      "ja_trabalhou_telemarketing",
      "onde_trabalhou_telemarketing"
    ],
    rows: result.data.map((row) => [
      row.name,
      row.wbLogin,
      row.email,
      row.lob,
      row.supervisor,
      row.roleTitle,
      row.skill,
      row.wave,
      row.employeeStatus,
      row.additionalDataStatus,
      row.additionalDataCompletedAt,
      row.ethnicity,
      row.sexualOrientation,
      row.isPcd,
      row.pcdDisabilityType,
      row.pcdDisabilityOther,
      row.firstJob,
      row.hasTelemarketingExperience,
      row.telemarketingWhere
    ])
  };
}

export type AdditionalDataTrackingFilters = {
  status?: string;
  lob?: string;
  supervisorId?: string;
  role?: string;
  skill?: string;
  wave?: string;
  search?: string;
};

async function requireActiveUser(actor: Actor): Promise<AuthenticatedUser> {
  if (!actor.email) throw new AdditionalRegistrationDataError("Faça login para acessar este módulo.", 401);
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
  if (!user || !isActiveUserRecord(user)) {
    throw new AdditionalRegistrationDataError("Usuário sem acesso ativo ao módulo.", 403);
  }
  return user;
}

function requireLinkedEmployee(user: AuthenticatedUser) {
  if (!user.employeeProfile || user.employeeProfile.deletedAt) {
    throw new AdditionalRegistrationDataError("Seu usuário não está vinculado a um cadastro de colaborador. Contate o administrador.", 403);
  }
  return user.employeeProfile;
}

function requireTrackingPermission(user: AuthenticatedUser) {
  const role = normalizeRole(user.role.name);
  if (!["ADMIN", "RH", "WFM"].includes(role)) {
    throw new AdditionalRegistrationDataError("Você não tem permissão para acompanhar Dados Cadastrais Adicionais.", 403);
  }
}

function validateAdditionalDataInput(input: AdditionalRegistrationDataInput) {
  const fields: Record<string, string> = {};
  const data = {
    ethnicity: clean(input.ethnicity),
    sexualOrientation: clean(input.sexualOrientation),
    isPcd: clean(input.isPcd),
    pcdDisabilityType: clean(input.pcdDisabilityType),
    pcdDisabilityOther: clean(input.pcdDisabilityOther),
    firstJob: clean(input.firstJob),
    hasTelemarketingExperience: clean(input.hasTelemarketingExperience),
    telemarketingWhere: clean(input.telemarketingWhere),
    pixKeyType: normalizePixKeyType(input.pixKeyType),
    pixKey: clean(input.pixKey)
  };

  if (!data.ethnicity || !ethnicityOptions.has(data.ethnicity)) fields.ethnicity = "Informe sua etnia.";
  if (!data.sexualOrientation || !sexualOrientationOptions.has(data.sexualOrientation)) fields.sexualOrientation = "Informe sua orientação sexual.";
  if (!data.isPcd || !yesNoPreferOptions.has(data.isPcd)) fields.isPcd = "Informe se é PCD.";
  if (data.isPcd === "Sim" && (!data.pcdDisabilityType || !disabilityTypeOptions.has(data.pcdDisabilityType))) fields.pcdDisabilityType = "Tipo de deficiência é obrigatório quando PCD for Sim.";
  if (data.isPcd === "Sim" && data.pcdDisabilityType === "Outra" && !data.pcdDisabilityOther) fields.pcdDisabilityOther = "Especifique o tipo de deficiência.";
  if (!data.firstJob || !yesNoOptions.has(data.firstJob)) fields.firstJob = "Informe se este é seu primeiro emprego.";
  if (!data.hasTelemarketingExperience || !yesNoOptions.has(data.hasTelemarketingExperience)) fields.hasTelemarketingExperience = "Informe se já trabalhou em telemarketing.";
  if (data.hasTelemarketingExperience === "Sim" && !data.telemarketingWhere) fields.telemarketingWhere = "Informe onde trabalhou em telemarketing.";
  if (!data.pixKeyType || !pixKeyTypeOptions.has(data.pixKeyType)) fields.pixKeyType = "Tipo da Chave PIX é obrigatório.";
  if (!data.pixKey) fields.pixKey = "Chave PIX é obrigatória.";
  if (data.pixKey && data.pixKeyType) {
    const pixError = validatePixKeyByType(data.pixKeyType, data.pixKey);
    if (pixError) fields.pixKey = pixError;
  }

  if (Object.keys(fields).length) {
    throw new AdditionalRegistrationDataError("Revise os campos obrigatórios.", 400, fields);
  }

  return {
    ethnicity: data.ethnicity,
    sexualOrientation: data.sexualOrientation,
    isPcd: data.isPcd,
    pcdDisabilityType: data.isPcd === "Sim" ? data.pcdDisabilityType : null,
    pcdDisabilityOther: data.isPcd === "Sim" && data.pcdDisabilityType === "Outra" ? data.pcdDisabilityOther : null,
    firstJob: data.firstJob,
    hasTelemarketingExperience: data.hasTelemarketingExperience,
    telemarketingWhere: data.hasTelemarketingExperience === "Sim" ? data.telemarketingWhere : "Não se aplica",
    pixKeyType: data.pixKeyType,
    pixKey: data.pixKey
  };
}

function isAdditionalRegistrationDataComplete(employee: Pick<AdditionalDataProfile, "additionalDataCompletedAt" | "ethnicity" | "sexualOrientation" | "isPcd" | "pcdDisabilityType" | "pcdDisabilityOther" | "firstJob" | "hasTelemarketingExperience" | "telemarketingWhere" | "pixKey" | "pixKeyType">) {
  if (employee.additionalDataCompletedAt && employee.pixKey && employee.pixKeyType) return true;
  if (!employee.ethnicity || !employee.sexualOrientation || !employee.isPcd || !employee.firstJob || !employee.hasTelemarketingExperience || !employee.pixKey || !employee.pixKeyType) return false;
  if (employee.isPcd === "Sim" && !employee.pcdDisabilityType) return false;
  if (employee.isPcd === "Sim" && employee.pcdDisabilityType === "Outra" && !employee.pcdDisabilityOther) return false;
  if (employee.hasTelemarketingExperience === "Sim" && !employee.telemarketingWhere) return false;
  return true;
}

function serializeOwnAdditionalData(employee: AdditionalDataProfile) {
  return {
    id: employee.id,
    name: employee.fullName,
    wbLogin: employee.wbLogin,
    ethnicity: employee.ethnicity ?? "",
    sexualOrientation: employee.sexualOrientation ?? "",
    isPcd: employee.isPcd ?? "",
    pcdDisabilityType: employee.pcdDisabilityType ?? "",
    pcdDisabilityOther: employee.pcdDisabilityOther ?? "",
    firstJob: employee.firstJob ?? "",
    hasTelemarketingExperience: employee.hasTelemarketingExperience ?? "",
    telemarketingWhere: employee.telemarketingWhere ?? "",
    pixKeyType: normalizePixKeyType(employee.pixKeyType) || "",
    pixKey: employee.pixKey ?? "",
    additionalDataCompletedAt: employee.additionalDataCompletedAt ? formatDateTime(employee.additionalDataCompletedAt) : "",
    additionalDataUpdatedAt: employee.additionalDataUpdatedAt ? formatDateTime(employee.additionalDataUpdatedAt) : ""
  };
}

function serializeTrackingRow(employee: Prisma.EmployeeProfileGetPayload<{ include: { user: { include: { role: true } }; lob: true; supervisor: true } }>) {
  const completed = isAdditionalRegistrationDataComplete(employee);
  return {
    id: employee.id,
    name: employee.fullName,
    wbLogin: employee.wbLogin,
    email: employee.user?.email ?? "",
    lob: employee.lob?.name ?? "Sem LOB",
    supervisor: employee.supervisor?.fullName ?? "Sem supervisor",
    roleTitle: employee.roleTitle,
    skill: employee.skill ?? "",
    wave: employee.wave ?? "",
    employeeStatus: employee.operationalStatus,
    additionalDataStatus: completed ? "Concluído" : "Pendente",
    additionalDataCompletedAt: employee.additionalDataCompletedAt ? formatDateTime(employee.additionalDataCompletedAt) : "",
    ethnicity: employee.ethnicity ?? "",
    sexualOrientation: employee.sexualOrientation ?? "",
    isPcd: employee.isPcd ?? "",
    pcdDisabilityType: employee.pcdDisabilityType ?? "",
    pcdDisabilityOther: employee.pcdDisabilityOther ?? "",
    firstJob: employee.firstJob ?? "",
    hasTelemarketingExperience: employee.hasTelemarketingExperience ?? "",
    telemarketingWhere: employee.telemarketingWhere ?? ""
  };
}

function buildTrackingWhere(filters: AdditionalDataTrackingFilters): Prisma.EmployeeProfileWhereInput {
  const where: Prisma.EmployeeProfileWhereInput = {
    deletedAt: null,
    userId: { not: null },
    user: { status: "ACTIVE", deletedAt: null },
    NOT: [
      { operationalStatus: { equals: "Desligado", mode: "insensitive" } },
      { operationalStatus: { equals: "Inativo", mode: "insensitive" } },
      { operationalStatus: { equals: "Desativado", mode: "insensitive" } }
    ]
  };
  const and: Prisma.EmployeeProfileWhereInput[] = [];
  if (filters.lob && filters.lob !== "Todos") and.push({ lob: { name: { equals: filters.lob, mode: "insensitive" } } });
  if (filters.supervisorId && filters.supervisorId !== "Todos") {
    and.push(filters.supervisorId === "SEM_SUPERVISOR" ? { supervisorId: null } : { supervisorId: filters.supervisorId });
  }
  if (filters.role && filters.role !== "Todos") and.push({ roleTitle: { equals: filters.role, mode: "insensitive" } });
  if (filters.skill && filters.skill !== "Todos") and.push(filters.skill === "SEM_SKILL" ? { OR: [{ skill: null }, { skill: "" }] } : { skill: { equals: filters.skill, mode: "insensitive" } });
  if (filters.wave && filters.wave !== "Todos") and.push(filters.wave === "SEM_WAVE" ? { OR: [{ wave: null }, { wave: "" }] } : { wave: { equals: filters.wave, mode: "insensitive" } });
  if (filters.search?.trim()) {
    const search = filters.search.trim();
    and.push({
      OR: [
        { fullName: { contains: search, mode: "insensitive" } },
        { wbLogin: { contains: search, mode: "insensitive" } },
        { user: { email: { contains: search, mode: "insensitive" } } }
      ]
    });
  }
  if (and.length) where.AND = and;
  return where;
}

function isActiveUserRecord(user: { status?: string | null; deletedAt?: Date | null }) {
  return user.status === "ACTIVE" && !user.deletedAt;
}

function isActiveEmployeeProfile(employee: { deletedAt?: Date | null; operationalStatus?: string | null; userId?: string | null }) {
  if (employee.deletedAt || !employee.userId) return false;
  const status = clean(employee.operationalStatus).toLowerCase();
  return !["desligado", "inativo", "desativado"].includes(status);
}

function clean(value?: string | null) {
  return String(value ?? "").trim();
}

function normalizePixKeyType(value?: string | null) {
  const raw = clean(value);
  if (!raw) return "";
  if (pixKeyTypeOptions.has(raw)) return raw;
  const normalized = raw
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  return pixKeyTypeAliases[normalized] ?? raw;
}

function validatePixKeyByType(type: string, pixKey: string) {
  const digits = pixKey.replace(/\D/g, "");
  if (type === "CPF" && digits.length !== 11) return "Chave PIX CPF deve ter 11 dígitos.";
  if (type === "CNPJ" && digits.length !== 14) return "Chave PIX CNPJ deve ter 14 dígitos.";
  if (type === "E-mail" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pixKey)) return "Chave PIX e-mail inválida.";
  if (type === "Telefone" && (digits.length < 10 || digits.length > 13)) return "Chave PIX telefone deve conter DDD.";
  return "";
}

function jsonObject(value: Prisma.JsonValue | null | undefined): Prisma.JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Prisma.JsonObject : {};
}

function maskPixKey(value?: string | null, type?: string | null) {
  const raw = clean(value);
  if (!raw) return "";
  const normalizedType = normalizePixKeyType(type);
  if (normalizedType === "E-mail") {
    const [local, domain] = raw.split("@");
    if (!domain) return maskMiddle(raw);
    return `${local.slice(0, 1)}**@${domain}`;
  }
  if (normalizedType === "CPF") {
    const digits = raw.replace(/\D/g, "");
    return digits.length >= 11 ? `***.${digits.slice(3, 6)}.${digits.slice(6, 9)}-**` : maskMiddle(raw);
  }
  if (normalizedType === "CNPJ") {
    const digits = raw.replace(/\D/g, "");
    return digits.length >= 14 ? `**.${digits.slice(2, 5)}.${digits.slice(5, 8)}/****-${digits.slice(12, 14)}` : maskMiddle(raw);
  }
  if (normalizedType === "Telefone") {
    const digits = raw.replace(/\D/g, "");
    return digits.length >= 10 ? `(**) *****-${digits.slice(-4)}` : maskMiddle(raw);
  }
  return raw.length > 8 ? `${raw.slice(0, 4)}...${raw.slice(-4)}` : maskMiddle(raw);
}

function maskMiddle(value: string) {
  if (value.length <= 2) return "*".repeat(value.length);
  return `${value.slice(0, 1)}${"*".repeat(Math.min(6, value.length - 2))}${value.slice(-1)}`;
}

function safeTrackingFilters(filters: AdditionalDataTrackingFilters) {
  return {
    status: filters.status ?? "",
    lob: filters.lob ?? "",
    supervisorId: filters.supervisorId ?? "",
    role: filters.role ?? "",
    skill: filters.skill ?? "",
    wave: filters.wave ?? "",
    search: filters.search ? "aplicado" : ""
  };
}

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}
