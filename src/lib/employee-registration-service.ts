import { AuditAction, EmployeeRegistrationRequest, EmployeeRegistrationStatus, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

import type { Actor } from "@/lib/mock-db";
import {
  listEmployeeRegistrations as listMockRegistrations,
  recordErrorLog,
  reviewEmployeeRegistration as reviewMockRegistration,
  submitEmployeeRegistration as submitMockRegistration
} from "@/lib/mock-db";
import { mapPrismaError } from "@/lib/api-errors";
import { normalizeRole } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { cleanShiftName, isBlockedShiftName, isSelectableShiftName, shiftLookupKey } from "@/lib/shift-display";
import type { RegistrationInput } from "@/lib/registration-validation";

const allowDemoDataFallback = process.env.ALLOW_DEMO_LOGIN === "true" || process.env.ALLOW_DEMO_DATA === "true";

export type RegistrationReviewInput = {
  id: string;
  action: "approve" | "reject" | "request_adjustment";
  reviewNotes: string;
  operationalData?: {
    wbLogin: string;
    lob: string;
    team: string;
    supervisor: string;
    shift: string;
    skill?: string;
    wave?: string;
    schedule: string;
    roleTitle: string;
    employeeStatus: string;
    contractType: string;
    admissionDate: string;
    trainingDate: string;
    site: string;
    internalNotes?: string;
  };
};

export const employeeImportColumns = [
  "cnpj",
  "nome",
  "nome_social",
  "email",
  "cpf",
  "rg",
  "orgao_expedidor_uf",
  "data_nascimento",
  "sexo",
  "estado_civil",
  "escolaridade",
  "tem_filhos",
  "quantidade_filhos",
  "endereco_tipo",
  "endereco",
  "numero",
  "complemento",
  "bairro",
  "cidade",
  "estado_uf",
  "cep",
  "contato_principal",
  "contato_emergencia",
  "nome_contato_emergencia",
  "parentesco_contato_emergencia",
  "wb_login",
  "cargo_funcao",
  "role_permissao",
  "lob",
  "time",
  "supervisor_wb_login",
  "supervisor_email",
  "supervisor_nome",
  "turno",
  "skill",
  "wave",
  "escala_modelo",
  "status_colaborador",
  "tipo_contrato",
  "data_admissao",
  "data_inicio_treinamento",
  "site_operacao",
  "preferencia_horario",
  "banco",
  "agencia",
  "conta_corrente",
  "chave_pix",
  "tipo_chave_pix",
  "chave_pix_secundaria",
  "tipo_chave_pix_secundaria",
  "observacoes",
  "criar_usuario",
  "senha_temporaria"
] as const;

type EmployeeImportRow = Record<string, unknown>;

export type RegistrationListQuery = {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
};

type EmployeeImportValidation = {
  rowNumber: number;
  errors: string[];
  warnings: string[];
  action: "criar" | "atualizar" | "ignorar";
  status: "Válida" | "Erro" | "Alerta";
  preview: {
    name: string;
    email: string;
    cpf: string;
    wbLogin: string;
    role: string;
    lob: string;
    skill: string;
    wave: string;
    createUser: boolean;
    passwordProvided: boolean;
  };
};

export async function submitOperationalRegistration(input: RegistrationInput) {
  try {
    const email = input.email.toLowerCase().trim();
    const relatedRegistrations = await prisma.employeeRegistrationRequest.findMany({
      where: { OR: [{ email }, { cpf: input.cpf }, { cnpj: input.cnpj }] },
      orderBy: { submittedAt: "desc" }
    });

    const blockingRegistration = relatedRegistrations.find(isBlockingRegistration);
    if (blockingRegistration) {
      const field = blockingRegistration.cpf === input.cpf ? "cpf" : blockingRegistration.email === email ? "email" : "cnpj";
      return {
        error: duplicateMessageForRegistration(blockingRegistration, field),
        type: "DUPLICATE_ERROR",
        fields: {
          ...(field === "email" ? { email: "Já existe um cadastro ativo ou em análise para este e-mail." } : {}),
          ...(field === "cpf" ? { cpf: "Já existe um cadastro ativo ou em análise para este CPF." } : {}),
          ...(field === "cnpj" ? { cnpj: "Já existe um cadastro ativo ou em análise para este CNPJ." } : {})
        }
      };
    }

    const sensitiveMatches = await prisma.employeeSensitiveData.findMany({
      where: { cpf: input.cpf },
      select: { employeeId: true }
    });
    if (sensitiveMatches.length) {
      const activeEmployee = await prisma.employeeProfile.findFirst({
        where: {
          id: { in: sensitiveMatches.map((item) => item.employeeId) },
          deletedAt: null,
          user: { status: "ACTIVE", deletedAt: null }
        }
      });
      if (activeEmployee) {
        return {
          error: "Já existe um colaborador ativo vinculado a este CPF.",
          type: "DUPLICATE_ERROR",
          fields: { cpf: "Já existe um colaborador ativo vinculado a este CPF." }
        };
      }
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser?.status === "ACTIVE" && !existingUser.deletedAt) {
      return {
        error: "Este e-mail já possui usuário na Central Operacional.",
        type: "DUPLICATE_ERROR",
        fields: { email: "Este e-mail já possui login ativo ou cadastrado." }
      };
    }

    const {
      password,
      confirmPassword: _confirmPassword,
      birthDate,
      trainingStartDate,
      requestedLob,
      email: _inputEmail,
      ...registrationData
    } = input;
    const passwordHash = await bcrypt.hash(password, 10);
    const reusableRegistration = relatedRegistrations.find(isReusableRegistration);

    const created = await prisma.$transaction(async (tx) => {
      const baseData = {
        ...registrationData,
        email,
        passwordHash,
        birthDate: parseDate(birthDate),
        trainingStartDate: parseDate(trainingStartDate),
        status: "PENDENTE_APROVACAO" as const,
        submittedAt: new Date(),
        reviewedById: null,
        reviewedAt: null,
        reviewNotes: null,
        operationalData: requestedLob ? { lob: normalizeLobName(requestedLob) } as Prisma.InputJsonObject : Prisma.JsonNull,
        deletedAt: null
      };

      const request = reusableRegistration
        ? await tx.employeeRegistrationRequest.update({
          where: { id: reusableRegistration.id },
          data: {
            ...baseData,
            history: appendHistory(reusableRegistration.history, "Colaborador", "Cadastro reaberto pelo envio de novo formulário.")
          }
        })
        : await tx.employeeRegistrationRequest.create({
          data: {
            ...baseData,
            history: [{ at: new Date().toISOString(), actor: "Colaborador", action: "Cadastro enviado" }]
          }
        });

      const reviewers = await tx.user.findMany({
        where: { status: "ACTIVE", role: { name: { in: ["ADMIN", "GESTOR", "RH", "WFM"] } } }
      });
      for (const reviewer of reviewers) {
        await tx.notification.create({
          data: {
            userId: reviewer.id,
            title: "Cadastro pendente de aprovação",
            body: `${request.fullName} enviou cadastro para análise.`,
            category: "Cadastro",
            type: "APPROVAL",
            entity: "EmployeeRegistrationRequest",
            entityId: request.id,
            href: "/cadastros"
          }
        });
      }
      await tx.auditLog.create({
        data: {
          action: "CRIACAO",
          entity: "EmployeeRegistrationRequest",
          entityId: request.id,
          reason: reusableRegistration ? "Cadastro reaberto pelo envio de novo formulário." : "Cadastro público enviado.",
          previousValue: reusableRegistration ? { status: reusableRegistration.status, deletedAt: reusableRegistration.deletedAt } : undefined,
          newValue: { status: request.status, cpf: maskCpfForAudit(request.cpf), email: request.email }
        }
      });

      return request;
    });

    return {
      success: true,
      registrationId: created.id,
      message: reusableRegistration ? "Cadastro reaberto e enviado para aprovação." : "Cadastro enviado para aprovação.",
      data: mapRegistration(created)
    };
  } catch (error) {
    const normalized = normalizeRegistrationError(error);
    console.error("[registration] erro ao salvar cadastro", error);
    recordErrorLog({ code: normalized.type, message: technicalMessage(error), action: "REGISTRATION_CREATE", severity: "ERROR" });
    return allowDemoDataFallback ? submitMockRegistration(input) : normalized;
  }
}

export async function previewEmployeeImport(actor: Actor, rows: EmployeeImportRow[]) {
  const permission = await canImportEmployees(actor);
  if ("error" in permission) return permission;
  const validations = await validateEmployeeImportRows(rows);
  const errorRows = validations.filter((item) => item.errors.length).length;
  console.info("[employee-import:preview]", {
    actor: actor.email,
    totalRows: rows.length,
    headers: Object.keys(rows[0] ?? {}).slice(0, 80),
    validRows: validations.length - errorRows,
    errorRows,
    warningRows: validations.filter((item) => !item.errors.length && item.warnings.length).length
  });
  return {
    success: true,
    data: {
      totalRows: rows.length,
      validRows: validations.filter((item) => !item.errors.length).length,
      errorRows: validations.filter((item) => item.errors.length).length,
      warningRows: validations.filter((item) => !item.errors.length && item.warnings.length).length,
      usuariosCriar: validations.filter((item) => !item.errors.length && item.preview.createUser).length,
      colaboradoresCriar: validations.filter((item) => !item.errors.length && item.action === "criar").length,
      registrosAtualizar: validations.filter((item) => !item.errors.length && item.action === "atualizar").length,
      duplicidades: validations.filter((item) => [...item.errors, ...item.warnings].some((message) => /duplic|existente|uso/i.test(message))).length,
      rows: validations
    }
  };
}

export async function importEmployeeRows(actor: Actor, rows: EmployeeImportRow[], allowPartial = false) {
  try {
    const permission = await canImportEmployees(actor);
    if ("error" in permission) return permission;
    const validations = await validateEmployeeImportRows(rows);
    const invalidRows = validations.filter((item) => item.errors.length);
    console.info("[employee-import:commit]", {
      actor: actor.email,
      totalRows: rows.length,
      headers: Object.keys(rows[0] ?? {}).slice(0, 80),
      validRows: rows.length - invalidRows.length,
      errorRows: invalidRows.length,
      allowPartial
    });
    if (invalidRows.length && !allowPartial) {
      return { error: `Existem erros na importação de colaboradores. ${summarizeEmployeeImportErrors(validations)}`, preview: { rows: validations } };
    }

    const validRows = rows.filter((_, index) => !validations[index]?.errors.length);
    if (!validRows.length) {
      return { error: `Nenhuma linha válida para importar colaboradores. ${summarizeEmployeeImportErrors(validations)}`, preview: { rows: validations } };
    }
    const normalizedValidRows = validRows.map((row) => normalizeEmployeeImportRow(row));
    const passwordHashByWbLogin = new Map<string, string>();
    await Promise.all(
      normalizedValidRows
        .filter((row) => row.createUser)
        .map(async (row) => {
          passwordHashByWbLogin.set(row.wbLogin, await bcrypt.hash(row.temporaryPassword, 10));
        })
    );
    const fallbackShift = normalizedValidRows.some((row) => !row.shift)
      ? await prisma.shift.upsert({
        where: { name: "Não informado" },
        update: {},
        create: { name: "Não informado", startsAt: "00:00", endsAt: "00:00", color: "#64748B" }
      })
      : null;
    const batchId = `IMPORT-${Date.now()}`;
    let colaboradoresCriados = 0;
    let usuariosCriados = 0;
    let registrosAtualizados = 0;
    let skillWaveUpdates = 0;

    for (const row of normalizedValidRows) {
      const role = await prisma.role.findUniqueOrThrow({ where: { name: row.roleName } });
      const lob = await prisma.lob.findUniqueOrThrow({ where: { name: row.lob } });
      const shift = row.shift
        ? await prisma.shift.findFirstOrThrow({ where: { OR: [{ name: row.shift }, { name: { startsWith: `${row.shift} (` } }] } })
        : fallbackShift!;
      const importDateFallback = new Date();
      const birthDate = row.birthDate ?? row.admissionDate ?? row.trainingStartDate ?? importDateFallback;
      const trainingStartDate = row.trainingStartDate ?? row.admissionDate ?? importDateFallback;
      const admissionDate = row.admissionDate ?? row.trainingStartDate ?? importDateFallback;
      const supervisor = await findSupervisorForImport(prisma, row.supervisorWbLogin, row.supervisorEmail, row.supervisorName);
      const team = await prisma.team.upsert({
        where: { name_lobId: { name: row.teamName || (supervisor?.fullName ? `Time ${supervisor.fullName}` : "Time Inicial"), lobId: lob.id } },
        update: { supervisorId: supervisor?.id },
        create: { name: row.teamName || (supervisor?.fullName ? `Time ${supervisor.fullName}` : "Time Inicial"), lobId: lob.id, supervisorId: supervisor?.id }
      });

        const registrationOr: Prisma.EmployeeRegistrationRequestWhereInput[] = [
          ...(row.cpf ? [{ cpf: row.cpf }] : []),
          ...(row.email ? [{ email: row.email }] : [])
        ];
        const existingRegistration = registrationOr.length
          ? await prisma.employeeRegistrationRequest.findFirst({
            where: { OR: registrationOr },
            orderBy: { submittedAt: "desc" }
          })
          : null;

        const passwordHash = row.createUser ? passwordHashByWbLogin.get(row.wbLogin) ?? null : null;
        const registrationData = {
          submittedAt: new Date(),
          status: "APROVADO" as const,
          cnpj: row.cnpj,
          fullName: row.name,
          addressType: row.addressType,
          addressName: row.address,
          addressNumber: row.addressNumber,
          complement: row.complement || null,
          neighborhood: row.neighborhood,
          city: row.city,
          stateUf: row.stateUf,
          zipCode: row.zipCode,
          primaryPhone: row.primaryPhone,
          emergencyPhone: row.emergencyPhone,
          emergencyContactName: row.emergencyContactName,
          emergencyContactRelationship: row.emergencyContactRelationship,
          birthDate,
          email: row.email || `${row.wbLogin.toLowerCase()}@sem-email.local`,
          passwordHash,
          rg: row.rg,
          rgIssuer: row.rgIssuer,
          cpf: row.cpf,
          sex: row.sex,
          maritalStatus: row.maritalStatus,
          educationLevel: row.educationLevel,
          trainingStartDate,
          preferredSchedule: row.preferredSchedule,
          bankName: row.bankName,
          bankAgency: row.bankAgency,
          bankAccount: row.bankAccount,
          pixKey: row.pixKey,
          pixKeyType: row.pixKeyType,
          secondaryPixKey: row.secondaryPixKey || null,
          secondaryPixKeyType: row.secondaryPixKeyType || null,
          socialName: row.socialName || null,
          hasChildren: row.hasChildren,
          childrenCount: row.hasChildren ? row.childrenCount : null,
          notes: row.notes || (row.cpf ? null : "CPF pendente de complemento administrativo."),
          reviewedById: permission.user.id,
          reviewedAt: new Date(),
          reviewNotes: "Importado via Excel e aprovado automaticamente.",
          operationalData: {
            origin: "IMPORT_EXCEL",
            importBatchId: batchId,
            wbLogin: row.wbLogin,
            lob: row.lob,
            supervisor: row.supervisorName || row.supervisorEmail,
            shift: row.shift,
            roleTitle: row.roleTitle,
            employeeStatus: row.employeeStatus,
            cpfPending: !row.cpf,
            preferredSchedule: row.preferredSchedule,
            team: row.teamName,
            supervisorWbLogin: row.supervisorWbLogin,
            skill: row.skill,
            wave: row.wave,
            scheduleType: row.scheduleType,
            contractType: row.contractType,
            admissionDate: admissionDate.toISOString(),
            trainingStartDate: trainingStartDate.toISOString(),
            siteOperation: row.siteOperation
          } as Prisma.InputJsonObject,
          history: [{ at: new Date().toISOString(), actor: actor.name, action: "Cadastro importado e aprovado via Excel", notes: batchId }] as Prisma.InputJsonArray,
          deletedAt: null
        };

        const registration = existingRegistration
          ? await prisma.employeeRegistrationRequest.update({
            where: { id: existingRegistration.id },
            data: registrationData
          })
          : await prisma.employeeRegistrationRequest.create({ data: registrationData });
        if (existingRegistration) registrosAtualizados += 1;

        let userId: string | undefined;
        if (row.createUser) {
          const existingUser = row.email ? await prisma.user.findUnique({ where: { email: row.email } }) : null;
          const user = existingUser
            ? await prisma.user.update({
              where: { id: existingUser.id },
              data: {
                name: row.name,
                passwordHash: passwordHash!,
                roleId: role.id,
                status: "ACTIVE",
                mustChangePassword: true,
                temporaryPassword: true,
                lastPasswordResetAt: new Date(),
                passwordResetById: permission.user.id,
                deletedAt: null
              }
            })
            : await prisma.user.create({
              data: {
                email: row.email,
                name: row.name,
                passwordHash: passwordHash!,
                roleId: role.id,
                status: "ACTIVE",
                mustChangePassword: true,
                temporaryPassword: true,
                lastPasswordResetAt: new Date(),
                passwordResetById: permission.user.id
              }
            });
          userId = user.id;
          usuariosCriados += existingUser ? 0 : 1;
        }

        const existingByWb = await prisma.employeeProfile.findUnique({ where: { wbLogin: row.wbLogin } });
        const existingByUser = userId ? await prisma.employeeProfile.findUnique({ where: { userId } }) : null;
        const employeeId = existingByWb?.id ?? existingByUser?.id;
        const existingEmployeeForUpdate = existingByWb ?? existingByUser ?? null;
        if (existingEmployeeForUpdate && ((row.skill && row.skill !== (existingEmployeeForUpdate.skill ?? "")) || (row.wave && row.wave !== (existingEmployeeForUpdate.wave ?? "")))) {
          skillWaveUpdates += 1;
        }
        const employee = employeeId
          ? await prisma.employeeProfile.update({
            where: { id: employeeId },
            data: {
              userId,
              fullName: row.name,
              socialName: row.socialName || null,
              roleTitle: row.roleTitle,
              admissionDate,
              scheduleType: row.scheduleType,
              operationalStatus: row.employeeStatus,
              lobId: lob.id,
              teamId: team.id,
              supervisorId: supervisor?.id,
              shiftId: shift.id,
              ...(row.skill ? { skill: row.skill } : {}),
              ...(row.wave ? { wave: row.wave } : {}),
              trainingStartDate,
              contractType: row.contractType || null,
              siteOperation: row.siteOperation || null,
              internalNotes: row.notes || null,
              primaryPhone: row.primaryPhone || null,
              city: row.city || null,
              stateUf: row.stateUf || null,
              preferredSchedule: row.preferredSchedule || null,
              deletedAt: null
            }
          })
          : await prisma.employeeProfile.create({
            data: {
              userId,
              wbLogin: row.wbLogin,
              fullName: row.name,
              socialName: row.socialName || null,
              roleTitle: row.roleTitle,
              admissionDate,
              scheduleType: row.scheduleType,
              operationalStatus: row.employeeStatus,
              lobId: lob.id,
              teamId: team.id,
              supervisorId: supervisor?.id,
              shiftId: shift.id,
              skill: row.skill || null,
              wave: row.wave || null,
              trainingStartDate,
              contractType: row.contractType || null,
              siteOperation: row.siteOperation || null,
              internalNotes: row.notes || null,
              primaryPhone: row.primaryPhone || null,
              city: row.city || null,
              stateUf: row.stateUf || null,
              preferredSchedule: row.preferredSchedule || null,
              deletedAt: null
            }
          });
        if (!employeeId) colaboradoresCriados += 1;

        await prisma.employeeSensitiveData.upsert({
          where: { employeeId: employee.id },
          update: sensitiveDataFromImport(row, birthDate),
          create: { employeeId: employee.id, ...sensitiveDataFromImport(row, birthDate) }
        });

        await prisma.employeeRegistrationRequest.update({
          where: { id: registration.id },
          data: {
            createdUserId: userId,
            createdEmployeeProfileId: employee.id
          }
        });
      }

      await prisma.auditLog.create({
        data: {
          actorId: permission.user.id,
          action: "IMPORTACAO",
          entity: "EmployeeProfile",
          entityId: batchId,
          reason: "Importação em massa de colaboradores via Excel",
          newValue: {
            totalRows: rows.length,
            validRows: validRows.length,
            errorRows: invalidRows.length,
            colaboradoresCriados,
            usuariosCriados,
            registrosAtualizados,
            skillWaveUpdates
          }
        }
      });

    return {
      success: true,
      data: {
        importBatchId: batchId,
        totalRows: rows.length,
        validRows: validRows.length,
        errorRows: invalidRows.length,
        warningRows: validations.filter((item) => !item.errors.length && item.warnings.length).length,
        usuariosCriar: validations.filter((item) => !item.errors.length && item.preview.createUser).length,
        colaboradoresCriar: validations.filter((item) => !item.errors.length && item.action === "criar").length,
        registrosAtualizar: validations.filter((item) => !item.errors.length && item.action === "atualizar").length,
        duplicidades: validations.filter((item) => [...item.errors, ...item.warnings].some((message) => /duplic|existente|uso/i.test(message))).length,
        colaboradoresCriados,
        usuariosCriados,
        registrosAtualizados,
        skillWaveUpdates,
        ignoredRows: invalidRows.length,
        rows: validations
      }
    };
  } catch (error) {
    console.error("[registration-import] erro ao importar colaboradores", error);
    recordErrorLog({ userEmail: actor.email, code: "EMPLOYEE_IMPORT_DB_ERROR", message: error instanceof Error ? error.message : "Falha ao importar colaboradores", action: "EMPLOYEE_IMPORT", severity: "ERROR" });
    const mapped = mapPrismaError(error);
    if (mapped) return mapped;
    return { error: error instanceof Error ? `Não foi possível importar colaboradores: ${error.message}` : "Não foi possível importar colaboradores. Verifique os dados obrigatórios e duplicidades." };
  }
}

function summarizeEmployeeImportErrors(validation: EmployeeImportValidation[]) {
  const issues = validation
    .filter((row) => row.errors.length)
    .slice(0, 8)
    .map((row) => `Linha ${row.rowNumber}: ${row.errors.join(" ")}`);
  if (!issues.length) return "Revise os alertas do preview.";
  const remaining = validation.filter((row) => row.errors.length).length - issues.length;
  return `${issues.join(" | ")}${remaining > 0 ? ` | +${remaining} linha(s) com erro.` : ""}`;
}

export async function listOperationalRegistrations(actor: Actor, query: RegistrationListQuery = {}) {
  try {
    const user = await prisma.user.findUnique({ where: { email: actor.email }, include: { role: true } });
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(25, Number(query.limit) || 50));
    if (!user) {
      const mock = allowDemoDataFallback ? listMockRegistrations(actor) : [];
      return { data: mock, total: mock.length, page: 1, limit, totalPages: 1, summary: summarizeRegistrations(mock) };
    }
    if (!["ADMIN", "GESTOR", "RH", "WFM"].includes(normalizeRole(actor.role))) {
      return { data: [], total: 0, page: 1, limit, totalPages: 1, summary: summarizeRegistrations([]) };
    }

    const status = registrationStatusFromFilter(query.status);
    const search = query.search?.trim();
    const where: Prisma.EmployeeRegistrationRequestWhereInput = {
      deletedAt: null,
      ...(status ? { status } : {}),
      ...(search ? {
        OR: [
          { fullName: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
          { cpf: { contains: search.replace(/\D/g, ""), mode: "insensitive" } }
        ]
      } : {})
    };
    const [items, total, statusItems] = await prisma.$transaction([
      prisma.employeeRegistrationRequest.findMany({
        where,
        orderBy: { submittedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit
      }),
      prisma.employeeRegistrationRequest.count({ where }),
      prisma.employeeRegistrationRequest.findMany({
        where: { deletedAt: null },
        select: { status: true }
      })
    ]);
    return {
      data: items.map(mapRegistration),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      summary: summarizeRegistrationStatuses(statusItems)
    };
  } catch (error) {
    recordErrorLog({ userEmail: actor.email, code: "REGISTRATION_LIST_DB_ERROR", message: error instanceof Error ? error.message : "Falha ao listar cadastros reais", action: "REGISTRATION_LIST", severity: "ERROR" });
    const fallback = allowDemoDataFallback ? listMockRegistrations(actor) : [];
    return { data: fallback, total: fallback.length, page: 1, limit: Number(query.limit) || 50, totalPages: 1, summary: summarizeRegistrations(fallback) };
  }
}

export async function reviewOperationalRegistration(actor: Actor, input: RegistrationReviewInput) {
  try {
    const reviewer = await prisma.user.findUnique({ where: { email: actor.email }, include: { role: true } });
    if (!reviewer && allowDemoDataFallback) return reviewMockRegistration(actor, input);
    if (!reviewer || !["ADMIN", "GESTOR", "RH", "WFM"].includes(normalizeRole(actor.role))) return { error: "Sem permissão para revisar cadastro." };

    const existing = await prisma.employeeRegistrationRequest.findUnique({ where: { id: input.id } });
    if (!existing) return { error: "Cadastro não encontrado." };

    if (existing.status === "APROVADO" || existing.status === "ATIVO") return { error: "Cadastro já foi aprovado." };
    if (existing.status === "RECUSADO") return { error: "Cadastro já foi recusado." };
    if (input.action === "approve" && !input.operationalData) return { error: "Dados operacionais são obrigatórios para aprovação." };
    if (input.action === "approve" && !existing.passwordHash) return { error: "Este cadastro não possui senha cadastrada. Solicite ajuste ao colaborador." };

    const existingUser = input.action === "approve" ? await prisma.user.findUnique({ where: { email: existing.email } }) : null;
    if (input.action === "approve" && existingUser?.status === "ACTIVE" && existingUser.id !== existing.createdUserId) {
      return { error: "Já existe um usuário ativo com este e-mail." };
    }
    if (input.action === "approve" && !isSelectableShiftName(input.operationalData?.shift)) {
      return { error: "Turno selecionado não é uma opção padrão válida." };
    }

    const result = await prisma.$transaction(async (tx) => {
      if (input.action !== "approve") {
        const status: EmployeeRegistrationStatus = input.action === "reject" ? "RECUSADO" : "AJUSTE_SOLICITADO";
        const updated = await tx.employeeRegistrationRequest.update({
          where: { id: existing.id },
          data: {
            status,
            reviewedById: reviewer.id,
            reviewedAt: new Date(),
            reviewNotes: input.reviewNotes,
            history: appendHistory(existing.history, actor.name, input.action === "reject" ? "Cadastro recusado" : "Ajuste solicitado", input.reviewNotes)
          }
        });
        await auditRegistration(tx, reviewer.id, input.action === "reject" ? "RECUSA" : "EDICAO", updated.id, input.reviewNotes, existing.status, status);
        return updated;
      }

      const op = { ...input.operationalData!, lob: normalizeLobName(input.operationalData!.lob), shift: cleanShiftName(input.operationalData!.shift) || "Manhã" };
      const lob = await tx.lob.upsert({
        where: { name: op.lob },
        update: op.lob === "ALL" ? { description: "Atuação transversal / staff / multi-LOB" } : {},
        create: { name: op.lob, description: op.lob === "ALL" ? "Atuação transversal / staff / multi-LOB" : "Criado no cadastro real" }
      });
      const existingShift = await tx.shift.findFirst({ where: { OR: [{ name: op.shift }, { name: { startsWith: `${op.shift} (` } }] } });
      const shift = existingShift ?? await tx.shift.create({ data: { name: op.shift, startsAt: defaultShiftStart(op.shift), endsAt: defaultShiftEnd(op.shift), color: "#2563EB" } });
      const supervisor = op.supervisor
        ? await tx.employeeProfile.findFirst({ where: { OR: [{ fullName: op.supervisor }, { wbLogin: op.supervisor }] } })
        : null;
      const team = await tx.team.upsert({
        where: { name_lobId: { name: op.team, lobId: lob.id } },
        update: { supervisorId: supervisor?.id },
        create: { name: op.team, lobId: lob.id, supervisorId: supervisor?.id }
      });
      const approvedEmployeeStatus = !op.employeeStatus || op.employeeStatus === "Pendente de Cadastro" ? "Ativo" : op.employeeStatus;
      const collaboratorRole = await tx.role.findUniqueOrThrow({ where: { name: "COLABORADOR" } });
      const user = existingUser
        ? await tx.user.update({
          where: { id: existingUser.id },
          data: {
            name: existing.fullName,
            passwordHash: existing.passwordHash!,
            roleId: collaboratorRole.id,
            status: "ACTIVE",
            mustChangePassword: false,
            temporaryPassword: false,
            passwordChangedAt: new Date(),
            deletedAt: null
          }
        })
        : await tx.user.create({
          data: {
          email: existing.email,
          name: existing.fullName,
          passwordHash: existing.passwordHash!,
          roleId: collaboratorRole.id,
          status: "ACTIVE",
          mustChangePassword: false,
          temporaryPassword: false,
          passwordChangedAt: new Date()
          }
        });

      const profileByWb = await tx.employeeProfile.findUnique({ where: { wbLogin: op.wbLogin } });
      const profileByUser = await tx.employeeProfile.findUnique({ where: { userId: user.id } });
      const profileId = profileByWb?.id ?? profileByUser?.id;
      const employee = profileId
        ? await tx.employeeProfile.update({
            where: { id: profileId },
            data: {
              userId: user.id,
              wbLogin: op.wbLogin,
              fullName: existing.fullName,
              roleTitle: op.roleTitle,
              admissionDate: parseDate(op.admissionDate),
              scheduleType: op.schedule,
              operationalStatus: approvedEmployeeStatus,
              lobId: lob.id,
              teamId: team.id,
              supervisorId: supervisor?.id,
              shiftId: shift.id,
              skill: op.skill?.trim() || null,
              wave: op.wave?.trim() || null
            }
          })
        : await tx.employeeProfile.create({
            data: {
              userId: user.id,
              wbLogin: op.wbLogin,
              fullName: existing.fullName,
              roleTitle: op.roleTitle,
              admissionDate: parseDate(op.admissionDate),
              scheduleType: op.schedule,
              operationalStatus: approvedEmployeeStatus,
              lobId: lob.id,
              teamId: team.id,
              supervisorId: supervisor?.id,
              shiftId: shift.id,
              skill: op.skill?.trim() || null,
              wave: op.wave?.trim() || null
            }
          });

      await tx.employeeSensitiveData.upsert({
        where: { employeeId: employee.id },
        update: sensitiveData(existing),
        create: { employeeId: employee.id, ...sensitiveData(existing) }
      });

      const updated = await tx.employeeRegistrationRequest.update({
        where: { id: existing.id },
        data: {
          status: "APROVADO",
          reviewedById: reviewer.id,
          reviewedAt: new Date(),
          reviewNotes: input.reviewNotes,
          createdUserId: user.id,
          createdEmployeeProfileId: employee.id,
          operationalData: op as Prisma.InputJsonObject,
          history: appendHistory(existing.history, actor.name, "Cadastro aprovado e colaborador ativado", input.reviewNotes)
        }
      });

      await tx.notification.create({
        data: {
          userId: user.id,
          title: "Cadastro aprovado",
          body: "Seu acesso foi liberado. O cronograma aparecerá assim que for importado e vinculado ao seu cadastro.",
          category: "Cadastro",
          type: "SUCCESS",
          entity: "EmployeeRegistrationRequest",
          entityId: updated.id,
          href: "/minha-escala"
        }
      });
      await auditRegistration(tx, reviewer.id, "APROVACAO", updated.id, input.reviewNotes, existing.status, "APROVADO");
      return updated;
    });

    return { data: mapRegistration(result) };
  } catch (error) {
    console.error("[registration] erro ao revisar cadastro", error);
    recordErrorLog({ userEmail: actor.email, code: "REGISTRATION_REVIEW_DB_ERROR", message: error instanceof Error ? error.message : "Falha ao revisar cadastro real", action: "REGISTRATION_REVIEW", severity: "ERROR" });
    const normalized = normalizeRegistrationError(error);
    const message = normalized.type === "DATABASE_ERROR" ? "Erro ao criar usuário. Verifique os dados obrigatórios e o seed mínimo do sistema." : normalized.error;
    return allowDemoDataFallback ? reviewMockRegistration(actor, input) : { error: message, type: normalized.type, fields: normalized.fields };
  }
}

export async function deleteOperationalRegistration(actor: Actor, id: string) {
  try {
    const reviewer = await prisma.user.findUnique({
      where: { email: actor.email },
      include: { role: true, permissions: { include: { permission: true } } }
    });
    if (!reviewer) return { error: "Usuário não autenticado." };

    const role = normalizeRole(actor.role);
    const hasDeletePermission = reviewer.permissions.some((item) =>
      item.granted && ["CADASTRO_EXCLUIR", "cadastros.excluir", "employee_registration.delete"].includes(item.permission.key)
    );
    if (role !== "ADMIN" && !hasDeletePermission) return { error: "Apenas Admin ou usuários com permissão específica podem excluir cadastros." };

    const existing = await prisma.employeeRegistrationRequest.findFirst({ where: { id, deletedAt: null } });
    if (!existing) return { error: "Cadastro não encontrado." };

    const isLinked = Boolean(existing.createdUserId || existing.createdEmployeeProfileId || ["APROVADO", "ATIVO"].includes(existing.status));
    if (isLinked && role !== "ADMIN") return { error: "Cadastros aprovados só podem ser inativados por Admin." };

    const now = new Date();
    const updated = await prisma.$transaction(async (tx) => {
      if (existing.createdUserId) {
        await tx.user.update({
          where: { id: existing.createdUserId },
          data: { status: "INACTIVE", deletedAt: now }
        });
      }

      if (existing.createdEmployeeProfileId) {
        await tx.employeeProfile.update({
          where: { id: existing.createdEmployeeProfileId },
          data: { deletedAt: now, operationalStatus: "Inativo" }
        });
      }

      const request = await tx.employeeRegistrationRequest.update({
        where: { id: existing.id },
        data: {
          status: isLinked ? "INATIVO" : existing.status,
          deletedAt: now,
          reviewedById: reviewer.id,
          reviewedAt: now,
          history: appendHistory(existing.history, actor.name, isLinked ? "Cadastro inativado" : "Cadastro excluído", "Remoção manual pelo painel de cadastros")
        }
      });

      await auditRegistration(tx, reviewer.id, "EXCLUSAO", existing.id, "Remoção manual pelo painel de cadastros", existing.status, request.status);
      return request;
    });

    return { data: mapRegistration(updated), message: isLinked ? "Cadastro inativado com sucesso." : "Cadastro excluído com sucesso." };
  } catch (error) {
    console.error("[registration] erro ao excluir cadastro", error);
    recordErrorLog({ userEmail: actor.email, code: "REGISTRATION_DELETE_DB_ERROR", message: error instanceof Error ? error.message : "Falha ao excluir cadastro", action: "REGISTRATION_DELETE", severity: "ERROR" });
    return { error: "Não foi possível excluir o cadastro." };
  }
}

function isBlockingRegistration(item: EmployeeRegistrationRequest) {
  return !item.deletedAt && !["RECUSADO", "INATIVO"].includes(item.status);
}

async function canImportEmployees(actor: Actor) {
  const user = await prisma.user.findUnique({ where: { email: actor.email }, include: { role: true } });
  if (!user) return { error: "Usuário não autenticado." };
  if (!["ADMIN", "GESTOR", "RH", "WFM"].includes(normalizeRole(actor.role))) return { error: "Sem permissão para importar colaboradores." };
  return { user };
}

async function validateEmployeeImportRows(rows: EmployeeImportRow[]): Promise<EmployeeImportValidation[]> {
  const normalizedRows = rows.map((row) => normalizeEmployeeImportRow(row));
  const seenCpf = new Set<string>();
  const seenEmail = new Set<string>();
  const seenWb = new Set<string>();
  const unique = (values: string[]) => [...new Set(values.filter(Boolean))];
  const wbLogins = unique(normalizedRows.map((row) => row.wbLogin));
  const supervisorWbLogins = unique(normalizedRows.map((row) => row.supervisorWbLogin));
  const cpfs = unique(normalizedRows.map((row) => row.cpf ?? ""));
  const emails = unique(normalizedRows.map((row) => row.email));
  const [roles, lobs, shifts, employeesByWb, sensitiveMatches, activeUsers] = await Promise.all([
    prisma.role.findMany({ select: { name: true } }),
    prisma.lob.findMany({ select: { name: true } }),
    prisma.shift.findMany({ select: { name: true } }),
    prisma.employeeProfile.findMany({
      where: { wbLogin: { in: unique([...wbLogins, ...supervisorWbLogins]) }, deletedAt: null },
      select: { id: true, userId: true, wbLogin: true, skill: true, wave: true, user: { select: { role: { select: { name: true } } } } }
    }),
    cpfs.length ? prisma.employeeSensitiveData.findMany({ where: { cpf: { in: cpfs } }, select: { cpf: true, employeeId: true } }) : Promise.resolve([]),
    emails.length ? prisma.user.findMany({ where: { email: { in: emails }, status: "ACTIVE", deletedAt: null }, select: { id: true, email: true } }) : Promise.resolve([])
  ]);
  const validRoles = new Set(roles.map((role) => role.name));
  const validLobs = new Set(lobs.map((lob) => lob.name.toUpperCase()));
  const validShifts = new Set(shifts
    .filter((shift) => isSelectableShiftName(shift.name))
    .flatMap((shift) => [normalizeLookupKey(shift.name), normalizeLookupKey(cleanShiftName(shift.name))]));
  const employeeByWb = new Map(employeesByWb.map((employee) => [employee.wbLogin, employee]));
  const activeUserByEmail = new Map(activeUsers.map((user) => [user.email.toLowerCase(), user]));
  const sensitiveEmployeeIds = unique(sensitiveMatches.map((item) => item.employeeId));
  const cpfEmployees = sensitiveEmployeeIds.length
    ? await prisma.employeeProfile.findMany({ where: { id: { in: sensitiveEmployeeIds }, deletedAt: null }, select: { id: true, userId: true } })
    : [];
  const cpfEmployeeById = new Map(cpfEmployees.map((employee) => [employee.id, employee]));
  const activeEmployeeByCpfMap = new Map<string, { id: string; userId: string | null }>();
  for (const match of sensitiveMatches) {
    if (!match.cpf) continue;
    const employee = cpfEmployeeById.get(match.employeeId);
    if (employee && !activeEmployeeByCpfMap.has(match.cpf)) activeEmployeeByCpfMap.set(match.cpf, employee);
  }

  const validations: EmployeeImportValidation[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = normalizedRows[index];
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!row.name) errors.push("Nome obrigatório.");
    if (!row.wbLogin) errors.push("WB/Login obrigatório.");
    if (!row.roleTitle) errors.push("Cargo/Função obrigatório.");
    if (!text(rows[index]?.role_permissao)) errors.push("Role/Permissão obrigatória.");
    if (!row.lob) errors.push("LOB obrigatória.");
    if (!row.employeeStatus) errors.push("Status do colaborador obrigatório.");
    if (!hasImportValue(rows[index]?.criar_usuario)) errors.push("criar_usuario obrigatório.");
    if (row.lob && text(rows[index]?.lob).toLowerCase() === "todos") errors.push("Todos é opção de filtro. Para atuação transversal use a LOB real ALL.");
    if (row.lob && !validLobs.has(row.lob.toUpperCase())) errors.push(`LOB ${row.lob} não existe em Configurações.`);
    if (row.shift && isBlockedShiftName(row.shift)) {
      const blockedKey = shiftLookupKey(cleanShiftName(row.shift));
      errors.push(blockedKey === "PLANTAO" ? "Plantão não é um turno ativo." : "Férias deve ser usada como status de cronograma, não como turno.");
    } else if (row.shift && (!isSelectableShiftName(row.shift) || !validShifts.has(normalizeLookupKey(cleanShiftName(row.shift))))) errors.push(`Turno ${row.shift} não existe em Configurações.`);
    if (row.cpf && !isCpfFormat(row.cpf)) errors.push("CPF inválido.");
    if (!row.cpf) warnings.push("CPF pendente: o colaborador será importado com cadastro incompleto para complemento posterior.");
    if (row.createUser && !row.email) errors.push("E-mail obrigatório quando criar_usuario = sim.");
    if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) errors.push("E-mail inválido.");
    if (!validRoles.has(row.roleName)) errors.push(`Role/permissão inválida: ${row.roleName}.`);
    if (hasImportValue(rows[index]?.data_nascimento) && !row.birthDate) errors.push("Data de nascimento inválida.");
    if (hasImportValue(rows[index]?.data_admissao) && !row.admissionDate) errors.push("Data de admissão inválida.");
    if (hasImportValue(rows[index]?.data_inicio_treinamento) && !row.trainingStartDate) errors.push("Data de início do treinamento inválida.");
    if (row.stateUf && !/^[A-Z]{2}$/.test(row.stateUf)) errors.push("Estado UF deve ter 2 letras.");
    if (row.zipCode && !/^\d{5}-?\d{3}$/.test(row.zipCode)) warnings.push("CEP fora do padrão 00000-000.");
    if (row.primaryPhone && !/^\d{2}\s?\d{4,5}-?\d{4}$/.test(row.primaryPhone.replace(/[()]/g, ""))) warnings.push("Contato principal fora do padrão brasileiro.");
    if (row.createUser && !row.temporaryPassword) errors.push("Senha temporária obrigatória quando criar_usuario = sim.");
    if (row.createUser && row.temporaryPassword && row.temporaryPassword.length < 8) errors.push("Senha temporária deve ter pelo menos 8 caracteres.");

    if (row.cpf && seenCpf.has(row.cpf)) errors.push("CPF duplicado dentro do arquivo.");
    if (row.email && seenEmail.has(row.email)) errors.push("E-mail duplicado dentro do arquivo.");
    if (row.wbLogin && seenWb.has(row.wbLogin)) errors.push("WB/Login duplicado dentro do arquivo.");
    if (row.cpf) seenCpf.add(row.cpf);
    if (row.email) seenEmail.add(row.email);
    if (row.wbLogin) seenWb.add(row.wbLogin);

    const activeByWb = row.wbLogin ? employeeByWb.get(row.wbLogin) ?? null : null;
    if (activeByWb) {
      warnings.push("WB/Login existente: o colaborador será atualizado.");
      if (row.skill && row.skill !== (activeByWb.skill ?? "")) warnings.push(`Skill será atualizada de ${activeByWb.skill || "vazio"} para ${row.skill}.`);
      if (row.wave && row.wave !== (activeByWb.wave ?? "")) warnings.push(`Wave será atualizada de ${activeByWb.wave || "vazio"} para ${row.wave}.`);
    }
    const activeByCpf = row.cpf ? activeEmployeeByCpfMap.get(row.cpf) ?? null : null;
    if (activeByCpf && activeByCpf.id !== activeByWb?.id) errors.push("Já existe colaborador ativo com este CPF.");
    const activeUser = row.email ? activeUserByEmail.get(row.email) ?? null : null;
    if (activeUser && activeUser.id !== activeByWb?.userId) errors.push("Já existe usuário ativo com este e-mail.");
    if (row.supervisorWbLogin) {
      const supervisor = employeeByWb.get(row.supervisorWbLogin);
      if (!supervisor) errors.push("Supervisor informado por WB/Login não encontrado.");
      if (supervisor?.user && !["SUPERVISOR", "ADMIN"].includes(supervisor.user.role.name)) errors.push("Supervisor informado precisa ter role SUPERVISOR ou ADMIN.");
    }

    validations.push({
      rowNumber: index + 1,
      errors,
      warnings,
      action: errors.length ? "ignorar" : activeByWb ? "atualizar" : "criar",
      status: errors.length ? "Erro" : warnings.length ? "Alerta" : "Válida",
      preview: {
        name: row.name,
        email: row.email,
        cpf: maskCpfForAudit(row.cpf),
        wbLogin: row.wbLogin,
        role: row.roleName,
        lob: row.lob,
        skill: row.skill,
        wave: row.wave,
        createUser: row.createUser,
        passwordProvided: Boolean(row.temporaryPassword)
      }
    });
  }
  return validations;
}

