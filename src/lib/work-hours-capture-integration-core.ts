export const CAPTURE_AUTO_PRESENCE_THRESHOLD_MS = 2 * 60 * 60 * 1000;
export const LOW_ADHERENCE_THRESHOLD_MS = (7 * 60 + 25) * 60 * 1000;
export const STANDARD_CAPTURE_BONUS_MS = 30 * 60 * 1000;
export const STANDARD_OPERATIONAL_DAY_MS = 8 * 60 * 60 * 1000;

export type OperationalHourRule = "RA_ONBOARDING" | "BILINGUAL" | "CEC_COMMENTS" | "STANDARD";
export type CaptureImportDecision = "AUTOMATIC" | "DIVERGENCE" | "IGNORE";
export type CaptureDivergenceAction =
  | "CONFIRM_PRESENCE"
  | "CONFIRM_ATTENDANCE"
  | "CONFIRM_ABSENCE"
  | "CONFIRM_DAY_OFF"
  | "KEEP_PENDING";

export type CaptureDivergenceReason =
  | "MISSING_CAPTURE"
  | "UNSCHEDULED_CAPTURE"
  | "SHORT_CAPTURE"
  | "SCHEDULE_STATUS_REVIEW";

export type OperationalClassificationInput = {
  lob?: string | null;
  legacySkill?: string | null;
  skillNames?: Array<string | null | undefined>;
};

export type OperationalHourCalculation = {
  rule: OperationalHourRule;
  ruleLabel: string;
  classificationLabel: string;
  capturedMs: number;
  operationalMs: number;
  operationalHours: number;
  overtimeMs: number;
  overtimeHours: number;
};

export type CaptureImportEvaluation = {
  decision: CaptureImportDecision;
  targetScheduleStatus?: string;
  reasons: CaptureDivergenceReason[];
  actions: CaptureDivergenceAction[];
};

const scheduledStatusKeys = new Set(["ESCALADO", "TROCA_APROVADA", "NESTING"]);
const recognizedAttendanceStatusKeys = new Set(["PRESENTE", "ATRASO", "SAIDA_ANTECIPADA"]);
const dayOffStatusKeys = new Set(["FOLGA", "OFF", "FOLGA_APROVADA", "FERIADO"]);
const dayOffSaleStatusKeys = new Set(["VENDA_FOLGA_APROVADA", "VENDA_DE_FOLGA_APROVADA", "VENDA_FOLGA"]);

export function normalizeOperationalToken(value?: string | null) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function resolveOperationalHourRule(input: OperationalClassificationInput): {
  rule: OperationalHourRule;
  classificationLabel: string;
} {
  const skills = new Set(
    [input.legacySkill, ...(input.skillNames ?? [])]
      .map((value) => normalizeOperationalToken(value))
      .filter(Boolean)
  );
  const lob = normalizeOperationalToken(input.lob);

  if (skills.has("RA")) return { rule: "RA_ONBOARDING", classificationLabel: "RA" };
  if (skills.has("ONBOARDING")) return { rule: "RA_ONBOARDING", classificationLabel: "Onboarding" };
  if (skills.has("BILINGUE") || skills.has("BILINGUAL")) {
    return { rule: "BILINGUAL", classificationLabel: "Bilíngue" };
  }
  if (lob === "CEC") return { rule: "CEC_COMMENTS", classificationLabel: "CEC" };
  if (lob === "COMMENTS") return { rule: "CEC_COMMENTS", classificationLabel: "COMMENTS" };
  return { rule: "STANDARD", classificationLabel: input.lob?.trim() || "Demais agentes" };
}

