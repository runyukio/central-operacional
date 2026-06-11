import { AuditAction, EmployeeProfile, EmployeeRegistrationRequest, EmployeeRegistrationStatus, EmployeeSensitiveData, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

import type { Actor } from "@/lib/mock-db";
import {
  listEmployeeRegistrations as listMockRegistrations,
  recordErrorLog,
  reviewEmployeeRegistration as reviewMockRegistration,
  submitEmployeeRegistration as submitMockRegistration
} from "@/lib/mock-db";
import { mapPrismaError } from "@/lib/api-errors";
import { normalizeJobTitle } from "@/lib/job-title-normalization";
import { canApproveRegistration, normalizeRole } from "@/lib/permissions";
import { auditPermissionDenied } from "@/lib/permission-audit";
import { normalizePixKeyType, validatePixKey } from "@/lib/pix-key";
import { prisma } from "@/lib/prisma";
import { cleanShiftName, isBlockedShiftName, isSelectableShiftName, shiftLookupKey } from "@/lib/shift-display";
import type { RegistrationInput } from "@/lib/registration-validation";

const allowDemoDataFallback = process.env.ALLOW_DEMO_LOGIN === "true" || process.env.ALLOW_DEMO_DATA === "true";
const internalDefaultTeamName = "Time Inicial";
const internalDefaultScheduleType = "Não informado";
const pcdDisabilityTypeOptions = ["Física", "Auditiva", "Visual", "Intelectual", "Psicossocial", "Múltipla", "Neurodivergente", "Outra", "Prefiro não informar"] as const;
const validPcdDisabilityTypes = new Set<string>(pcdDisabilityTypeOptions);
const registrationDeleteAdminEmails = new Set(["pedro.stigliani88@gmail.com"]);

export type RegistrationReviewInput = {
  id: string;
  action: "approve" | "reject" | "request_adjustment";
  reviewNotes: string;
	  operationalData?: {
	    wbLogin: string;
	    lob: string;
	    supervisor: string;
	    shift: string;
	    workStartTime: string;
	    workEndTime: string;
	    skill?: string;
	    wave?: string;
	    roleTitle: string;
	    employeeStatus: string;
	    contractType: string;
    admissionDate: string;
    nestingStartDate: string;
    goLiveDate: string;
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
	  "genero",
	  "etnia",
	  "orientacao_sexual",
  "eh_pcd",
  "tipo_deficiencia",
  "tipo_deficiencia_outro",
  "primeiro_emprego",
  "ja_trabalhou_telemarketing",
  "onde_trabalhou_telemarketing",
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
	  "supervisor_wb_login",
  "supervisor_email",
  "supervisor_nome",
  "turno",
  "horario_entrada",
  "horario_saida",
  "skill",
  "wave",
  "status_colaborador",
  "tipo_contrato",
  "data_admissao",
  "data_inicio_nesting",
  "data_go_live",
  "data_desligamento",
  "tipo_desligamento",
  "motivo_desligamento",
  "banco",
  "agencia",
  "conta_corrente",
  "chave_pix",
  "tipo_chave_pix",
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
  changes?: string[];
  keptFields?: string[];
  action: "criar" | "atualizar" | "inativar_acesso" | "ignorar";
  status: "Válida" | "Erro" | "Alerta";
  preview: {
    name: string;
    email: string;
    cpf: string;
    wbLogin: string;
    role: string;
    lob: string;
    supervisor: string;
    skill: string;
    wave: string;
    workStartTime: string;
    workEndTime: string;
    isPcd: string;
    pcdDisabilityType: string;
    pcdDisabilityOther: string;
    createUser: boolean;
    passwordProvided: boolean;
    currentStatus?: string;
    newStatus?: string;
    userWillBeInactivated?: boolean;
    terminationDate?: string;
    pixKeyType?: string;
    pixKey?: string;
  };
};

type NormalizedEmployeeImportRow = ReturnType<typeof normalizeEmployeeImportRow>;

const importFieldLabels: Array<{ label: string; keys: string[] }> = [
  { label: "Nome", keys: ["nome"] },
  { label: "Nome social", keys: ["nome_social"] },
  { label: "E-mail", keys: ["email"] },
  { label: "CPF", keys: ["cpf"] },
  { label: "RG", keys: ["rg"] },
  { label: "CNPJ", keys: ["cnpj"] },
  { label: "Data de nascimento", keys: ["data_nascimento"] },
  { label: "Cidade", keys: ["cidade"] },
  { label: "UF", keys: ["estado_uf"] },
  { label: "Telefone", keys: ["contato_principal"] },
  { label: "Chave PIX", keys: ["chave_pix"] },
  { label: "Tipo da Chave PIX", keys: ["tipo_chave_pix"] },
  { label: "LOB", keys: ["lob"] },
  { label: "Supervisor", keys: ["supervisor_wb_login", "supervisor_email", "supervisor_nome"] },
  { label: "Turno", keys: ["turno"] },
  { label: "Horário de entrada", keys: ["horario_entrada", "entrada"] },
  { label: "Horário de saída", keys: ["horario_saida", "saida"] },
  { label: "Cargo/Função", keys: ["cargo_funcao"] },
  { label: "Skill", keys: ["skill"] },
  { label: "Wave", keys: ["wave"] },
  { label: "Status do colaborador", keys: ["status_colaborador"] },
  { label: "Tipo de contrato", keys: ["tipo_contrato"] },
  { label: "Data de admissão", keys: ["data_admissao"] },
  { label: "Data de início de Nesting", keys: ["data_inicio_nesting"] },
  { label: "Data de Go Live", keys: ["data_go_live"] },
  { label: "Data de desligamento", keys: ["data_desligamento"] },
  { label: "Etnia", keys: ["etnia"] },
  { label: "Orientação sexual", keys: ["orientacao_sexual"] },
  { label: "É PCD?", keys: ["eh_pcd"] },
  { label: "Tipo de deficiência", keys: ["tipo_deficiencia"] },
  { label: "Primeiro emprego", keys: ["primeiro_emprego"] },
  { label: "Telemarketing", keys: ["ja_trabalhou_telemarketing"] }
];

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
      email: _inputEmail,
      ...registrationData
    } = input;
    const passwordHash = await bcrypt.hash(password, 10);
    const reusableRegistration = relatedRegistrations.find(isReusableRegistration);

    const created = await prisma.$transaction(async (tx) => {
      const baseData = {
        ...registrationData,
        email,
        emergencyPhone: registrationData.emergencyPhone ?? "",
        emergencyContactName: registrationData.emergencyContactName ?? "",
        emergencyContactRelationship: registrationData.emergencyContactRelationship ?? "",
        passwordHash,
        birthDate: parseDate(birthDate),
        trainingStartDate: new Date(),
        preferredSchedule: "Não informado",
        status: "PENDENTE_APROVACAO" as const,
        submittedAt: new Date(),
        reviewedById: null,
        reviewedAt: null,
        reviewNotes: null,
        operationalData: Prisma.JsonNull,
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
    return allowDemoDataFallback
      ? submitMockRegistration({
          ...input,
          emergencyPhone: input.emergencyPhone ?? "",
          emergencyContactName: input.emergencyContactName ?? "",
          emergencyContactRelationship: input.emergencyContactRelationship ?? "",
          trainingStartDate: new Date().toISOString().slice(0, 10),
          preferredSchedule: "Não informado"
        })
      : normalized;
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
    let hierarchyUpdates = 0;
    let accessInactivated = 0;
    const supervisorEmails = unique(normalizedValidRows.map((row) => row.supervisorEmail));
    const supervisorNames = unique(normalizedValidRows.map((row) => row.supervisorName));
    const employeeProfileCandidates = await findEmployeeProfilesByWbLoginBatch(unique([
        ...normalizedValidRows.map((row) => normalizeWbLoginForEmployeeImport(row.wbLogin)),
        ...normalizedValidRows.map((row) => normalizeWbLoginForEmployeeImport(row.supervisorWbLogin))
      ]));
    const existingProfilesByWb = new Map(employeeProfileCandidates.map((employee) => [normalizeWbLoginForEmployeeImport(employee.wbLogin), employee]));
    const existingSensitiveData = employeeProfileCandidates.length
      ? await prisma.employeeSensitiveData.findMany({ where: { employeeId: { in: employeeProfileCandidates.map((employee) => employee.id) } } })
      : [];
    const sensitiveByEmployeeId = new Map(existingSensitiveData.map((item) => [item.employeeId, item]));
    const supervisorsByEmail = supervisorEmails.length
      ? await prisma.employeeProfile.findMany({ where: { deletedAt: null, user: { email: { in: supervisorEmails } } }, select: { id: true, fullName: true, wbLogin: true, user: { select: { email: true } } } })
      : [];
    const supervisorsByName = supervisorNames.length
      ? await prisma.employeeProfile.findMany({ where: { deletedAt: null, OR: supervisorNames.map((name) => ({ fullName: { equals: name, mode: "insensitive" as const } })) }, select: { id: true, fullName: true, wbLogin: true } })
      : [];
    const supervisorByEmail = buildEmployeeByEmailMap(supervisorsByEmail);
    const supervisorsByNameKey = new Map<string, typeof supervisorsByName>();
    supervisorsByName.forEach((employee) => {
      const key = normalizeLookupKey(employee.fullName);
      supervisorsByNameKey.set(key, [...(supervisorsByNameKey.get(key) ?? []), employee]);
    });

    for (let rowIndex = 0; rowIndex < normalizedValidRows.length; rowIndex += 1) {
      const row = normalizedValidRows[rowIndex];
      const rawRow = validRows[rowIndex] ?? {};
      const existingByWb = existingProfilesByWb.get(normalizeWbLoginForEmployeeImport(row.wbLogin)) ?? null;
      const isExistingEmployeeImport = Boolean(existingByWb);
      const role = row.roleName ? await prisma.role.findUniqueOrThrow({ where: { name: row.roleName } }) : null;
      if (!role && (row.createUser || !isExistingEmployeeImport)) throw new Error(`Linha ${rowIndex + 1}: Role/Permissão obrigatória.`);
      const lob = row.lob ? await prisma.lob.findUniqueOrThrow({ where: { name: row.lob } }) : null;
      if (!lob && !isExistingEmployeeImport) throw new Error(`Linha ${rowIndex + 1}: LOB obrigatória.`);
      const shift = row.shift
        ? await prisma.shift.findFirstOrThrow({ where: { OR: [{ name: row.shift }, { name: { startsWith: `${row.shift} (` } }] } })
        : isExistingEmployeeImport
          ? null
          : fallbackShift!;
      const supervisor = resolveImportSupervisor(row, existingProfilesByWb, supervisorByEmail, supervisorsByNameKey).employee;
      if (supervisor && existingByWb && await wouldCreateImportSupervisorCycle(existingByWb.id, supervisor.id)) {
        throw new Error(`Linha ${rowIndex + 1}: essa alteração criaria um ciclo de supervisor.`);
      }
      const currentSensitiveData = existingByWb ? sensitiveByEmployeeId.get(existingByWb.id) ?? null : null;
      const importDateFallback = new Date();
      const birthDate = row.birthDate ?? currentSensitiveData?.birthDate ?? row.admissionDate ?? row.trainingStartDate ?? existingByWb?.admissionDate ?? importDateFallback;
      const trainingStartDate = row.trainingStartDate ?? row.admissionDate ?? existingByWb?.trainingStartDate ?? existingByWb?.admissionDate ?? importDateFallback;
      const admissionDate = row.admissionDate ?? row.trainingStartDate ?? existingByWb?.admissionDate ?? importDateFallback;
      const internalTeamName = row.teamName || (supervisor?.fullName ? `Time ${supervisor.fullName}` : internalDefaultTeamName);
      const team = lob
        ? await prisma.team.upsert({
          where: { name_lobId: { name: internalTeamName, lobId: lob.id } },
          update: { supervisorId: supervisor?.id },
          create: { name: internalTeamName, lobId: lob.id, supervisorId: supervisor?.id }
        })
        : null;

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
          ethnicity: row.ethnicity || null,
          sexualOrientation: row.sexualOrientation || null,
          isPcd: row.isPcd || null,
          pcdDisabilityType: row.isPcd === "Sim" ? row.pcdDisabilityType || null : null,
          pcdDisabilityOther: row.isPcd === "Sim" && row.pcdDisabilityType === "Outra" ? row.pcdDisabilityOther || null : null,
          firstJob: row.firstJob || null,
          hasTelemarketingExperience: row.hasTelemarketingExperience || null,
          telemarketingWhere: row.telemarketingWhere || null,
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
            supervisorInformado: row.supervisorName || row.supervisorEmail || row.supervisorWbLogin,
            shift: row.shift,
            roleTitle: row.roleTitle,
            employeeStatus: row.employeeStatus,
            cpfPending: !row.cpf,
            preferredSchedule: row.preferredSchedule,
	            supervisorWbLogin: row.supervisorWbLogin,
            supervisorEmail: row.supervisorEmail,
            supervisorName: row.supervisorName,
            supervisor: supervisor?.fullName ?? null,
            skill: row.skill,
            wave: row.wave,
	            contractType: row.contractType,
            admissionDate: admissionDate.toISOString(),
            trainingStartDate: trainingStartDate.toISOString(),
            nestingStartDate: row.nestingStartDate?.toISOString() ?? null,
            goLiveDate: row.goLiveDate?.toISOString() ?? null,
            terminationDate: row.terminationDate?.toISOString() ?? null,
            terminationType: row.terminationType,
            terminationReason: row.terminationReason
          } as Prisma.InputJsonObject,
          history: [{ at: new Date().toISOString(), actor: actor.name, action: "Cadastro importado e aprovado via Excel", notes: batchId }] as Prisma.InputJsonArray,
          deletedAt: null
        };

        const registration = existingRegistration
          ? await prisma.employeeRegistrationRequest.update({
            where: { id: existingRegistration.id },
            data: buildRegistrationImportUpdateData(rawRow, row, {
              birthDate,
              trainingStartDate,
              admissionDate,
              batchId,
              actorName: actor.name,
              reviewerId: permission.user.id,
              existingOperationalData: existingRegistration.operationalData,
              existingHistory: existingRegistration.history,
              supervisorName: supervisor?.fullName ?? null
            })
          })
          : isExistingEmployeeImport
            ? null
            : await prisma.employeeRegistrationRequest.create({ data: registrationData });

        const shouldInactivateAccess = isAccessInactiveEmployeeStatus(row.employeeStatus);
        const accessDisabledAt = shouldInactivateAccess ? new Date() : null;
        let userId: string | undefined;
        if (row.createUser) {
          const existingUser = row.email ? await prisma.user.findUnique({ where: { email: row.email } }) : null;
          const user = existingUser
            ? await prisma.user.update({
              where: { id: existingUser.id },
              data: {
                name: row.name,
                passwordHash: passwordHash!,
                roleId: role!.id,
                status: shouldInactivateAccess ? "INACTIVE" : "ACTIVE",
                mustChangePassword: !shouldInactivateAccess,
                temporaryPassword: !shouldInactivateAccess,
                lastPasswordResetAt: new Date(),
                passwordResetById: permission.user.id,
                deletedAt: accessDisabledAt
              }
            })
            : await prisma.user.create({
              data: {
                email: row.email,
                name: row.name,
                passwordHash: passwordHash!,
                roleId: role!.id,
                status: shouldInactivateAccess ? "INACTIVE" : "ACTIVE",
                mustChangePassword: !shouldInactivateAccess,
                temporaryPassword: !shouldInactivateAccess,
                lastPasswordResetAt: new Date(),
                passwordResetById: permission.user.id,
                deletedAt: accessDisabledAt
              }
            });
          userId = user.id;
          usuariosCriados += existingUser ? 0 : 1;
        }

        const existingByUser = userId ? await prisma.employeeProfile.findUnique({ where: { userId } }) : null;
        const employeeId = existingByWb?.id ?? existingByUser?.id;
        const existingEmployeeForUpdate = existingByWb ?? existingByUser ?? null;
        if (existingEmployeeForUpdate && ((row.skill && row.skill !== (existingEmployeeForUpdate.skill ?? "")) || (row.wave && row.wave !== (existingEmployeeForUpdate.wave ?? "")))) {
          skillWaveUpdates += 1;
        }
        if (supervisor && existingEmployeeForUpdate?.supervisorId !== supervisor.id) hierarchyUpdates += 1;
        const employeeUpdateData = buildEmployeeImportUpdateData(rawRow, row, {
          userId,
          lobId: lob?.id,
          teamId: team?.id,
          supervisorId: supervisor?.id,
          shiftId: shift?.id
        });
        const employee = employeeId
          ? Object.keys(employeeUpdateData).length
            ? await prisma.employeeProfile.update({
            where: { id: employeeId },
            data: employeeUpdateData
            })
            : existingEmployeeForUpdate!
          : await prisma.employeeProfile.create({
            data: {
              userId,
              wbLogin: row.wbLogin,
              fullName: row.name,
              socialName: row.socialName || null,
              roleTitle: row.roleTitle,
              admissionDate,
	              scheduleType: internalDefaultScheduleType,
              operationalStatus: row.employeeStatus,
              lobId: lob!.id,
              teamId: team!.id,
              supervisorId: supervisor?.id,
              shiftId: shift!.id,
              workStartTime: row.workStartTime || null,
              workEndTime: row.workEndTime || null,
              skill: row.skill || null,
              wave: row.wave || null,
              trainingStartDate,
              terminationDate: row.terminationDate,
              terminationType: row.terminationType || null,
              terminationReason: row.terminationReason || null,
              ethnicity: row.ethnicity || null,
              sexualOrientation: row.sexualOrientation || null,
              isPcd: row.isPcd || null,
              pcdDisabilityType: row.isPcd === "Sim" ? row.pcdDisabilityType || null : null,
              pcdDisabilityOther: row.isPcd === "Sim" && row.pcdDisabilityType === "Outra" ? row.pcdDisabilityOther || null : null,
              firstJob: row.firstJob || null,
              hasTelemarketingExperience: row.hasTelemarketingExperience || null,
              telemarketingWhere: row.telemarketingWhere || null,
              nestingStartDate: row.nestingStartDate,
              goLiveDate: row.goLiveDate,
              contractType: row.contractType || null,
              siteOperation: null,
              internalNotes: row.notes || null,
              primaryPhone: row.primaryPhone || null,
              city: row.city || null,
              stateUf: row.stateUf || null,
              preferredSchedule: row.preferredSchedule || null,
              pixKey: row.pixKey || null,
              pixKeyType: row.pixKeyType || null,
              deletedAt: null
            }
          });
        if (!employeeId) colaboradoresCriados += 1;
        else registrosAtualizados += 1;

        if (shouldInactivateAccess && employee.userId) {
          await prisma.user.update({
            where: { id: employee.userId },
            data: {
              status: "INACTIVE",
              mustChangePassword: false,
              temporaryPassword: false,
              deletedAt: accessDisabledAt ?? new Date()
            }
          });
          accessInactivated += 1;
        }

        const currentEmployeeSensitiveData = currentSensitiveData
          ?? sensitiveByEmployeeId.get(employee.id)
          ?? (employeeId ? await prisma.employeeSensitiveData.findUnique({ where: { employeeId: employee.id } }) : null);
        if (currentEmployeeSensitiveData) {
          const sensitiveUpdateData = buildSensitiveImportUpdateData(rawRow, row, birthDate, currentEmployeeSensitiveData);
          if (Object.keys(sensitiveUpdateData).length) {
            await prisma.employeeSensitiveData.update({
              where: { employeeId: employee.id },
              data: sensitiveUpdateData
            });
          }
        } else {
          await prisma.employeeSensitiveData.create({
            data: { employeeId: employee.id, ...sensitiveDataFromImport(row, birthDate) }
          });
        }

        if (registration) {
          await prisma.employeeRegistrationRequest.update({
            where: { id: registration.id },
            data: {
              ...(userId ? { createdUserId: userId } : {}),
              createdEmployeeProfileId: employee.id
            }
          });
        }
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
            skillWaveUpdates,
            hierarchyUpdates,
            accessInactivated
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
        hierarchyUpdates,
        accessInactivated,
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
    const actorRole = normalizeRole(actor.role);
    if (!reviewer || !canApproveRegistration({ role: actor.role, status: reviewer.status })) {
      const reason = actorRole === "SUPERVISOR" ? "Supervisor não possui permissão para aprovar ou editar cadastros." : "Sem permissão para revisar cadastro.";
      await auditPermissionDenied(actor, { action: "REGISTRATION_REVIEW", entity: "EmployeeRegistrationRequest", reason, entityId: input.id });
      return { error: reason };
    }

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
    if (input.action === "approve" && input.operationalData) {
      const requiredFields: Array<[keyof NonNullable<RegistrationReviewInput["operationalData"]>, string]> = [
        ["lob", "LOB"],
        ["shift", "Turno"],
        ["workStartTime", "Horário de entrada"],
        ["workEndTime", "Horário de saída"],
        ["wave", "Wave"],
        ["roleTitle", "Cargo/Função"],
        ["admissionDate", "Data de admissão"],
        ["nestingStartDate", "Data de início de Nesting"],
        ["goLiveDate", "Data de Go Live"]
      ];
      const missing = requiredFields.filter(([field]) => !String(input.operationalData?.[field] ?? "").trim()).map(([, label]) => label);
      if (missing.length) return { error: `Preencha os campos obrigatórios da aprovação: ${missing.join(", ")}.` };
      const invalidWorkStart = normalizeWorkTime(input.operationalData.workStartTime);
      if (!invalidWorkStart) return { error: "Horário de entrada inválido.", fields: { workStartTime: "Horário de entrada inválido." } };
      const invalidWorkEnd = normalizeWorkTime(input.operationalData.workEndTime);
      if (!invalidWorkEnd) return { error: "Horário de saída inválido.", fields: { workEndTime: "Horário de saída inválido." } };
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

      const op = {
        ...input.operationalData!,
        lob: normalizeLobName(input.operationalData!.lob),
        shift: cleanShiftName(input.operationalData!.shift) || "Manhã",
        workStartTime: normalizeWorkTime(input.operationalData!.workStartTime) ?? "",
        workEndTime: normalizeWorkTime(input.operationalData!.workEndTime) ?? ""
      };
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
	      const internalTeamName = supervisor?.fullName ? `Time ${supervisor.fullName}` : internalDefaultTeamName;
	      const team = await tx.team.upsert({
	        where: { name_lobId: { name: internalTeamName, lobId: lob.id } },
	        update: { supervisorId: supervisor?.id },
	        create: { name: internalTeamName, lobId: lob.id, supervisorId: supervisor?.id }
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
      const existingProfile = profileByWb ?? profileByUser;
      const operationalProfileData = cleanPatchPayload({
        userId: user.id,
        wbLogin: op.wbLogin,
        roleTitle: normalizeJobTitle(op.roleTitle),
        admissionDate: parseDate(op.admissionDate),
        trainingStartDate: parseDate(op.admissionDate),
        nestingStartDate: parseDate(op.nestingStartDate),
        goLiveDate: parseDate(op.goLiveDate),
        workStartTime: op.workStartTime,
        workEndTime: op.workEndTime,
        scheduleType: internalDefaultScheduleType,
        operationalStatus: approvedEmployeeStatus,
        contractType: op.contractType?.trim(),
        internalNotes: op.internalNotes?.trim(),
        lobId: lob.id,
        teamId: team.id,
        supervisorId: supervisor?.id,
        shiftId: shift.id,
        skill: op.skill?.trim(),
        wave: op.wave?.trim()
      });
      const employee = existingProfile
        ? await tx.employeeProfile.update({
            where: { id: existingProfile.id },
            data: {
              ...missingProfileRegistrationData(existingProfile, existing),
              ...operationalProfileData
            }
          })
        : await tx.employeeProfile.create({
            data: {
              ...profileRegistrationCreateData(existing),
              ...operationalProfileData,
              userId: user.id,
              wbLogin: op.wbLogin,
              roleTitle: normalizeJobTitle(op.roleTitle),
              admissionDate: parseDate(op.admissionDate),
              trainingStartDate: parseDate(op.admissionDate),
              nestingStartDate: parseDate(op.nestingStartDate),
              goLiveDate: parseDate(op.goLiveDate),
              workStartTime: op.workStartTime,
              workEndTime: op.workEndTime,
	              scheduleType: internalDefaultScheduleType,
              operationalStatus: approvedEmployeeStatus,
              lobId: lob.id,
              teamId: team.id,
              supervisorId: supervisor?.id,
              shiftId: shift.id,
              skill: op.skill?.trim() || null,
              wave: op.wave?.trim() || null
            }
          });

      const currentSensitiveData = await tx.employeeSensitiveData.findUnique({ where: { employeeId: employee.id } });
      if (currentSensitiveData) {
        await tx.employeeSensitiveData.update({
          where: { employeeId: employee.id },
          data: mergeSensitiveRegistrationData(currentSensitiveData, existing)
        });
      } else {
        await tx.employeeSensitiveData.create({
          data: { employeeId: employee.id, ...sensitiveData(existing) }
        });
      }

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
    const isRegistrationDeleteAdmin = role === "ADMIN" || registrationDeleteAdminEmails.has(String(actor.email ?? "").trim().toLowerCase());
    const hasDeletePermission = reviewer.permissions.some((item) =>
      item.granted && ["CADASTRO_EXCLUIR", "cadastros.excluir", "employee_registration.delete"].includes(item.permission.key)
    );
    if (!isRegistrationDeleteAdmin && !hasDeletePermission) {
      const reason = role === "SUPERVISOR" ? "Supervisor não possui permissão para aprovar ou editar cadastros." : "Apenas Admin ou usuários com permissão específica podem excluir cadastros.";
      await auditPermissionDenied(actor, { action: "REGISTRATION_DELETE", entity: "EmployeeRegistrationRequest", reason, entityId: id });
      return { error: reason };
    }

    const existing = await prisma.employeeRegistrationRequest.findFirst({ where: { id, deletedAt: null } });
    if (!existing) return { error: "Cadastro não encontrado." };

    const isLinked = Boolean(existing.createdUserId || existing.createdEmployeeProfileId || ["APROVADO", "ATIVO"].includes(existing.status));
    if (isLinked && !isRegistrationDeleteAdmin) return { error: "Cadastros aprovados só podem ser inativados por Admin." };

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
  const actorRole = normalizeRole(actor.role);
  if (!canApproveRegistration({ role: actor.role, status: user.status })) {
    const reason = actorRole === "SUPERVISOR" ? "Supervisor não possui permissão para aprovar ou editar cadastros." : "Sem permissão para importar colaboradores.";
    await auditPermissionDenied(actor, { action: "EMPLOYEE_IMPORT", entity: "EmployeeRegistrationRequest", reason });
    return { error: reason };
  }
  return { user };
}

async function validateEmployeeImportRows(rows: EmployeeImportRow[]): Promise<EmployeeImportValidation[]> {
  const normalizedRows = rows.map((row) => normalizeEmployeeImportRow(row));
  const seenCpf = new Set<string>();
  const seenEmail = new Set<string>();
  const seenWb = new Set<string>();
  const unique = (values: string[]) => [...new Set(values.filter(Boolean))];
  const wbLogins = unique(normalizedRows.map((row) => normalizeWbLoginForEmployeeImport(row.wbLogin)));
  const supervisorWbLogins = unique(normalizedRows.map((row) => normalizeWbLoginForEmployeeImport(row.supervisorWbLogin)));
  const supervisorEmails = unique(normalizedRows.map((row) => row.supervisorEmail));
  const supervisorNames = unique(normalizedRows.map((row) => row.supervisorName));
  const cpfs = unique(normalizedRows.map((row) => row.cpf ?? ""));
  const emails = unique(normalizedRows.map((row) => row.email));
  const [roles, lobs, shifts, employeesByWb, supervisorsByEmail, supervisorsByName, sensitiveMatches, activeUsers] = await Promise.all([
    prisma.role.findMany({ select: { name: true } }),
    prisma.lob.findMany({ select: { name: true } }),
    prisma.shift.findMany({ select: { name: true } }),
    findEmployeeProfilesByWbLoginBatch(unique([...wbLogins, ...supervisorWbLogins])),
    supervisorEmails.length
      ? prisma.employeeProfile.findMany({ where: { deletedAt: null, user: { email: { in: supervisorEmails } } }, select: { id: true, fullName: true, wbLogin: true, user: { select: { email: true } } } })
      : Promise.resolve([]),
    supervisorNames.length
      ? prisma.employeeProfile.findMany({ where: { deletedAt: null, OR: supervisorNames.map((name) => ({ fullName: { equals: name, mode: "insensitive" as const } })) }, select: { id: true, fullName: true, wbLogin: true } })
      : Promise.resolve([]),
    cpfs.length ? prisma.employeeSensitiveData.findMany({ where: { cpf: { in: cpfs } }, select: { cpf: true, employeeId: true } }) : Promise.resolve([]),
    emails.length ? prisma.user.findMany({ where: { email: { in: emails }, status: "ACTIVE", deletedAt: null }, select: { id: true, email: true } }) : Promise.resolve([])
  ]);
  const validRoles = new Set(roles.map((role) => role.name));
  const validLobs = new Set(lobs.map((lob) => lob.name.toUpperCase()));
  const validShifts = new Set(shifts
    .filter((shift) => isSelectableShiftName(shift.name))
    .flatMap((shift) => [normalizeLookupKey(shift.name), normalizeLookupKey(cleanShiftName(shift.name))]));
  const employeeByWb = new Map(employeesByWb.map((employee) => [normalizeWbLoginForEmployeeImport(employee.wbLogin), employee]));
  const supervisorByEmail = buildEmployeeByEmailMap(supervisorsByEmail);
  const supervisorsByNameKey = new Map<string, typeof supervisorsByName>();
  supervisorsByName.forEach((employee) => {
    const key = normalizeLookupKey(employee.fullName);
    supervisorsByNameKey.set(key, [...(supervisorsByNameKey.get(key) ?? []), employee]);
  });
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
    const rawRow = rows[index] ?? {};
    const row = normalizedRows[index];
    const errors: string[] = [];
    const warnings: string[] = [];
    const normalizedRowWbLogin = normalizeWbLoginForEmployeeImport(row.wbLogin);
    const activeByWb = normalizedRowWbLogin ? employeeByWb.get(normalizedRowWbLogin) ?? null : null;
    const isExistingEmployeeImport = Boolean(activeByWb);

    if (!row.wbLogin) errors.push("WB/Login obrigatório.");
    if (!isExistingEmployeeImport && !row.name) errors.push("Nome obrigatório.");
    if (!isExistingEmployeeImport && !row.roleTitle) errors.push("Cargo/Função obrigatório.");
    if ((row.createUser || !isExistingEmployeeImport) && !text(rawRow.role_permissao)) errors.push("Role/Permissão obrigatória.");
    if (!isExistingEmployeeImport && !row.lob) errors.push("LOB obrigatória.");
    if (!isExistingEmployeeImport && !row.employeeStatus) errors.push("Status do colaborador obrigatório.");
    if (!isExistingEmployeeImport && !row.isPcd) errors.push("É PCD? obrigatório.");
    if (hasImportValue(rawRow.eh_pcd) && !row.isPcd) errors.push("É PCD? inválido. Use Sim, Não ou Prefiro não informar.");
    if (row.isPcd === "Sim" && !row.pcdDisabilityType) errors.push("Tipo de deficiência é obrigatório quando PCD for Sim.");
    if (row.pcdDisabilityType && !validPcdDisabilityTypes.has(row.pcdDisabilityType)) errors.push("Tipo de deficiência inválido.");
    if (row.isPcd === "Sim" && row.pcdDisabilityType === "Outra" && !row.pcdDisabilityOther) errors.push("Especifique o tipo de deficiência.");
    if (!isExistingEmployeeImport && !hasImportValue(rawRow.criar_usuario)) errors.push("criar_usuario obrigatório.");
    if (row.lob && text(rawRow.lob).toLowerCase() === "todos") errors.push("Todos é opção de filtro. Para atuação transversal use a LOB real ALL.");
    if (row.lob && !validLobs.has(row.lob.toUpperCase())) errors.push(`LOB ${row.lob} não existe em Configurações.`);
    if (row.shift && isBlockedShiftName(row.shift)) {
      const blockedKey = shiftLookupKey(cleanShiftName(row.shift));
      errors.push(blockedKey === "PLANTAO" ? "Plantão não é um turno ativo." : "Férias deve ser usada como status de cronograma, não como turno.");
    } else if (row.shift && (!isSelectableShiftName(row.shift) || !validShifts.has(normalizeLookupKey(cleanShiftName(row.shift))))) errors.push(`Turno ${row.shift} não existe em Configurações.`);
    if (row.cpf && !isCpfFormat(row.cpf)) errors.push("CPF inválido.");
    if (!isExistingEmployeeImport && !row.cpf) warnings.push("CPF pendente: o colaborador será importado com cadastro incompleto para complemento posterior.");
    if (row.createUser && !row.name) errors.push("Nome obrigatório quando criar_usuario = sim.");
    if (row.createUser && !row.email) errors.push("E-mail obrigatório quando criar_usuario = sim.");
    if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) errors.push("E-mail inválido.");
    const pixKeyProvided = hasImportValue(rawRow.chave_pix);
    const pixKeyTypeProvided = hasImportValue(rawRow.tipo_chave_pix);
    if (!isExistingEmployeeImport && !pixKeyTypeProvided) errors.push("Tipo da Chave PIX é obrigatório.");
    if (!isExistingEmployeeImport && !pixKeyProvided) errors.push("Chave PIX é obrigatória.");
    if (isExistingEmployeeImport && pixKeyProvided !== pixKeyTypeProvided) {
      warnings.push("Tipo da Chave PIX e Chave PIX precisam estar preenchidos juntos; valor atual será mantido.");
    }
    if (pixKeyProvided && pixKeyTypeProvided) {
      const pixValidation = validatePixKey(row.pixKeyType, row.pixKey);
      if (!pixValidation.valid) errors.push(pixValidation.message ?? "Chave PIX inválida.");
    }
    if (row.roleName && !validRoles.has(row.roleName)) errors.push(`Role/permissão inválida: ${row.roleName}.`);
    if (hasImportValue(rawRow.data_nascimento) && !row.birthDate) errors.push("Data de nascimento inválida.");
    if (hasImportValue(rawRow.data_admissao) && !row.admissionDate) errors.push("Data de admissão inválida.");
    if (hasImportValue(rawRow.data_inicio_treinamento) && !row.trainingStartDate) errors.push("Data de início do treinamento inválida.");
    if (hasImportValue(rawRow.data_inicio_nesting) && !row.nestingStartDate) errors.push("Data de início de Nesting inválida.");
    if (hasImportValue(rawRow.data_go_live) && !row.goLiveDate) errors.push("Data de Go Live inválida.");
    if (hasImportValue(rawRow.data_desligamento) && !row.terminationDate) errors.push("Data de desligamento inválida.");
    if (hasImportValue(rawRow.tipo_desligamento) && !row.terminationType) errors.push("Tipo de desligamento inválido. Use Voluntário ou Involuntário.");
    if (hasAnyImportValue(rawRow, ["horario_entrada", "entrada"]) && !row.workStartTime) errors.push("Horário de entrada inválido.");
    if (hasAnyImportValue(rawRow, ["horario_saida", "saida"]) && !row.workEndTime) errors.push("Horário de saída inválido.");
    if (hasAnyImportValue(rawRow, ["status_colaborador"]) && isOperationalTerminationStatus(row.employeeStatus) && !row.terminationDate && !activeByWb?.terminationDate) warnings.push("Colaborador marcado como Desligado sem data de desligamento.");
    if (hasAnyImportValue(rawRow, ["status_colaborador"]) && isTrainingTerminationStatus(row.employeeStatus) && !row.terminationDate && !activeByWb?.terminationDate) warnings.push("Colaborador marcado como Desligado em Treinamento sem data de desligamento.");
    if (row.terminationDate && hasAnyImportValue(rawRow, ["status_colaborador"]) && !isAccessInactiveEmployeeStatus(row.employeeStatus)) warnings.push("Data de desligamento preenchida, mas status_colaborador não está Desligado, Desligado em Treinamento, Inativo ou Desativado.");
    if (hasAnyImportValue(rawRow, ["status_colaborador"]) && isAccessInactiveEmployeeStatus(row.employeeStatus)) warnings.push("Acesso vinculado será inativado e o histórico será preservado.");
    if (row.stateUf && !/^[A-Z]{2}$/.test(row.stateUf)) errors.push("Estado UF deve ter 2 letras.");
    if (row.zipCode && !/^\d{5}-?\d{3}$/.test(row.zipCode)) warnings.push("CEP fora do padrão 00000-000.");
    if (row.primaryPhone && !/^\d{2}\s?\d{4,5}-?\d{4}$/.test(row.primaryPhone.replace(/[()]/g, ""))) warnings.push("Contato principal fora do padrão brasileiro.");
    if (row.createUser && !row.temporaryPassword) errors.push("Senha temporária obrigatória quando criar_usuario = sim.");
    if (row.createUser && row.temporaryPassword && row.temporaryPassword.length < 8) errors.push("Senha temporária deve ter pelo menos 8 caracteres.");

    if (row.cpf && seenCpf.has(row.cpf)) errors.push("CPF duplicado dentro do arquivo.");
    if (row.email && seenEmail.has(row.email)) errors.push("E-mail duplicado dentro do arquivo.");
    if (normalizedRowWbLogin && seenWb.has(normalizedRowWbLogin)) errors.push("WB/Login duplicado dentro do arquivo.");
    if (row.cpf) seenCpf.add(row.cpf);
    if (row.email) seenEmail.add(row.email);
    if (normalizedRowWbLogin) seenWb.add(normalizedRowWbLogin);

    if (activeByWb) {
      warnings.push("WB/Login existente: o colaborador será atualizado.");
      if (row.skill && row.skill !== (activeByWb.skill ?? "")) warnings.push(`Skill será atualizada de ${activeByWb.skill || "vazio"} para ${row.skill}.`);
      if (row.wave && row.wave !== (activeByWb.wave ?? "")) warnings.push(`Wave será atualizada de ${activeByWb.wave || "vazio"} para ${row.wave}.`);
      if (row.workStartTime && row.workStartTime !== (activeByWb.workStartTime ?? "")) warnings.push(`Horário de entrada será atualizado de ${activeByWb.workStartTime || "vazio"} para ${row.workStartTime}.`);
      if (row.workEndTime && row.workEndTime !== (activeByWb.workEndTime ?? "")) warnings.push(`Horário de saída será atualizado de ${activeByWb.workEndTime || "vazio"} para ${row.workEndTime}.`);
    } else {
      if (!row.workStartTime) errors.push("Horário de entrada é obrigatório.");
      if (!row.workEndTime) errors.push("Horário de saída é obrigatório.");
    }
    const activeByCpf = row.cpf ? activeEmployeeByCpfMap.get(row.cpf) ?? null : null;
    if (activeByCpf && activeByCpf.id !== activeByWb?.id) errors.push("Já existe colaborador ativo com este CPF.");
    const activeUser = row.email ? activeUserByEmail.get(row.email) ?? null : null;
    if (activeUser && activeUser.id !== activeByWb?.userId) errors.push("Já existe usuário ativo com este e-mail.");
    const supervisor = resolveImportSupervisor(row, employeeByWb, supervisorByEmail, supervisorsByNameKey);
    if (row.supervisorWbLogin || row.supervisorEmail || row.supervisorName) {
      if (!supervisor.employee) errors.push(supervisor.error ?? "Supervisor informado não encontrado.");
      if (supervisor.employee && normalizedRowWbLogin && normalizeWbLoginForEmployeeImport(supervisor.employee.wbLogin) === normalizedRowWbLogin) {
        errors.push("O colaborador não pode ser supervisor de si mesmo.");
      }
      if (supervisor.employee && activeByWb?.supervisorId && activeByWb.supervisorId !== supervisor.employee.id) {
        warnings.push(`Supervisor será atualizado para ${supervisor.employee.fullName}.`);
      }
    }

    const willInactivateUser = isAccessInactiveEmployeeStatus(row.employeeStatus);
    const keptFields = activeByWb ? getEmptyImportedFieldLabels(rawRow) : [];
    const changes = activeByWb ? buildEmployeeImportChangeLabels(rawRow, row, activeByWb, supervisor.employee ?? null) : [];
    if (keptFields.length) warnings.push(`Campos vazios serão mantidos: ${keptFields.slice(0, 8).join(", ")}${keptFields.length > 8 ? "..." : ""}.`);
    validations.push({
      rowNumber: index + 1,
      errors,
      warnings,
      changes,
      keptFields,
      action: errors.length ? "ignorar" : willInactivateUser ? "inativar_acesso" : activeByWb ? "atualizar" : "criar",
      status: errors.length ? "Erro" : warnings.length ? "Alerta" : "Válida",
      preview: {
        name: row.name,
        email: row.email,
        cpf: maskCpfForAudit(row.cpf),
        wbLogin: row.wbLogin,
        role: row.roleName,
        lob: row.lob,
        supervisor: supervisor.employee?.fullName ?? row.supervisorWbLogin ?? row.supervisorEmail ?? row.supervisorName,
        skill: row.skill,
        wave: row.wave,
        workStartTime: row.workStartTime ?? "",
        workEndTime: row.workEndTime ?? "",
        isPcd: row.isPcd,
        pcdDisabilityType: row.pcdDisabilityType,
        pcdDisabilityOther: row.pcdDisabilityOther,
        createUser: row.createUser,
        passwordProvided: Boolean(row.temporaryPassword),
        currentStatus: activeByWb?.operationalStatus ?? "",
        newStatus: row.employeeStatus,
        userWillBeInactivated: willInactivateUser,
        terminationDate: row.terminationDate ? row.terminationDate.toISOString().slice(0, 10) : "",
        pixKeyType: row.pixKeyType,
        pixKey: row.pixKey
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
  const pixKeyType = normalizePixKeyType(text(raw.tipo_chave_pix));
  const pixKey = text(raw.chave_pix);
  const pixValidation = pixKeyType || pixKey ? validatePixKey(pixKeyType, pixKey) : null;
  return {
    cnpj: text(raw.cnpj),
    name: text(raw.nome),
    socialName: text(raw.nome_social),
    email,
    cpf,
    rg: text(raw.rg),
    rgIssuer: text(raw.orgao_expedidor_uf),
    birthDate: parseImportDate(raw.data_nascimento),
    sex: text(raw.genero) || text(raw.sexo) || "Não informado",
    ethnicity: text(raw.etnia),
    sexualOrientation: text(raw.orientacao_sexual),
    isPcd: normalizeYesNoPrefer(raw.eh_pcd),
    pcdDisabilityType: normalizePcdDisabilityType(raw.tipo_deficiencia),
    pcdDisabilityOther: text(raw.tipo_deficiencia_outro),
    firstJob: text(raw.primeiro_emprego),
    hasTelemarketingExperience: text(raw.ja_trabalhou_telemarketing),
    telemarketingWhere: text(raw.onde_trabalhou_telemarketing),
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
    roleTitle: normalizeJobTitle(text(raw.cargo_funcao)),
    roleName,
    lob: normalizeLobName(raw.lob),
	    teamName: "",
    supervisorWbLogin: text(raw.supervisor_wb_login) || text(raw.gestor_wb_login) || text(raw.manager_wb_login) || text(raw.superior_wb_login) || text(raw.superior_hierarquico_wb_login),
    supervisorEmail: (text(raw.supervisor_email) || text(raw.gestor_email) || text(raw.manager_email) || text(raw.superior_email) || text(raw.superior_hierarquico_email)).toLowerCase(),
    supervisorName: text(raw.supervisor_nome) || text(raw.gestor_nome) || text(raw.manager_name) || text(raw.superior_nome) || text(raw.superior_hierarquico_nome),
    shift: normalizeShiftName(raw.turno),
    workStartTime: normalizeWorkTime(raw.horario_entrada ?? raw.entrada),
    workEndTime: normalizeWorkTime(raw.horario_saida ?? raw.saida),
    skill: text(raw.skill),
    wave: text(raw.wave),
	    scheduleType: internalDefaultScheduleType,
    employeeStatus: normalizeEmployeeStatus(raw.status_colaborador),
    contractType: normalizeContractType(raw.tipo_contrato),
    admissionDate: parseImportDate(raw.data_admissao),
    trainingStartDate: parseImportDate(raw.data_inicio_treinamento) ?? parseImportDate(raw.data_admissao),
    nestingStartDate: parseImportDate(raw.data_inicio_nesting),
    goLiveDate: parseImportDate(raw.data_go_live),
    terminationDate: parseImportDate(raw.data_desligamento),
    terminationType: normalizeTerminationType(raw.tipo_desligamento),
    terminationReason: text(raw.motivo_desligamento),
    siteOperation: text(raw.site_operacao),
    preferredSchedule: text(raw.preferencia_horario) || "Não informado",
    bankName: text(raw.banco) || "Não informado",
    bankAgency: text(raw.agencia) || "Não informado",
    bankAccount: text(raw.conta_corrente) || "Não informado",
    pixKey: pixValidation?.valid ? pixValidation.normalizedValue : pixKey,
    pixKeyType: pixValidation?.valid ? pixValidation.pixKeyType : pixKeyType,
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
      pixKeyType: row.pixKeyType
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
      gender: row.sex,
      educationLevel: row.educationLevel,
      socialName: row.socialName,
      ethnicity: row.ethnicity,
      sexualOrientation: row.sexualOrientation,
      isPcd: row.isPcd,
      pcdDisabilityType: row.pcdDisabilityType,
      pcdDisabilityOther: row.pcdDisabilityOther,
      firstJob: row.firstJob,
      hasTelemarketingExperience: row.hasTelemarketingExperience,
      telemarketingWhere: row.telemarketingWhere
    }
  };
}

function buildEmployeeImportUpdateData(
  raw: EmployeeImportRow,
  row: NormalizedEmployeeImportRow,
  relations: {
    userId?: string;
    lobId?: string;
    teamId?: string;
    supervisorId?: string;
    shiftId?: string;
  }
): Prisma.EmployeeProfileUncheckedUpdateInput {
  const data: Prisma.EmployeeProfileUncheckedUpdateInput = {};
  if (relations.userId) data.userId = relations.userId;
  if (shouldPatchImportField(raw, ["nome"])) data.fullName = row.name;
  if (shouldPatchImportField(raw, ["nome_social"])) data.socialName = row.socialName;
  if (shouldPatchImportField(raw, ["cargo_funcao"])) data.roleTitle = row.roleTitle;
  if (shouldPatchImportField(raw, ["data_admissao"]) && row.admissionDate) data.admissionDate = row.admissionDate;
  if (shouldPatchImportField(raw, ["data_inicio_treinamento"]) && row.trainingStartDate) data.trainingStartDate = row.trainingStartDate;
  if (shouldPatchImportField(raw, ["status_colaborador"])) data.operationalStatus = row.employeeStatus;
  if (relations.lobId && shouldPatchImportField(raw, ["lob"])) data.lobId = relations.lobId;
  if (relations.teamId && shouldPatchImportField(raw, ["lob"])) data.teamId = relations.teamId;
  if (shouldPatchImportField(raw, ["supervisor_wb_login", "supervisor_email", "supervisor_nome"])) data.supervisorId = relations.supervisorId ?? null;
  if (relations.shiftId && shouldPatchImportField(raw, ["turno"])) data.shiftId = relations.shiftId;
  if (shouldPatchImportField(raw, ["horario_entrada", "entrada"])) data.workStartTime = row.workStartTime;
  if (shouldPatchImportField(raw, ["horario_saida", "saida"])) data.workEndTime = row.workEndTime;
  if (shouldPatchImportField(raw, ["skill"])) data.skill = row.skill;
  if (shouldPatchImportField(raw, ["wave"])) data.wave = row.wave;
  if (shouldPatchImportField(raw, ["data_desligamento"]) && row.terminationDate) data.terminationDate = row.terminationDate;
  if (shouldPatchImportField(raw, ["tipo_desligamento"])) data.terminationType = row.terminationType;
  if (shouldPatchImportField(raw, ["motivo_desligamento"])) data.terminationReason = row.terminationReason;
  if (shouldPatchImportField(raw, ["etnia"])) data.ethnicity = row.ethnicity;
  if (shouldPatchImportField(raw, ["orientacao_sexual"])) data.sexualOrientation = row.sexualOrientation;
  if (shouldPatchImportField(raw, ["eh_pcd"])) {
    data.isPcd = row.isPcd;
    if (row.isPcd !== "Sim") {
      data.pcdDisabilityType = null;
      data.pcdDisabilityOther = null;
    }
  }
  if (shouldPatchImportField(raw, ["tipo_deficiencia"])) data.pcdDisabilityType = row.pcdDisabilityType;
  if (shouldPatchImportField(raw, ["tipo_deficiencia_outro"])) data.pcdDisabilityOther = row.pcdDisabilityOther;
  if (shouldPatchImportField(raw, ["primeiro_emprego"])) data.firstJob = row.firstJob;
  if (shouldPatchImportField(raw, ["ja_trabalhou_telemarketing"])) data.hasTelemarketingExperience = row.hasTelemarketingExperience;
  if (shouldPatchImportField(raw, ["onde_trabalhou_telemarketing"])) data.telemarketingWhere = row.telemarketingWhere;
  if (shouldPatchImportField(raw, ["data_inicio_nesting"]) && row.nestingStartDate) data.nestingStartDate = row.nestingStartDate;
  if (shouldPatchImportField(raw, ["data_go_live"]) && row.goLiveDate) data.goLiveDate = row.goLiveDate;
  if (shouldPatchImportField(raw, ["tipo_contrato"])) data.contractType = row.contractType;
  if (shouldPatchImportField(raw, ["observacoes"])) data.internalNotes = row.notes;
  if (shouldPatchImportField(raw, ["contato_principal"])) data.primaryPhone = row.primaryPhone;
  if (shouldPatchImportField(raw, ["cidade"])) data.city = row.city;
  if (shouldPatchImportField(raw, ["estado_uf"])) data.stateUf = row.stateUf;
  if (shouldPatchImportField(raw, ["preferencia_horario"])) data.preferredSchedule = row.preferredSchedule;
  if (shouldPatchImportPix(raw)) {
    data.pixKey = row.pixKey;
    data.pixKeyType = row.pixKeyType;
  }
  return data;
}

function buildSensitiveImportUpdateData(
  raw: EmployeeImportRow,
  row: NormalizedEmployeeImportRow,
  birthDate: Date,
  current: EmployeeSensitiveData
): Prisma.EmployeeSensitiveDataUncheckedUpdateInput {
  const data: Prisma.EmployeeSensitiveDataUncheckedUpdateInput = {};
  if (shouldPatchImportField(raw, ["cpf"])) data.cpf = row.cpf;
  if (shouldPatchImportField(raw, ["rg"])) data.rg = row.rg;
  if (shouldPatchImportField(raw, ["orgao_expedidor_uf"])) data.rgIssuer = row.rgIssuer;
  if (shouldPatchImportField(raw, ["cnpj"])) data.cnpj = row.cnpj;
  if (shouldPatchImportField(raw, ["data_nascimento"])) data.birthDate = birthDate;

  const address = mergeRegistrationJson(current.address, {
    type: shouldPatchImportField(raw, ["endereco_tipo"]) ? row.addressType : undefined,
    name: shouldPatchImportField(raw, ["endereco"]) ? row.address : undefined,
    number: shouldPatchImportField(raw, ["numero"]) ? row.addressNumber : undefined,
    complement: shouldPatchImportField(raw, ["complemento"]) ? row.complement : undefined,
    neighborhood: shouldPatchImportField(raw, ["bairro"]) ? row.neighborhood : undefined,
    city: shouldPatchImportField(raw, ["cidade"]) ? row.city : undefined,
    stateUf: shouldPatchImportField(raw, ["estado_uf"]) ? row.stateUf : undefined,
    zipCode: shouldPatchImportField(raw, ["cep"]) ? row.zipCode : undefined
  });
  if (hasAnyImportValue(raw, ["endereco_tipo", "endereco", "numero", "complemento", "bairro", "cidade", "estado_uf", "cep"])) data.address = address;

  const bankData = mergeRegistrationJson(current.bankData, {
    bankName: shouldPatchImportField(raw, ["banco"]) ? row.bankName : undefined,
    bankAgency: shouldPatchImportField(raw, ["agencia"]) ? row.bankAgency : undefined,
    bankAccount: shouldPatchImportField(raw, ["conta_corrente"]) ? row.bankAccount : undefined,
    pixKey: shouldPatchImportPix(raw) ? row.pixKey : undefined,
    pixKeyType: shouldPatchImportPix(raw) ? row.pixKeyType : undefined
  });
  if (hasAnyImportValue(raw, ["banco", "agencia", "conta_corrente", "chave_pix", "tipo_chave_pix"])) data.bankData = bankData;

  const emergencyContactData = mergeRegistrationJson(current.emergencyContactData, {
    name: shouldPatchImportField(raw, ["nome_contato_emergencia"]) ? row.emergencyContactName : undefined,
    phone: shouldPatchImportField(raw, ["contato_emergencia"]) ? row.emergencyPhone : undefined,
    relationship: shouldPatchImportField(raw, ["parentesco_contato_emergencia"]) ? row.emergencyContactRelationship : undefined,
    primaryPhone: shouldPatchImportField(raw, ["contato_principal"]) ? row.primaryPhone : undefined
  });
  if (hasAnyImportValue(raw, ["nome_contato_emergencia", "contato_emergencia", "parentesco_contato_emergencia", "contato_principal"])) data.emergencyContactData = emergencyContactData;

  const familyData = mergeRegistrationJson(current.familyData, {
    hasChildren: shouldPatchImportField(raw, ["tem_filhos"]) ? row.hasChildren : undefined,
    childrenCount: shouldPatchImportField(raw, ["quantidade_filhos"]) ? row.childrenCount : undefined,
    maritalStatus: shouldPatchImportField(raw, ["estado_civil"]) ? row.maritalStatus : undefined,
    gender: shouldPatchImportField(raw, ["genero", "sexo"]) ? row.sex : undefined,
    educationLevel: shouldPatchImportField(raw, ["escolaridade"]) ? row.educationLevel : undefined,
    socialName: shouldPatchImportField(raw, ["nome_social"]) ? row.socialName : undefined,
    ethnicity: shouldPatchImportField(raw, ["etnia"]) ? row.ethnicity : undefined,
    sexualOrientation: shouldPatchImportField(raw, ["orientacao_sexual"]) ? row.sexualOrientation : undefined,
    isPcd: shouldPatchImportField(raw, ["eh_pcd"]) ? row.isPcd : undefined,
    pcdDisabilityType: shouldPatchImportField(raw, ["tipo_deficiencia"]) ? row.pcdDisabilityType : undefined,
    pcdDisabilityOther: shouldPatchImportField(raw, ["tipo_deficiencia_outro"]) ? row.pcdDisabilityOther : undefined,
    firstJob: shouldPatchImportField(raw, ["primeiro_emprego"]) ? row.firstJob : undefined,
    hasTelemarketingExperience: shouldPatchImportField(raw, ["ja_trabalhou_telemarketing"]) ? row.hasTelemarketingExperience : undefined,
    telemarketingWhere: shouldPatchImportField(raw, ["onde_trabalhou_telemarketing"]) ? row.telemarketingWhere : undefined
  });
  if (hasAnyImportValue(raw, ["tem_filhos", "quantidade_filhos", "estado_civil", "genero", "sexo", "escolaridade", "nome_social", "etnia", "orientacao_sexual", "eh_pcd", "tipo_deficiencia", "tipo_deficiencia_outro", "primeiro_emprego", "ja_trabalhou_telemarketing", "onde_trabalhou_telemarketing"])) data.familyData = familyData;
  return data;
}

function buildRegistrationImportUpdateData(
  raw: EmployeeImportRow,
  row: NormalizedEmployeeImportRow,
  context: {
    birthDate: Date;
    trainingStartDate: Date;
    admissionDate: Date;
    batchId: string;
    actorName: string;
    reviewerId: string;
    existingOperationalData: Prisma.JsonValue | null;
    existingHistory: Prisma.JsonValue | null;
    supervisorName: string | null;
  }
): Prisma.EmployeeRegistrationRequestUpdateInput {
  const data: Prisma.EmployeeRegistrationRequestUpdateInput = {
    status: "APROVADO",
    reviewedById: context.reviewerId,
    reviewedAt: new Date(),
    reviewNotes: "Importado via Excel e aprovado automaticamente.",
    history: appendHistory(context.existingHistory, context.actorName, "Cadastro importado e aprovado via Excel", context.batchId),
    deletedAt: null
  };
  if (shouldPatchImportField(raw, ["cnpj"])) data.cnpj = row.cnpj;
  if (shouldPatchImportField(raw, ["nome"])) data.fullName = row.name;
  if (shouldPatchImportField(raw, ["endereco_tipo"])) data.addressType = row.addressType;
  if (shouldPatchImportField(raw, ["endereco"])) data.addressName = row.address;
  if (shouldPatchImportField(raw, ["numero"])) data.addressNumber = row.addressNumber;
  if (shouldPatchImportField(raw, ["complemento"])) data.complement = row.complement;
  if (shouldPatchImportField(raw, ["bairro"])) data.neighborhood = row.neighborhood;
  if (shouldPatchImportField(raw, ["cidade"])) data.city = row.city;
  if (shouldPatchImportField(raw, ["estado_uf"])) data.stateUf = row.stateUf;
  if (shouldPatchImportField(raw, ["cep"])) data.zipCode = row.zipCode;
  if (shouldPatchImportField(raw, ["contato_principal"])) data.primaryPhone = row.primaryPhone;
  if (shouldPatchImportField(raw, ["contato_emergencia"])) data.emergencyPhone = row.emergencyPhone;
  if (shouldPatchImportField(raw, ["nome_contato_emergencia"])) data.emergencyContactName = row.emergencyContactName;
  if (shouldPatchImportField(raw, ["parentesco_contato_emergencia"])) data.emergencyContactRelationship = row.emergencyContactRelationship;
  if (shouldPatchImportField(raw, ["data_nascimento"])) data.birthDate = context.birthDate;
  if (shouldPatchImportField(raw, ["email"])) data.email = row.email;
  if (shouldPatchImportField(raw, ["rg"])) data.rg = row.rg;
  if (shouldPatchImportField(raw, ["orgao_expedidor_uf"])) data.rgIssuer = row.rgIssuer;
  if (shouldPatchImportField(raw, ["cpf"])) data.cpf = row.cpf;
  if (shouldPatchImportField(raw, ["genero", "sexo"])) data.sex = row.sex;
  if (shouldPatchImportField(raw, ["etnia"])) data.ethnicity = row.ethnicity;
  if (shouldPatchImportField(raw, ["orientacao_sexual"])) data.sexualOrientation = row.sexualOrientation;
  if (shouldPatchImportField(raw, ["eh_pcd"])) data.isPcd = row.isPcd;
  if (shouldPatchImportField(raw, ["tipo_deficiencia"])) data.pcdDisabilityType = row.pcdDisabilityType;
  if (shouldPatchImportField(raw, ["tipo_deficiencia_outro"])) data.pcdDisabilityOther = row.pcdDisabilityOther;
  if (shouldPatchImportField(raw, ["primeiro_emprego"])) data.firstJob = row.firstJob;
  if (shouldPatchImportField(raw, ["ja_trabalhou_telemarketing"])) data.hasTelemarketingExperience = row.hasTelemarketingExperience;
  if (shouldPatchImportField(raw, ["onde_trabalhou_telemarketing"])) data.telemarketingWhere = row.telemarketingWhere;
  if (shouldPatchImportField(raw, ["estado_civil"])) data.maritalStatus = row.maritalStatus;
  if (shouldPatchImportField(raw, ["escolaridade"])) data.educationLevel = row.educationLevel;
  if (shouldPatchImportField(raw, ["data_inicio_treinamento"]) || shouldPatchImportField(raw, ["data_admissao"])) data.trainingStartDate = context.trainingStartDate;
  if (shouldPatchImportField(raw, ["preferencia_horario"])) data.preferredSchedule = row.preferredSchedule;
  if (shouldPatchImportField(raw, ["banco"])) data.bankName = row.bankName;
  if (shouldPatchImportField(raw, ["agencia"])) data.bankAgency = row.bankAgency;
  if (shouldPatchImportField(raw, ["conta_corrente"])) data.bankAccount = row.bankAccount;
  if (shouldPatchImportPix(raw)) {
    data.pixKey = row.pixKey;
    data.pixKeyType = row.pixKeyType;
  }
  if (shouldPatchImportField(raw, ["chave_pix_secundaria"])) data.secondaryPixKey = row.secondaryPixKey;
  if (shouldPatchImportField(raw, ["tipo_chave_pix_secundaria"])) data.secondaryPixKeyType = row.secondaryPixKeyType;
  if (shouldPatchImportField(raw, ["nome_social"])) data.socialName = row.socialName;
  if (shouldPatchImportField(raw, ["tem_filhos"])) data.hasChildren = row.hasChildren;
  if (shouldPatchImportField(raw, ["quantidade_filhos"])) data.childrenCount = row.childrenCount;
  if (shouldPatchImportField(raw, ["observacoes"])) data.notes = row.notes;
  if (shouldPatchImportField(raw, ["data_inicio_nesting"])) data.nestingStartDate = row.nestingStartDate;
  if (shouldPatchImportField(raw, ["data_go_live"])) data.goLiveDate = row.goLiveDate;

  data.operationalData = mergeRegistrationJson(context.existingOperationalData, {
    origin: "IMPORT_EXCEL",
    importBatchId: context.batchId,
    wbLogin: row.wbLogin,
    lob: shouldPatchImportField(raw, ["lob"]) ? row.lob : undefined,
    supervisorInformado: hasAnyImportValue(raw, ["supervisor_nome", "supervisor_email", "supervisor_wb_login"]) ? row.supervisorName || row.supervisorEmail || row.supervisorWbLogin : undefined,
    shift: shouldPatchImportField(raw, ["turno"]) ? row.shift : undefined,
    roleTitle: shouldPatchImportField(raw, ["cargo_funcao"]) ? row.roleTitle : undefined,
    employeeStatus: shouldPatchImportField(raw, ["status_colaborador"]) ? row.employeeStatus : undefined,
    preferredSchedule: shouldPatchImportField(raw, ["preferencia_horario"]) ? row.preferredSchedule : undefined,
    supervisorWbLogin: shouldPatchImportField(raw, ["supervisor_wb_login"]) ? row.supervisorWbLogin : undefined,
    supervisorEmail: shouldPatchImportField(raw, ["supervisor_email"]) ? row.supervisorEmail : undefined,
    supervisorName: shouldPatchImportField(raw, ["supervisor_nome"]) ? row.supervisorName : undefined,
    supervisor: context.supervisorName,
    skill: shouldPatchImportField(raw, ["skill"]) ? row.skill : undefined,
    wave: shouldPatchImportField(raw, ["wave"]) ? row.wave : undefined,
    contractType: shouldPatchImportField(raw, ["tipo_contrato"]) ? row.contractType : undefined,
    admissionDate: shouldPatchImportField(raw, ["data_admissao"]) ? context.admissionDate.toISOString() : undefined,
    trainingStartDate: shouldPatchImportField(raw, ["data_inicio_treinamento"]) ? context.trainingStartDate.toISOString() : undefined,
    nestingStartDate: shouldPatchImportField(raw, ["data_inicio_nesting"]) ? row.nestingStartDate?.toISOString() : undefined,
    goLiveDate: shouldPatchImportField(raw, ["data_go_live"]) ? row.goLiveDate?.toISOString() : undefined,
    terminationDate: shouldPatchImportField(raw, ["data_desligamento"]) ? row.terminationDate?.toISOString() : undefined,
    terminationType: shouldPatchImportField(raw, ["tipo_desligamento"]) ? row.terminationType : undefined,
    terminationReason: shouldPatchImportField(raw, ["motivo_desligamento"]) ? row.terminationReason : undefined
  });
  return data;
}

function resolveImportSupervisor(
  row: ReturnType<typeof normalizeEmployeeImportRow>,
  employeeByWb: ReadonlyMap<string, { id: string; wbLogin: string; fullName: string }>,
  supervisorByEmail: ReadonlyMap<string, { id: string; wbLogin: string; fullName: string }>,
  supervisorsByNameKey: ReadonlyMap<string, Array<{ id: string; wbLogin: string; fullName: string }>>
) {
  const wbLogin = normalizeWbLoginForEmployeeImport(row.supervisorWbLogin);
  if (wbLogin) {
    const employee = employeeByWb.get(wbLogin) ?? null;
    return employee ? { employee } : { employee: null, error: "Supervisor informado por WB/Login não encontrado." };
  }
  if (row.supervisorEmail) {
    const employee = supervisorByEmail.get(row.supervisorEmail.toLowerCase()) ?? null;
    return employee ? { employee } : { employee: null, error: "Supervisor informado por e-mail não encontrado." };
  }
  if (row.supervisorName) {
    const matches = supervisorsByNameKey.get(normalizeLookupKey(row.supervisorName)) ?? [];
    if (matches.length > 1) return { employee: null, error: "Supervisor por nome encontrou mais de um colaborador. Use supervisor_wb_login." };
    return matches[0] ? { employee: matches[0] } : { employee: null, error: "Supervisor informado por nome não encontrado." };
  }
  return { employee: null, error: undefined };
}

function buildEmployeeByEmailMap<T extends { user: { email: string } | null }>(employees: T[]) {
  const map = new Map<string, T>();
  employees.forEach((employee) => {
    const email = employee.user?.email?.toLowerCase();
    if (email) map.set(email, employee);
  });
  return map;
}

async function wouldCreateImportSupervisorCycle(employeeId: string, supervisorId: string) {
  const visited = new Set<string>();
  let currentId: string | null = supervisorId;
  for (let depth = 0; currentId && depth < 500; depth += 1) {
    if (currentId === employeeId) return true;
    if (visited.has(currentId)) return true;
    visited.add(currentId);
    const current: { supervisorId: string | null } | null = await prisma.employeeProfile.findFirst({ where: { id: currentId, deletedAt: null }, select: { supervisorId: true } });
    currentId = current?.supervisorId ?? null;
  }
  return false;
}

function normalizeImportRole(value: string) {
  const normalized = normalizeRole(value);
  return normalized;
}

function parseImportBoolean(value: unknown) {
  return ["sim", "s", "yes", "y", "true", "1"].includes(text(value).toLowerCase());
}

function normalizeYesNoPrefer(value: unknown) {
  const raw = text(value);
  if (!raw) return "";
  const key = normalizeLookupKey(raw);
  const map: Record<string, string> = {
    SIM: "Sim",
    S: "Sim",
    YES: "Sim",
    Y: "Sim",
    TRUE: "Sim",
    "1": "Sim",
    NAO: "Não",
    N: "Não",
    NO: "Não",
    FALSE: "Não",
    "0": "Não",
    PREFIRO_NAO_INFORMAR: "Prefiro não informar",
    PREFIRO_N_INFORMAR: "Prefiro não informar",
    NAO_INFORMAR: "Prefiro não informar"
  };
  return map[key] ?? "";
}

function normalizePcdDisabilityType(value: unknown) {
  const raw = text(value);
  if (!raw) return "";
  const key = normalizeLookupKey(raw);
  const map: Record<string, string> = {
    FISICA: "Física",
    FISICO: "Física",
    AUDITIVA: "Auditiva",
    AUDITIVO: "Auditiva",
    VISUAL: "Visual",
    INTELECTUAL: "Intelectual",
    PSICOSSOCIAL: "Psicossocial",
    MULTIPLA: "Múltipla",
    MULTIPLO: "Múltipla",
    NEURODIVERGENTE: "Neurodivergente",
    NEURAL: "Neurodivergente",
    OUTRA: "Outra",
    OUTRO: "Outra",
    PREFIRO_NAO_INFORMAR: "Prefiro não informar",
    PREFIRO_N_INFORMAR: "Prefiro não informar",
    NAO_INFORMAR: "Prefiro não informar"
  };
  return map[key] ?? raw;
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

function normalizeWorkTime(value: unknown) {
  if (!hasImportValue(value)) return "";
  const raw = text(value);
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return "";
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return "";
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
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
    DESLIGADA: "Desligado",
    DESLIGADO_EM_TREINAMENTO: "Desligado em Treinamento",
    DESLIGADA_EM_TREINAMENTO: "Desligado em Treinamento",
    DESLIGADO_TREINAMENTO: "Desligado em Treinamento",
    DESLIGADA_TREINAMENTO: "Desligado em Treinamento",
    SUSPENSO: "Suspenso"
  };
  return map[key] ?? raw;
}

function isOperationalTerminationStatus(value: unknown) {
  const key = normalizeLookupKey(text(value));
  return ["DESLIGADO", "DESLIGADA", "TERMINATED"].includes(key);
}

function isTrainingTerminationStatus(value: unknown) {
  const key = normalizeLookupKey(text(value));
  return ["DESLIGADO_EM_TREINAMENTO", "DESLIGADA_EM_TREINAMENTO", "DESLIGADO_TREINAMENTO", "DESLIGADA_TREINAMENTO"].includes(key);
}

function isAccessInactiveEmployeeStatus(value: unknown) {
  const key = normalizeLookupKey(text(value));
  return [
    "INATIVO",
    "INACTIVE",
    "DESLIGADO",
    "DESLIGADA",
    "TERMINATED",
    "DESLIGADO_EM_TREINAMENTO",
    "DESLIGADA_EM_TREINAMENTO",
    "DESLIGADO_TREINAMENTO",
    "DESLIGADA_TREINAMENTO",
    "DESATIVADO",
    "DESATIVADA"
  ].includes(key);
}

function normalizeTerminationType(value: unknown) {
  const raw = text(value);
  if (!raw) return "";
  const key = normalizeLookupKey(raw);
  const map: Record<string, string> = {
    VOLUNTARIO: "Voluntário",
    VOLUNTARIA: "Voluntário",
    VOLUNTARY: "Voluntário",
    INVOLUNTARIO: "Involuntário",
    INVOLUNTARIA: "Involuntário",
    INVOLUNTARY: "Involuntário"
  };
  return map[key] ?? "";
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

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeWbLoginForEmployeeImport(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\u00A0/g, " ")
    .trim()
    .replace(/\s+/g, "")
    .toLowerCase();
}

async function findEmployeeProfilesByWbLoginBatch(normalizedWbLogins: string[]) {
  if (!normalizedWbLogins.length) return [];
  const chunks = chunkArray(normalizedWbLogins, 500);
  const results = await Promise.all(
    chunks.map((chunk) =>
      prisma.employeeProfile.findMany({
        where: {
          deletedAt: null,
          OR: chunk.map((wbLogin) => ({ wbLogin: { equals: wbLogin, mode: "insensitive" as const } }))
        },
        select: {
          id: true,
          userId: true,
          wbLogin: true,
          fullName: true,
          socialName: true,
          primaryPhone: true,
          city: true,
          stateUf: true,
          preferredSchedule: true,
          pixKey: true,
          pixKeyType: true,
          roleTitle: true,
          admissionDate: true,
          trainingStartDate: true,
          terminationDate: true,
          terminationType: true,
          terminationReason: true,
          ethnicity: true,
          sexualOrientation: true,
          isPcd: true,
          pcdDisabilityType: true,
          pcdDisabilityOther: true,
          firstJob: true,
          hasTelemarketingExperience: true,
          telemarketingWhere: true,
          nestingStartDate: true,
          goLiveDate: true,
          workStartTime: true,
          workEndTime: true,
          scheduleType: true,
          contractType: true,
          siteOperation: true,
          internalNotes: true,
          skill: true,
          wave: true,
          operationalStatus: true,
          lobId: true,
          teamId: true,
          supervisorId: true,
          shiftId: true,
          user: { select: { role: { select: { name: true } } } }
        }
      })
    )
  );
  return Array.from(new Map(results.flat().map((employee) => [employee.id, employee])).values());
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function hasImportValue(value: unknown) {
  if (value instanceof Date) return true;
  if (typeof value === "number") return true;
  return text(value) !== "";
}

function hasImportColumn(row: EmployeeImportRow, key: string) {
  return Object.prototype.hasOwnProperty.call(row, key);
}

function hasAnyImportValue(row: EmployeeImportRow, keys: string[]) {
  return keys.some((key) => hasImportValue(row[key]));
}

function hasAnyImportColumn(row: EmployeeImportRow, keys: string[]) {
  return keys.some((key) => hasImportColumn(row, key));
}

function shouldPatchImportField(row: EmployeeImportRow, keys: string[]) {
  return hasAnyImportColumn(row, keys) && hasAnyImportValue(row, keys);
}

function shouldPatchImportPix(row: EmployeeImportRow) {
  return hasImportValue(row.chave_pix) && hasImportValue(row.tipo_chave_pix);
}

function getEmptyImportedFieldLabels(row: EmployeeImportRow) {
  return importFieldLabels
    .filter((field) => hasAnyImportColumn(row, field.keys) && !hasAnyImportValue(row, field.keys))
    .map((field) => field.label);
}

function dateCompareKey(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 10) : "";
}

function buildEmployeeImportChangeLabels(
  raw: EmployeeImportRow,
  row: NormalizedEmployeeImportRow,
  existing: Partial<EmployeeProfile>,
  supervisor: { id: string; fullName: string } | null
) {
  const changes: string[] = [];
  const pushText = (label: string, keys: string[], next: string | null | undefined, current: string | null | undefined) => {
    if (shouldPatchImportField(raw, keys) && (next ?? "") !== (current ?? "")) changes.push(`${label}: ${current || "vazio"} → ${next || "vazio"}`);
  };
  const pushDate = (label: string, keys: string[], next: Date | null | undefined, current: Date | null | undefined) => {
    if (shouldPatchImportField(raw, keys) && dateCompareKey(next) !== dateCompareKey(current)) changes.push(`${label}: ${dateCompareKey(current) || "vazio"} → ${dateCompareKey(next) || "vazio"}`);
  };

  pushText("Nome", ["nome"], row.name, existing.fullName);
  pushText("Nome social", ["nome_social"], row.socialName, existing.socialName);
  pushText("Cargo/Função", ["cargo_funcao"], row.roleTitle, existing.roleTitle);
  pushText("Status", ["status_colaborador"], row.employeeStatus, existing.operationalStatus);
  pushText("Skill", ["skill"], row.skill, existing.skill);
  pushText("Wave", ["wave"], row.wave, existing.wave);
  pushText("Horário de entrada", ["horario_entrada", "entrada"], row.workStartTime, existing.workStartTime);
  pushText("Horário de saída", ["horario_saida", "saida"], row.workEndTime, existing.workEndTime);
  pushText("Tipo de contrato", ["tipo_contrato"], row.contractType, existing.contractType);
  pushText("Telefone", ["contato_principal"], row.primaryPhone, existing.primaryPhone);
  pushText("Cidade", ["cidade"], row.city, existing.city);
  pushText("UF", ["estado_uf"], row.stateUf, existing.stateUf);
  if (shouldPatchImportPix(raw)) {
    pushText("Chave PIX", ["chave_pix"], row.pixKey, existing.pixKey);
    pushText("Tipo da Chave PIX", ["tipo_chave_pix"], row.pixKeyType, existing.pixKeyType);
  }
  pushDate("Data de admissão", ["data_admissao"], row.admissionDate, existing.admissionDate);
  pushDate("Data de início de treinamento", ["data_inicio_treinamento"], row.trainingStartDate, existing.trainingStartDate);
  pushDate("Data de início de Nesting", ["data_inicio_nesting"], row.nestingStartDate, existing.nestingStartDate);
  pushDate("Data de Go Live", ["data_go_live"], row.goLiveDate, existing.goLiveDate);
  pushDate("Data de desligamento", ["data_desligamento"], row.terminationDate, existing.terminationDate);
  if (shouldPatchImportField(raw, ["supervisor_wb_login", "supervisor_email", "supervisor_nome"]) && supervisor?.id !== existing.supervisorId) changes.push(`Supervisor: ${supervisor?.fullName ?? "vazio"}`);
  return changes;
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
    ethnicity: item.ethnicity ?? "",
    sexualOrientation: item.sexualOrientation ?? "",
    isPcd: item.isPcd ?? "",
    pcdDisabilityType: item.pcdDisabilityType ?? "",
    pcdDisabilityOther: item.pcdDisabilityOther ?? "",
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

function isBlankPatchValue(value: unknown) {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

function cleanPatchPayload<T extends Record<string, unknown>>(payload: T): Partial<T> {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => !isBlankPatchValue(value))) as Partial<T>;
}

function optionalRegistrationText(value?: string | null) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function profileRegistrationCreateData(item: EmployeeRegistrationRequest) {
  return {
    fullName: item.fullName,
    ...cleanPatchPayload({
      socialName: optionalRegistrationText(item.socialName),
      primaryPhone: optionalRegistrationText(item.primaryPhone),
      city: optionalRegistrationText(item.city),
      stateUf: optionalRegistrationText(item.stateUf),
      preferredSchedule: optionalRegistrationText(item.preferredSchedule),
      pixKey: optionalRegistrationText(item.pixKey),
      pixKeyType: optionalRegistrationText(item.pixKeyType),
      ethnicity: optionalRegistrationText(item.ethnicity),
      sexualOrientation: optionalRegistrationText(item.sexualOrientation),
      isPcd: optionalRegistrationText(item.isPcd),
      pcdDisabilityType: optionalRegistrationText(item.pcdDisabilityType),
      pcdDisabilityOther: optionalRegistrationText(item.pcdDisabilityOther),
      firstJob: optionalRegistrationText(item.firstJob),
      hasTelemarketingExperience: optionalRegistrationText(item.hasTelemarketingExperience),
      telemarketingWhere: optionalRegistrationText(item.telemarketingWhere)
    })
  };
}

function missingProfileRegistrationData(profile: EmployeeProfile, item: EmployeeRegistrationRequest) {
  return cleanPatchPayload({
    fullName: isBlankPatchValue(profile.fullName) ? item.fullName : undefined,
    socialName: isBlankPatchValue(profile.socialName) ? item.socialName : undefined,
    primaryPhone: isBlankPatchValue(profile.primaryPhone) ? item.primaryPhone : undefined,
    city: isBlankPatchValue(profile.city) ? item.city : undefined,
    stateUf: isBlankPatchValue(profile.stateUf) ? item.stateUf : undefined,
    preferredSchedule: isBlankPatchValue(profile.preferredSchedule) ? item.preferredSchedule : undefined,
    pixKey: isBlankPatchValue(profile.pixKey) ? item.pixKey : undefined,
    pixKeyType: isBlankPatchValue(profile.pixKeyType) ? item.pixKeyType : undefined,
    ethnicity: isBlankPatchValue(profile.ethnicity) ? item.ethnicity : undefined,
    sexualOrientation: isBlankPatchValue(profile.sexualOrientation) ? item.sexualOrientation : undefined,
    isPcd: isBlankPatchValue(profile.isPcd) ? item.isPcd : undefined,
    pcdDisabilityType: isBlankPatchValue(profile.pcdDisabilityType) ? item.pcdDisabilityType : undefined,
    pcdDisabilityOther: isBlankPatchValue(profile.pcdDisabilityOther) ? item.pcdDisabilityOther : undefined,
    firstJob: isBlankPatchValue(profile.firstJob) ? item.firstJob : undefined,
    hasTelemarketingExperience: isBlankPatchValue(profile.hasTelemarketingExperience) ? item.hasTelemarketingExperience : undefined,
    telemarketingWhere: isBlankPatchValue(profile.telemarketingWhere) ? item.telemarketingWhere : undefined
  });
}

function jsonRecord(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function mergeRegistrationJson(current: Prisma.JsonValue | null | undefined, incoming: Record<string, unknown>) {
  const merged: Record<string, Prisma.InputJsonValue> = {};
  for (const [key, value] of Object.entries(jsonRecord(current))) {
    if (!isBlankPatchValue(value)) merged[key] = value as Prisma.InputJsonValue;
  }
  for (const [key, value] of Object.entries(incoming)) {
    if (!isBlankPatchValue(value)) merged[key] = value as Prisma.InputJsonValue;
  }
  return merged as Prisma.InputJsonObject;
}

function mergeSensitiveRegistrationData(current: EmployeeSensitiveData, item: EmployeeRegistrationRequest) {
  const incoming = sensitiveData(item);
  return {
    cpf: optionalRegistrationText(incoming.cpf) ?? current.cpf,
    rg: optionalRegistrationText(incoming.rg) ?? current.rg,
    rgIssuer: optionalRegistrationText(incoming.rgIssuer) ?? current.rgIssuer,
    cnpj: optionalRegistrationText(incoming.cnpj) ?? current.cnpj,
    birthDate: incoming.birthDate ?? current.birthDate,
    address: mergeRegistrationJson(current.address, incoming.address),
    bankData: mergeRegistrationJson(current.bankData, incoming.bankData),
    emergencyContactData: mergeRegistrationJson(current.emergencyContactData, incoming.emergencyContactData),
    familyData: mergeRegistrationJson(current.familyData, incoming.familyData)
  };
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
      pixKeyType: item.pixKeyType
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
      gender: item.sex,
      educationLevel: item.educationLevel,
      socialName: item.socialName,
      ethnicity: item.ethnicity,
      sexualOrientation: item.sexualOrientation,
      isPcd: item.isPcd,
      pcdDisabilityType: item.pcdDisabilityType,
      pcdDisabilityOther: item.pcdDisabilityOther,
      firstJob: item.firstJob,
      hasTelemarketingExperience: item.hasTelemarketingExperience,
      telemarketingWhere: item.telemarketingWhere
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