function normalizeEmployeeImportRow(raw: EmployeeImportRow) {
  const cpf = text(raw.cpf) || null;
  const email = text(raw.email).toLowerCase();
  const wbLogin = text(raw.wb_login);
  const roleName = normalizeImportRole(text(raw.role_permissao));
  return {
    cnpj: text(raw.cnpj),
    name: text(raw.nome),
    socialName: text(raw.nome_social),
    email,
    cpf,
    rg: text(raw.rg),
    rgIssuer: text(raw.orgao_expedidor_uf),
    birthDate: parseImportDate(raw.data_nascimento),
    sex: text(raw.sexo) || "Não informado",
    maritalStatus: text(raw.estado_civil) || "Não informado",
    educationLevel: text(raw.escolaridade) || "Não informado",
    hasChildren: parseImportBoolean(raw.tem_filhos),
    childrenCount: Number(text(raw.quantidade_filhos)) || 0,
    addressType: text(raw.endereco_tipo) || "Rua",
    address: text(raw.endereco) || "Não informado",
    addressNumber: text(raw.numero) || "S/N",
    complement: text(raw.complemento),
    neighborhood: text(raw.bairro) || "Não informado",
    city: text(raw.cidade) || "Não informado",
    stateUf: text(raw.estado_uf).toUpperCase(),
    zipCode: text(raw.cep),
    primaryPhone: text(raw.contato_principal),
    emergencyPhone: text(raw.contato_emergencia),
    emergencyContactName: text(raw.nome_contato_emergencia) || "Não informado",
    emergencyContactRelationship: text(raw.parentesco_contato_emergencia) || "Não informado",
    wbLogin,
    roleTitle: text(raw.cargo_funcao),
    roleName,
    lob: normalizeLobName(raw.lob),
    teamName: text(raw.time),
    supervisorWbLogin: text(raw.supervisor_wb_login),
    supervisorEmail: text(raw.supervisor_email).toLowerCase(),
    supervisorName: text(raw.supervisor_nome),
    shift: normalizeShiftName(raw.turno),
    skill: text(raw.skill),
    wave: text(raw.wave),
    scheduleType: text(raw.escala_modelo) || text(raw.preferencia_horario) || "Não informado",
    employeeStatus: normalizeEmployeeStatus(raw.status_colaborador),
    contractType: normalizeContractType(raw.tipo_contrato),
    admissionDate: parseImportDate(raw.data_admissao),
    trainingStartDate: parseImportDate(raw.data_inicio_treinamento),
    siteOperation: text(raw.site_operacao),
    preferredSchedule: text(raw.preferencia_horario) || "Não informado",
    bankName: text(raw.banco) || "Não informado",
    bankAgency: text(raw.agencia) || "Não informado",
    bankAccount: text(raw.conta_corrente) || "Não informado",
    pixKey: text(raw.chave_pix) || "Não informado",
    pixKeyType: text(raw.tipo_chave_pix) || "Não informado",
    secondaryPixKey: text(raw.chave_pix_secundaria),
    secondaryPixKeyType: text(raw.tipo_chave_pix_secundaria),
    notes: text(raw.observacoes),
    createUser: parseImportBoolean(raw.criar_usuario),
    temporaryPassword: text(raw.senha_temporaria)
  };
}