export function calculateOperationalHours(
  capturedMsInput: number,
  classification: OperationalClassificationInput
): OperationalHourCalculation {
  const capturedMs = Math.max(0, Math.floor(capturedMsInput));
  const resolved = resolveOperationalHourRule(classification);
  let operationalMs: number;

  if (resolved.rule === "RA_ONBOARDING") operationalMs = STANDARD_OPERATIONAL_DAY_MS;
  else if (resolved.rule === "BILINGUAL") operationalMs = Math.min(capturedMs, STANDARD_OPERATIONAL_DAY_MS);
  else if (resolved.rule === "CEC_COMMENTS") operationalMs = Math.max(capturedMs, STANDARD_OPERATIONAL_DAY_MS);
  else operationalMs = capturedMs + STANDARD_CAPTURE_BONUS_MS;

  const overtimeMs = Math.max(0, operationalMs - STANDARD_OPERATIONAL_DAY_MS);
  return {
    rule: resolved.rule,
    ruleLabel: operationalHourRuleLabel(resolved.rule),
    classificationLabel: resolved.classificationLabel,
    capturedMs,
    operationalMs,
    operationalHours: roundHours(operationalMs / 3_600_000),
    overtimeMs,
    overtimeHours: roundHours(overtimeMs / 3_600_000)
  };
}

export function evaluateCaptureImport(input: {
  scheduleExists: boolean;
  scheduleStatus?: string | null;
  capturedMs?: number | null;
}): CaptureImportEvaluation {
  const status = normalizeOperationalToken(input.scheduleStatus);
  const hasCapture = input.capturedMs !== null && input.capturedMs !== undefined && input.capturedMs > 0;
  const capturedMs = hasCapture ? Math.max(0, Math.floor(input.capturedMs!)) : 0;

  if (!hasCapture) {
    if (dayOffStatusKeys.has(status) || !input.scheduleExists) {
      return { decision: "IGNORE", reasons: [], actions: [] };
    }
    if (dayOffSaleStatusKeys.has(status)) {
      return {
        decision: "DIVERGENCE",
        reasons: ["MISSING_CAPTURE"],
        actions: ["CONFIRM_DAY_OFF", "KEEP_PENDING"]
      };
    }
    if (scheduledStatusKeys.has(status) || recognizedAttendanceStatusKeys.has(status)) {
      return {
        decision: "DIVERGENCE",
        reasons: ["MISSING_CAPTURE"],
        actions: ["CONFIRM_ABSENCE", "KEEP_PENDING"]
      };
    }
    return { decision: "IGNORE", reasons: [], actions: [] };
  }

  const isShortCapture = capturedMs <= CAPTURE_AUTO_PRESENCE_THRESHOLD_MS;
  if (!input.scheduleExists) {
    return {
      decision: "DIVERGENCE",
      reasons: ["UNSCHEDULED_CAPTURE", ...(isShortCapture ? ["SHORT_CAPTURE" as const] : [])],
      actions: ["CONFIRM_PRESENCE", "KEEP_PENDING"]
    };
  }

  if (isShortCapture) {
    if (dayOffSaleStatusKeys.has(status)) {
      return {
        decision: "DIVERGENCE",
        reasons: ["SHORT_CAPTURE"],
        actions: ["CONFIRM_ATTENDANCE", "CONFIRM_DAY_OFF", "KEEP_PENDING"]
      };
    }
    const actions: CaptureDivergenceAction[] = ["CONFIRM_PRESENCE"];
    if (scheduledStatusKeys.has(status)) actions.push("CONFIRM_ABSENCE");
    if (dayOffStatusKeys.has(status)) actions.push("CONFIRM_DAY_OFF");
    actions.push("KEEP_PENDING");
    return { decision: "DIVERGENCE", reasons: ["SHORT_CAPTURE"], actions };
  }

  if (dayOffSaleStatusKeys.has(status)) {
    return { decision: "AUTOMATIC", targetScheduleStatus: "VENDA_FOLGA_APROVADA", reasons: [], actions: [] };
  }
  if (scheduledStatusKeys.has(status)) {
    return { decision: "AUTOMATIC", targetScheduleStatus: "PRESENTE", reasons: [], actions: [] };
  }
  if (recognizedAttendanceStatusKeys.has(status)) {
    return { decision: "AUTOMATIC", targetScheduleStatus: status, reasons: [], actions: [] };
  }
  return {
    decision: "DIVERGENCE",
    reasons: [dayOffStatusKeys.has(status) || isAbsenceStatus(status) ? "SCHEDULE_STATUS_REVIEW" : "UNSCHEDULED_CAPTURE"],
    actions: ["CONFIRM_PRESENCE", "KEEP_PENDING"]
  };
}

