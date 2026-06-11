export const PIX_KEY_TYPES = ["CPF", "CNPJ", "E-mail", "Telefone", "Chave aleatória"] as const;

export type PixKeyType = (typeof PIX_KEY_TYPES)[number];

export type PixKeyValidationResult = {
  valid: boolean;
  pixKeyType: string;
  normalizedValue: string;
  message?: string;
  field?: "pixKeyType" | "pixKey";
};

const pixKeyTypeAliases: Record<string, PixKeyType> = {
  CPF: "CPF",
  CNPJ: "CNPJ",
  EMAIL: "E-mail",
  E_MAIL: "E-mail",
  EEMAIL: "E-mail",
  TELEFONE: "Telefone",
  PHONE: "Telefone",
  ALEATORIA: "Chave aleatória",
  ALEATORIA_PIX: "Chave aleatória",
  CHAVE_ALEATORIA: "Chave aleatória",
  CHAVEALEATORIA: "Chave aleatória",
  CHAVE_PIX_ALEATORIA: "Chave aleatória",
  PIX_ALEATORIA: "Chave aleatória"
};

export function normalizePixKeyType(value?: string | null) {
  const raw = cleanPixValue(value);
  if (!raw) return "";
  if ((PIX_KEY_TYPES as readonly string[]).includes(raw)) return raw;
  const key = raw
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  return pixKeyTypeAliases[key] ?? raw;
}

export function validatePixKey(pixKeyType?: string | null, pixKey?: string | null): PixKeyValidationResult {
  const normalizedType = normalizePixKeyType(pixKeyType);
  const normalizedKey = cleanPixValue(pixKey);

  if (!normalizedType || !(PIX_KEY_TYPES as readonly string[]).includes(normalizedType)) {
    return invalid("Tipo da Chave PIX é obrigatório.", "pixKeyType", normalizedType, normalizedKey);
  }
  if (!normalizedKey) {
    return invalid("Chave PIX é obrigatória.", "pixKey", normalizedType, normalizedKey);
  }

  if (normalizedType === "CPF") {
    if (!/^\d{11}$/.test(normalizedKey)) {
      return invalid("CPF deve conter somente números e ter exatamente 11 dígitos.", "pixKey", normalizedType, normalizedKey);
    }
    return valid(normalizedType, normalizedKey);
  }

  if (normalizedType === "CNPJ") {
    if (!/^\d{14}$/.test(normalizedKey)) {
      return invalid("CNPJ deve conter somente números e ter exatamente 14 dígitos.", "pixKey", normalizedType, normalizedKey);
    }
    return valid(normalizedType, normalizedKey);
  }

  if (normalizedType === "E-mail") {
    const email = normalizedKey.toLowerCase();
    if (/\s/.test(normalizedKey) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return invalid("Informe um e-mail válido para a Chave PIX.", "pixKey", normalizedType, normalizedKey);
    }
    return valid(normalizedType, email);
  }

  if (normalizedType === "Telefone") {
    if (!/^\+55\d{2}\d{8,9}$/.test(normalizedKey)) {
      return invalid("Telefone deve estar no formato +55DDNUMERO, exemplo: +5511930211909.", "pixKey", normalizedType, normalizedKey);
    }
    return valid(normalizedType, normalizedKey);
  }

  return valid(normalizedType, normalizedKey);
}

export function getPixKeyFormatHint(type?: string | null) {
  const normalizedType = normalizePixKeyType(type);
  if (normalizedType === "CPF") return "Informe apenas números, com 11 dígitos.";
  if (normalizedType === "CNPJ") return "Informe apenas números, com 14 dígitos.";
  if (normalizedType === "E-mail") return "Informe um e-mail válido.";
  if (normalizedType === "Telefone") return "Use o formato +55DDNUMERO. Exemplo: +5511930211909.";
  if (normalizedType === "Chave aleatória") return "Informe sua chave aleatória PIX.";
  return "Selecione o tipo para ver o formato esperado.";
}

export function maskPixKey(value?: string | null, type?: string | null) {
  const raw = cleanPixValue(value);
  if (!raw) return "";
  const normalizedType = normalizePixKeyType(type);
  if (normalizedType === "E-mail") {
    const [local, domain] = raw.split("@");
    return domain ? `${local.slice(0, 1)}**@${domain}` : maskMiddle(raw);
  }
  if (normalizedType === "CPF") return "***.***.***-**";
  if (normalizedType === "CNPJ") return "**.***.***/****-**";
  if (normalizedType === "Telefone") return "+55***********";
  return raw.length > 8 ? `${raw.slice(0, 4)}...${raw.slice(-4)}` : maskMiddle(raw);
}

function valid(pixKeyType: string, normalizedValue: string): PixKeyValidationResult {
  return { valid: true, pixKeyType, normalizedValue };
}

function invalid(message: string, field: "pixKeyType" | "pixKey", pixKeyType: string, normalizedValue: string): PixKeyValidationResult {
  return { valid: false, pixKeyType, normalizedValue, message, field };
}

function cleanPixValue(value?: string | null) {
  return String(value ?? "").trim();
}

function maskMiddle(value: string) {
  if (value.length <= 2) return "*".repeat(value.length);
  return `${value.slice(0, 1)}${"*".repeat(Math.min(6, value.length - 2))}${value.slice(-1)}`;
}