function sensitiveDataFromImport(row: ReturnType<typeof normalizeEmployeeImportRow>, birthDate: Date) {
  return {
    cpf: row.cpf,
    rg: row.rg,
    rgIssuer: row.rgIssuer,
    cnpj: row.cnpj,
    birthDate,
    address: {
      type: row.addressType,
      name: row.address,
      number: row.addressNumber,
      complement: row.complement,
      neighborhood: row.neighborhood,
      city: row.city,
      stateUf: row.stateUf,
      zipCode: row.zipCode
    },
    bankData: {
      bankName: row.bankName,
      bankAgency: row.bankAgency,
      bankAccount: row.bankAccount,
      pixKey: row.pixKey,
      pixKeyType: row.pixKeyType,
      secondaryPixKey: row.secondaryPixKey,
      secondaryPixKeyType: row.secondaryPixKeyType
    },
    emergencyContactData: {
      name: row.emergencyContactName,
      phone: row.emergencyPhone,
      relationship: row.emergencyContactRelationship,
      primaryPhone: row.primaryPhone
    },
    familyData: {
      hasChildren: row.hasChildren,
      childrenCount: row.childrenCount,
      maritalStatus: row.maritalStatus,
      sex: row.sex,
      educationLevel: row.educationLevel,
      socialName: row.socialName
    }
  };
}

