export const SECURITY_QUESTIONS = [
  { value: "SECRET_PHRASE", label: "Qual frase secreta você criou para recuperar sua senha?" },
  { value: "INVENTED_CHARACTER", label: "Qual era o nome de um personagem que você inventou?" },
  { value: "SPECIAL_PLACE_WORD", label: "Qual palavra só você associa a um lugar importante?" },
  { value: "CHILDHOOD_OBJECT", label: "Qual era o apelido de um objeto marcante da sua infância?" },
  { value: "MEMORABLE_TEACHER", label: "Qual era o nome de um professor ou professora marcante?" }
] as const;

export type SecurityQuestionCode = typeof SECURITY_QUESTIONS[number]["value"];

const questionCodes = new Set<string>(SECURITY_QUESTIONS.map((item) => item.value));

export function isSecurityQuestionCode(value: string): value is SecurityQuestionCode {
  return questionCodes.has(value);
}

export function securityQuestionLabel(value?: string | null) {
  return SECURITY_QUESTIONS.find((item) => item.value === value)?.label ?? "";
}

// Answers are intentionally case-insensitive and space-tolerant. The normalized
// value is only ever passed to bcrypt and must never be persisted or logged.
export function normalizeSecurityAnswer(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
}

export function validateSecurityAnswer(value: string) {
  const normalized = normalizeSecurityAnswer(value);
  if (!normalized) return "Informe a resposta de segurança.";
  if (normalized.length > 128) return "A resposta deve ter no máximo 128 caracteres.";
  return "";
}
