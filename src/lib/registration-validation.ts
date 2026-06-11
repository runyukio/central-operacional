import { z } from "zod";

import { normalizePixKeyType, validatePixKey } from "@/lib/pix-key";

const ufOptions = new Set(["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"]);

function requiredString(message: string) {
  return z.string({ required_error: message }).trim().min(1, message);
}

const optionalString = z.string().optional().transform((value) => cleanOptional(value));
const optionalFormattedPhone = z.string().optional().transform((value) => {
  const cleaned = cleanOptional(value);
  return cleaned ? formatPhone(cleaned) : undefined;
}).refine((value) => !value || isFormattedPhone(value), "Contato de emergência inválido. Use 00 0000-0000 ou 00 00000-0000.");

export type RegistrationInput = z.infer<typeof registrationPayloadSchema>;

export type RegistrationValidationError = {
  success: false;
  type: "VALIDATION_ERROR";
  message: string;
  fields: Record<string, string>;
};

export type RegistrationValidationSuccess = {
  success: true;
  data: RegistrationInput;
};

export const registrationPayloadSchema = z.object({
  cnpj: z.string().transform(formatCnpj).refine(isValidCnpj, "CNPJ inválido. Use 00.000.000/0000-00."),
  fullName: requiredString("Nome completo é obrigatório.").min(3, "Nome completo deve ter pelo menos 3 caracteres."),
  addressType: requiredString("Tipo de endereço é obrigatório.").refine((value) => ["Rua", "Avenida", "Alameda"].includes(value), "Endereço deve ser Rua, Avenida ou Alameda."),
  addressName: requiredString("Endereço é obrigatório."),
  addressNumber: requiredString("Número é obrigatório."),
  complement: optionalString,
  neighborhood: requiredString("Bairro é obrigatório."),
  city: requiredString("Cidade é obrigatória."),
  stateUf: z.string().trim().toUpperCase().refine((value) => ufOptions.has(value), "UF inválida. Use a sigla do estado, exemplo SP."),
  zipCode: z.string().transform(formatZipCode).refine((value) => /^\d{2}\.\d{3}-\d{3}$/.test(value), "CEP inválido. Use 00.000-000."),
  primaryPhone: z.string().transform(formatPhone).refine(isFormattedPhone, "Contato principal inválido. Use 00 0000-0000 ou 00 00000-0000."),
  emergencyPhone: optionalFormattedPhone,
  emergencyContactName: optionalString,
  emergencyContactRelationship: optionalString,
  birthDate: dateString("Data de nascimento é obrigatória.", { noFuture: true }),
  email: z.string().trim().toLowerCase().email("E-mail inválido."),
  password: z.string({ required_error: "Senha é obrigatória." }).min(8, "Senha deve ter pelo menos 8 caracteres."),
  confirmPassword: z.string({ required_error: "Confirmação de senha é obrigatória." }).min(1, "Confirme a senha informada."),
  rg: requiredString("RG é obrigatório."),
  rgIssuer: requiredString("Órgão expedidor e UF são obrigatórios."),
  cpf: z.string().transform(formatCpf).refine(isValidCpf, "CPF inválido. Use 000.000.000-00."),
  sex: requiredString("Gênero é obrigatório."),
  maritalStatus: requiredString("Estado civil é obrigatório."),
  educationLevel: requiredString("Escolaridade é obrigatória."),
  ethnicity: requiredString("Etnia é obrigatória."),
  sexualOrientation: requiredString("Orientação sexual é obrigatória."),
  isPcd: requiredString("Informe se é PCD."),
  pcdDisabilityType: optionalString,
  pcdDisabilityOther: optionalString,
  firstJob: requiredString("Informe se este é o primeiro emprego."),
  hasTelemarketingExperience: requiredString("Informe se já trabalhou em telemarketing."),
  telemarketingWhere: optionalString,
  bankName: requiredString("Banco é obrigatório."),
  bankAgency: requiredString("Agência com dígito é obrigatória."),
  bankAccount: requiredString("Conta corrente com dígito é obrigatória."),
  pixKey: requiredString("Chave PIX é obrigatória."),
  pixKeyType: requiredString("Tipo da Chave PIX é obrigatório.").transform(normalizePixKeyType),
  socialName: optionalString,
  hasChildren: z.preprocess((value) => value === "Sim" ? true : value === "Não" ? false : value, z.boolean({ required_error: "Informe se tem filhos." })),
  childrenCount: z.preprocess((value) => value === "" || value === null || typeof value === "undefined" ? undefined : Number(value), z.number().int("Quantidade de filhos deve ser um número inteiro.").nonnegative("Quantidade de filhos não pode ser negativa.").optional()),
  notes: optionalString
}).superRefine((data, ctx) => {
  if (data.hasChildren && (!data.childrenCount || data.childrenCount < 1)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["childrenCount"],
      message: "Informe a quantidade de filhos."
    });
  }

  if (!data.hasChildren) data.childrenCount = 0;

  if (data.password !== data.confirmPassword) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["confirmPassword"],
      message: "As senhas informadas não conferem."
    });
  }

  if (data.isPcd === "Sim" && !data.pcdDisabilityType?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["pcdDisabilityType"],
      message: "Tipo de deficiência é obrigatório quando PCD for Sim."
    });
  }

  if (data.isPcd === "Sim" && data.pcdDisabilityType === "Outra" && !data.pcdDisabilityOther?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["pcdDisabilityOther"],
      message: "Especifique o tipo de deficiência."
    });
  }

  if (data.isPcd !== "Sim") {
    data.pcdDisabilityType = undefined;
    data.pcdDisabilityOther = undefined;
  }

  if (data.pcdDisabilityType !== "Outra") data.pcdDisabilityOther = undefined;

  if (data.hasTelemarketingExperience === "Não" && !data.telemarketingWhere) {
    data.telemarketingWhere = "Não se aplica";
  }

  if (data.hasTelemarketingExperience === "Sim" && !data.telemarketingWhere?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["telemarketingWhere"],
      message: "Informe onde trabalhou em telemarketing."
    });
  }

  const pixValidation = validatePixKey(data.pixKeyType, data.pixKey);
  if (!pixValidation.valid) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [pixValidation.field ?? "pixKey"],
      message: pixValidation.message ?? "Chave PIX inválida."
    });
  } else {
    data.pixKeyType = pixValidation.pixKeyType;
    data.pixKey = pixValidation.normalizedValue;
  }
});