async function findSupervisorForImport(tx: Prisma.TransactionClient, wbLogin: string, email: string, name: string) {
  if (wbLogin) {
    const employee = await tx.employeeProfile.findFirst({
      where: { wbLogin, deletedAt: null },
      include: { user: { include: { role: true } } }
    });
    if (employee?.user && ["SUPERVISOR", "ADMIN"].includes(employee.user.role.name)) return employee;
  }
  if (email) {
    const user = await tx.user.findUnique({ where: { email }, include: { employeeProfile: true } });
    if (user?.employeeProfile) return user.employeeProfile;
  }
  if (name) return tx.employeeProfile.findFirst({ where: { fullName: { contains: name, mode: "insensitive" } } });
  return null;
}

function normalizeImportRole(value: string) {
  const normalized = normalizeRole(value);
  return normalized;
}

function parseImportBoolean(value: unknown) {
  return ["sim", "s", "yes", "y", "true", "1"].includes(text(value).toLowerCase());
}

function parseImportDate(value: unknown) {
  if (!hasImportValue(value)) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number") {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    return new Date(excelEpoch.getTime() + value * 24 * 60 * 60 * 1000);
  }
  const raw = text(value);
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
    const [day, month, year] = raw.split("/").map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }
  const parsed = new Date(`${raw.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isCpfFormat(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length === 11;
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeLobName(value: unknown) {
  const raw = text(value);
  if (!raw) return "";
  return raw.toUpperCase();
}

function normalizeShiftName(value: unknown) {
  const raw = cleanShiftName(text(value));
  if (!raw) return "";
  const key = normalizeLookupKey(raw);
  const map: Record<string, string> = {
    MANHA: "Manhã",
    TARDE: "Tarde",
    NOITE: "Noite",
    FOLGA: "Folga"
  };
  return map[key] ?? raw;
}

function normalizeEmployeeStatus(value: unknown) {
  const raw = text(value);
  if (!raw) return "";
  const key = normalizeLookupKey(raw);
  const map: Record<string, string> = {
    ATIVO: "Ativo",
    ACTIVE: "Ativo",
    INATIVO: "Inativo",
    INACTIVE: "Inativo",
    PENDENTE: "Pendente de Cadastro",
    PENDING: "Pendente de Cadastro",
    EM_TREINAMENTO: "Em treinamento",
    TREINAMENTO: "Em treinamento",
    NESTING: "Nesting",
    AFASTADO: "Afastado",
    DESLIGADO: "Desligado",
    SUSPENSO: "Suspenso"
  };
  return map[key] ?? raw;
}

function normalizeContractType(value: unknown) {
  const raw = text(value);
  if (!raw) return "";
  const key = normalizeLookupKey(raw);
  const map: Record<string, string> = {
    PJ: "PJ",
    CLT: "CLT",
    ESTAGIO: "Estágio",
    TEMPORARIO: "Temporário",
    TERCEIRO: "Terceiro",
    OUTRO: "Outro"
  };
  return map[key] ?? raw;
}

function normalizeLookupKey(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase().replace(/[\s/-]+/g, "_");
}

function hasImportValue(value: unknown) {
  if (value instanceof Date) return true;
  if (typeof value === "number") return true;
  return text(value) !== "";
}

function isReusableRegistration(item: EmployeeRegistrationRequest) {
  return Boolean(item.deletedAt) || ["RECUSADO", "INATIVO"].includes(item.status);
}

function duplicateMessageForRegistration(item: EmployeeRegistrationRequest, field: "cpf" | "email" | "cnpj") {
  if (field === "cpf") {
    return item.status === "PENDENTE_APROVACAO" || item.status === "ENVIADO" || item.status === "AJUSTE_SOLICITADO"
      ? "Já existe uma solicitação de cadastro em análise para este CPF."
      : "Já existe um cadastro ativo ou aprovado com este CPF.";
  }
  if (field === "email") {
    return item.status === "PENDENTE_APROVACAO" || item.status === "ENVIADO" || item.status === "AJUSTE_SOLICITADO"
      ? "Já existe uma solicitação de cadastro em análise para este e-mail."
      : "Já existe um cadastro ativo ou aprovado com este e-mail.";
  }
  return "Já existe um cadastro ativo ou em análise para este CNPJ.";
}

function registrationStatusFromFilter(value?: string) {
  if (!value || value === "Todos") return undefined;
  const normalized = normalizeLookupKey(value);
  const map: Record<string, EmployeeRegistrationStatus> = {
    RASCUNHO: "RASCUNHO",
    ENVIADO: "ENVIADO",
    PENDENTE_APROVACAO: "PENDENTE_APROVACAO",
    PENDENTE_DE_APROVACAO: "PENDENTE_APROVACAO",
    AJUSTE_SOLICITADO: "AJUSTE_SOLICITADO",
    APROVADO: "APROVADO",
    ATIVO: "ATIVO",
    RECUSADO: "RECUSADO",
    INATIVO: "INATIVO"
  };
  return map[normalized];
}

function summarizeRegistrationStatuses(items: Array<{ status: EmployeeRegistrationStatus }>) {
  const count = (statuses: EmployeeRegistrationStatus[]) => items.filter((item) => statuses.includes(item.status)).length;
  return {
    pending: count(["PENDENTE_APROVACAO", "ENVIADO"]),
    active: count(["ATIVO", "APROVADO"]),
    adjust: count(["AJUSTE_SOLICITADO"]),
    refused: count(["RECUSADO"])
  };
}

function summarizeRegistrations(items: Array<{ status: string }>) {
  return {
    pending: items.filter((item) => item.status === "Pendente de Aprovação" || item.status === "Enviado").length,
    active: items.filter((item) => item.status === "Ativo" || item.status === "Aprovado").length,
    adjust: items.filter((item) => item.status === "Ajuste Solicitado").length,
    refused: items.filter((item) => item.status === "Recusado").length
  };
}

function mapRegistration(item: EmployeeRegistrationRequest) {
  return {
    id: item.id,
    submittedAt: formatDateTime(item.submittedAt),
    status: registrationStatusLabel(item.status),
    fullName: item.fullName,
    email: item.email,
    hasPassword: Boolean(item.passwordHash),
    cpf: item.cpf,
    cnpj: item.cnpj,
    city: item.city,
    stateUf: item.stateUf,
    primaryPhone: item.primaryPhone,
    emergencyContactName: item.emergencyContactName,
    emergencyPhone: item.emergencyPhone,
    birthDate: formatDate(item.birthDate),
    educationLevel: item.educationLevel,
    preferredSchedule: item.preferredSchedule,
    trainingStartDate: formatDate(item.trainingStartDate),
    reviewNotes: item.reviewNotes ?? undefined,
    operationalData: (item.operationalData ?? undefined) as Record<string, string> | undefined,
    history: ((item.history ?? []) as Array<{ at: string; actor: string; action: string; notes?: string }>).map((event) => ({
      ...event,
      at: formatDateTime(new Date(event.at))
    }))
  };
}

function maskCpfForAudit(value?: string | null) {
  if (!value) return "CPF pendente";
  const digits = value.replace(/\D/g, "");
  if (digits.length < 2) return "***.***.***-**";
  return `***.***.***-${digits.slice(-2)}`;
}

function registrationStatusLabel(status: EmployeeRegistrationStatus) {
  const map: Record<EmployeeRegistrationStatus, string> = {
    RASCUNHO: "Rascunho",
    ENVIADO: "Enviado",
    PENDENTE_APROVACAO: "Pendente de Aprovação",
    AJUSTE_SOLICITADO: "Ajuste Solicitado",
    APROVADO: "Aprovado",
    RECUSADO: "Recusado",
    ATIVO: "Ativo",
    INATIVO: "Inativo"
  };
  return map[status];
}

function appendHistory(history: Prisma.JsonValue | null | undefined, actor: string, action: string, notes?: string) {
  const current = Array.isArray(history) ? history : [];
  return [{ at: new Date().toISOString(), actor, action, notes }, ...current] as Prisma.InputJsonArray;
}

function sensitiveData(item: EmployeeRegistrationRequest) {
  return {
    cpf: item.cpf,
    rg: item.rg,
    rgIssuer: item.rgIssuer,
    cnpj: item.cnpj,
    birthDate: item.birthDate,
    address: {
      type: item.addressType,
      name: item.addressName,
      number: item.addressNumber,
      complement: item.complement,
      neighborhood: item.neighborhood,
      city: item.city,
      stateUf: item.stateUf,
      zipCode: item.zipCode
    },
    bankData: {
      bankName: item.bankName,
      bankAgency: item.bankAgency,
      bankAccount: item.bankAccount,
      pixKey: item.pixKey,
      pixKeyType: item.pixKeyType,
      secondaryPixKey: item.secondaryPixKey,
      secondaryPixKeyType: item.secondaryPixKeyType
    },
    emergencyContactData: {
      name: item.emergencyContactName,
      phone: item.emergencyPhone,
      relationship: item.emergencyContactRelationship,
      primaryPhone: item.primaryPhone
    },
    familyData: {
      hasChildren: item.hasChildren,
      childrenCount: item.childrenCount,
      maritalStatus: item.maritalStatus,
      sex: item.sex,
      educationLevel: item.educationLevel,
      socialName: item.socialName
    }
  };
}

async function auditRegistration(tx: Prisma.TransactionClient, actorId: string, action: AuditAction, entityId: string, reason: string, previousStatus?: unknown, newStatus?: unknown) {
  await tx.auditLog.create({
    data: {
      actorId,
      action,
      entity: "EmployeeRegistrationRequest",
      entityId,
      reason,
      previousValue: previousStatus ? { status: previousStatus } : undefined,
      newValue: newStatus ? { status: newStatus } : undefined
    }
  });
}

function parseDate(value: string) {
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Data inválida: ${value}`);
  return parsed;
}