export function shouldCreateLowAdherence(capturedMs?: number | null) {
  return Boolean(capturedMs !== null && capturedMs !== undefined && capturedMs > 0 && capturedMs < LOW_ADHERENCE_THRESHOLD_MS);
}

// Reuse an explicit decision only for the exact capture and slot that was reviewed.
export function reuseCaptureResolution(input: {
  scheduleId: string | null;
  scheduleStatus: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  capturedMs: number | null;
}, resolved: {
  status: string;
  scheduleId: string | null;
  plannedStart: string | null;
  plannedEnd: string | null;
  sourceDurationMs: number | null;
  resolutionAction: string | null;
} | undefined): CaptureImportEvaluation | null {
  if (!resolved || resolved.status !== "RESOLVED" || !input.scheduleId
    || input.scheduleId !== resolved.scheduleId
    || input.plannedStart !== resolved.plannedStart || input.plannedEnd !== resolved.plannedEnd
    || input.capturedMs !== resolved.sourceDurationMs) return null;
  const targets: Record<string, string> = {
    CONFIRM_PRESENCE: "PRESENTE",
    CONFIRM_ATTENDANCE: "VENDA_FOLGA_APROVADA",
    CONFIRM_ABSENCE: "FALTA",
    CONFIRM_DAY_OFF: "FOLGA"
  };
  const target = targets[resolved.resolutionAction ?? ""];
  if (!target || input.scheduleStatus !== target) return null;
  if (target === "FALTA" || target === "FOLGA") return { decision: "IGNORE", reasons: [], actions: [] };
  if (!input.capturedMs || input.capturedMs <= 0) return null;
  return { decision: "AUTOMATIC", targetScheduleStatus: target, reasons: [], actions: [] };
}

export function captureDivergenceReasonLabel(reason: CaptureDivergenceReason) {
  const labels: Record<CaptureDivergenceReason, string> = {
    MISSING_CAPTURE: "Cronograma produtivo sem duração na Captura de Horas.",
    UNSCHEDULED_CAPTURE: "Há duração capturada sem um slot produtivo correspondente no Cronograma.",
    SHORT_CAPTURE: "A duração capturada é igual ou inferior a 2:00 e exige validação manual.",
    SCHEDULE_STATUS_REVIEW: "O status atual do Cronograma não permite reconhecer presença automaticamente."
  };
  return labels[reason];
}

export function captureDivergenceActionLabel(action: CaptureDivergenceAction) {
  const labels: Record<CaptureDivergenceAction, string> = {
    CONFIRM_PRESENCE: "Confirmar presença",
    CONFIRM_ATTENDANCE: "Confirmar comparecimento",
    CONFIRM_ABSENCE: "Confirmar falta",
    CONFIRM_DAY_OFF: "Confirmar folga",
    KEEP_PENDING: "Manter pendente"
  };
  return labels[action];
}

export function operationalHourRuleLabel(rule: OperationalHourRule) {
  const labels: Record<OperationalHourRule, string> = {
    RA_ONBOARDING: "RA/Onboarding: 8:00 fixas",
    BILINGUAL: "Bilíngue: captura limitada a 8:00",
    CEC_COMMENTS: "CEC/COMMENTS: mínimo de 8:00",
    STANDARD: "Demais agentes: captura + 0:30"
  };
  return labels[rule];
}

function isAbsenceStatus(status: string) {
  return ["AUSENTE", "FALTA", "FALTA_JUSTIFICADA", "FALTA_INJUSTIFICADA"].includes(status);
}

function roundHours(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