export async function parseRegistrationPayload(request: Request): Promise<RegistrationValidationSuccess | RegistrationValidationError> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return {
      success: false,
      type: "VALIDATION_ERROR",
      message: "Não foi possível ler os dados enviados.",
      fields: { form: "Envie um formulário válido." }
    };
  }

  if (process.env.NODE_ENV !== "production") {
    const preview = typeof payload === "object" && payload
      ? {
          fullName: (payload as Record<string, unknown>).fullName,
          email: (payload as Record<string, unknown>).email,
          cpf: maskSensitive(String((payload as Record<string, unknown>).cpf ?? "")),
          cnpj: maskSensitive(String((payload as Record<string, unknown>).cnpj ?? ""))
        }
      : {};
    console.info("[registration] payload recebido", preview);
  }

  const parsed = registrationPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    const fields = zodFields(parsed.error);
    console.warn("[registration] validação falhou", fields);
    return {
      success: false,
      type: "VALIDATION_ERROR",
      message: "Revise os campos destacados antes de enviar o cadastro.",
      fields
    };
  }

  return { success: true, data: parsed.data };
}

function cleanOptional(value?: string) {
  const cleaned = value?.trim();
  return cleaned ? cleaned : undefined;
}

function dateString(requiredMessage: string, options?: { noFuture?: boolean }) {
  return z.string({ required_error: requiredMessage })
    .trim()
    .min(1, requiredMessage)
    .refine((value) => /^\d{4}-\d{2}-\d{2}$/.test(value), "Data inválida.")
    .refine((value) => !Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime()), "Data inválida.")
    .refine((value) => {
      if (!options?.noFuture) return true;
      const date = new Date(`${value}T00:00:00.000Z`);
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      return date <= today;
    }, "Data de nascimento não pode ser futura.");
}

function zodFields(error: z.ZodError) {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}

function digits(value: string) {
  return value.replace(/\D/g, "");
}

function formatCpf(value: string) {
  const number = digits(value);
  if (number.length !== 11) return value.trim();
  return `${number.slice(0, 3)}.${number.slice(3, 6)}.${number.slice(6, 9)}-${number.slice(9)}`;
}

function formatCnpj(value: string) {
  const number = digits(value);
  if (number.length !== 14) return value.trim();
  return `${number.slice(0, 2)}.${number.slice(2, 5)}.${number.slice(5, 8)}/${number.slice(8, 12)}-${number.slice(12)}`;
}

function formatZipCode(value: string) {
  const number = digits(value);
  if (number.length !== 8) return value.trim();
  return `${number.slice(0, 2)}.${number.slice(2, 5)}-${number.slice(5)}`;
}

function formatPhone(value: string) {
  const number = digits(value);
  if (number.length === 10) return `${number.slice(0, 2)} ${number.slice(2, 6)}-${number.slice(6)}`;
  if (number.length === 11) return `${number.slice(0, 2)} ${number.slice(2, 7)}-${number.slice(7)}`;
  return value.trim();
}

function isFormattedPhone(value: string) {
  return /^\d{2} \d{4,5}-\d{4}$/.test(value);
}

function isValidCpf(value: string) {
  const number = digits(value);
  if (number.length !== 11 || /^(\d)\1+$/.test(number)) return false;
  const validate = (factor: number) => {
    let total = 0;
    for (let index = 0; index < factor - 1; index += 1) total += Number(number[index]) * (factor - index);
    const rest = (total * 10) % 11;
    return (rest === 10 ? 0 : rest) === Number(number[factor - 1]);
  };
  return validate(10) && validate(11);
}

function isValidCnpj(value: string) {
  const number = digits(value);
  if (number.length !== 14 || /^(\d)\1+$/.test(number)) return false;
  const calculate = (length: number) => {
    const factors = length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = number.slice(0, length).split("").reduce((acc, digit, index) => acc + Number(digit) * factors[index], 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return calculate(12) === Number(number[12]) && calculate(13) === Number(number[13]);
}

function maskSensitive(value: string) {
  const number = digits(value);
  if (number.length <= 4) return "***";
  return `***${number.slice(-4)}`;
}