function normalizeRegistrationError(error: unknown) {
  const envIssue = databaseEnvIssue();
  if (envIssue) return envIssue;

  if (error instanceof Prisma.PrismaClientInitializationError) {
    return {
      error: "Não foi possível conectar ao banco de dados. No modo local, rode `npm run db:up` e confira DATABASE_URL.",
      type: "DB_CONNECTION_ERROR",
      fields: {}
    };
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      const target = Array.isArray(error.meta?.target) ? error.meta?.target.map(String) : [];
      return {
        error: target.includes("cpf")
          ? "Já existe um cadastro ativo ou em análise para este CPF. Se o cadastro antigo foi removido, tente enviar novamente após atualizar a página."
          : target.includes("email")
            ? "Já existe um cadastro ativo ou em análise para este e-mail."
            : "Já existe um cadastro com um dado único já utilizado.",
        type: "DUPLICATE_ERROR",
        fields: {
          ...(target.includes("cpf") ? { cpf: "Já existe um cadastro ativo ou em análise para este CPF." } : {}),
          ...(target.includes("email") ? { email: "Já existe um cadastro ativo ou em análise para este e-mail." } : {})
        }
      };
    }

    if (error.code === "P2003") {
      return {
        error: "Um vínculo obrigatório do cadastro não foi encontrado. Revise os dados ou rode o seed mínimo.",
        type: "RELATION_ERROR",
        fields: {}
      };
    }

    if (error.code === "P2023") {
      return {
        error: "Há um campo com formato inválido para o banco.",
        type: "DATABASE_VALUE_ERROR",
        fields: {}
      };
    }

    if (error.code === "P2022") {
      return {
        error: "A migration de senha do cadastro ainda não foi aplicada no banco. Rode `npx prisma migrate dev` e tente novamente.",
        type: "MIGRATION_REQUIRED",
        fields: {}
      };
    }

    if (error.code === "P2025") {
      return {
        error: "Dados obrigatórios do sistema não foram encontrados. Rode o seed mínimo e tente novamente.",
        type: "SYSTEM_SETUP_ERROR",
        fields: {}
      };
    }
  }

  if (error instanceof Error && error.message.startsWith("Data inválida")) {
    return {
      error: error.message,
      type: "VALIDATION_ERROR",
      fields: { birthDate: "Revise as datas informadas.", trainingStartDate: "Revise as datas informadas." }
    };
  }

  return {
    error: "Não foi possível salvar o cadastro no banco. Veja os detalhes técnicos no console do servidor.",
    type: "DATABASE_ERROR",
    fields: {}
  };
}

function databaseEnvIssue() {
  const localMode = process.env.USE_LOCAL_DB === "true" || process.env.APP_ENV === "local";

  if (!process.env.DATABASE_URL) {
    return {
      error: "DATABASE_URL ausente no .env. Configure a connection string do Postgres local.",
      type: "DB_ENV_ERROR",
      fields: {}
    };
  }

  try {
    const url = new URL(process.env.DATABASE_URL);
    if (!localMode && /PROJECT_REF|URL_ENCODED_PASSWORD|SUPABASE_|REGION|USER:PASSWORD|HOST/.test(process.env.DATABASE_URL)) {
      return {
        error: "DATABASE_URL ainda contém placeholders. Substitua PROJECT_REF, REGION e URL_ENCODED_PASSWORD pelos dados reais do Supabase.",
        type: "DB_ENV_ERROR",
        fields: {}
      };
    }
    if (!url.hostname || !url.username || !url.pathname || url.pathname === "/") {
      return {
        error: "DATABASE_URL está incompleta. Confira usuário, host e nome do banco.",
        type: "DB_ENV_ERROR",
        fields: {}
      };
    }
    if (!localMode && process.env.NODE_ENV !== "production" && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) {
      console.warn("[database] A aplicação está usando banco local fora do modo local.");
    }
  } catch {
    return {
      error: "DATABASE_URL inválida. Revise a connection string do Postgres local.",
      type: "DB_ENV_ERROR",
      fields: {}
    };
  }

  if (!process.env.DIRECT_URL && process.env.NODE_ENV !== "production") {
    console.warn("[database] DIRECT_URL ausente. O runtime pode funcionar, mas migrations do Prisma precisam dessa variável.");
  }

  return null;
}

function technicalMessage(error: unknown) {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return "Falha desconhecida ao salvar cadastro real";
}

function defaultShiftStart(name: string) {
  if (name === "Tarde") return "14:00";
  if (name === "Noite") return "20:00";
  if (name === "Folga") return "00:00";
  return "08:00";
}

function defaultShiftEnd(name: string) {
  if (name === "Tarde") return "20:00";
  if (name === "Noite") return "02:00";
  if (name === "Folga") return "00:00";
  return "14:00";
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("pt-BR").format(date);
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
