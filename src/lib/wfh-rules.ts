export type WfhEligibilityStatus = "QUALIFIED" | "PENDING_VALIDATION" | "NOT_QUALIFIED" | "NOT_APPLICABLE" | "INSUFFICIENT_DATA";
export type WfhMonitoringStatus = "NOT_MONITORED" | "AT_RISK" | "RETURN_REQUIRED";
export type WfhRuleCode = "ADS_TNS_WFH" | "CEC_WFH" | "NOT_APPLICABLE";

export type WfhMetrics = {
  quality: number;
  qualityDenominator: number;
  submit: number;
  ahtSeconds: number;
  abs: number;
  scheduledDays: number;
  unjustifiedAbsences: number;
};

export type WfhWeeklyMetrics = WfhMetrics & {
  weekStart: string;
  weekEnd: string;
};

export type WfhEmployeeContext = {
  lob: string;
  admissionDate?: Date | null;
  hasDisciplinaryIncidentData?: boolean;
  disciplinaryIncidentsLast30Days?: number | null;
  hasSlaData?: boolean;
  slaCompliance?: number | null;
  hasCurrentWfhStatusData?: boolean;
  isCurrentlyWfh?: boolean;
};

export type WfhResult = {
  wfhStatus: WfhEligibilityStatus;
  wfhStatusLabel: string;
  wfhMonitoringStatus: WfhMonitoringStatus;
  wfhMonitoringLabel: string;
  wfhRule: WfhRuleCode;
  wfhFailedCriteria: string[];
  wfhReasons: string[];
};

export function calculateWfhStatus(context: WfhEmployeeContext, metrics: WfhMetrics, weekly: WfhWeeklyMetrics[], referenceDate: Date): WfhResult {
  const lob = normalizeLob(context.lob);
  if (lob !== "ads" && lob !== "tns" && lob !== "cec") {
    return result("NOT_APPLICABLE", "NOT_MONITORED", "NOT_APPLICABLE", ["LOB não aplicável para WFH"]);
  }
  return lob === "cec" ? calculateCecWfh(context, metrics, weekly) : calculateAdsTnsWfh(metrics, weekly);
}

function calculateAdsTnsWfh(metrics: WfhMetrics, weekly: WfhWeeklyMetrics[]): WfhResult {
  const reasons: string[] = [];
  const insufficient: string[] = [];
  if (!isValid(metrics.quality) || metrics.qualityDenominator <= 0) insufficient.push("Dados insuficientes de qualidade");
  else if (metrics.quality < 95) reasons.push("Qualidade abaixo do target (95%)");
  if (!isValid(metrics.submit)) insufficient.push("Dados insuficientes de produtividade");
  else if (metrics.submit < 350) reasons.push("Produtividade abaixo do target (350/dia)");
  if (!isValid(metrics.ahtSeconds)) insufficient.push("Dados insuficientes de AHT");
  else if (metrics.ahtSeconds > 60) reasons.push("AHT acima do target (60s)");
  addAbsenceReasons(metrics, reasons, insufficient);
  const monitoring = adsMonitoringStatus({ lob: "", hasCurrentWfhStatusData: false }, weekly);
  return result(adsTnsStatus(metrics, reasons, insufficient), monitoring.status, "ADS_TNS_WFH", [...reasons, ...insufficient]);
}

function calculateCecWfh(context: WfhEmployeeContext, metrics: WfhMetrics, weekly: WfhWeeklyMetrics[]): WfhResult {
  const reasons: string[] = [];
  const insufficient: string[] = [];
  if (!isValid(metrics.quality) || metrics.qualityDenominator <= 0) insufficient.push("Dados insuficientes de qualidade CEC");
  else if (metrics.quality < 90) reasons.push("Qualidade abaixo do target CEC (90%)");
  if (!isValid(metrics.submit)) insufficient.push("Dados insuficientes de produtividade CEC");
  else if (metrics.submit < 70) reasons.push("Produtividade abaixo do target CEC (70 CPD)");
  addAbsenceReasons(metrics, reasons, insufficient);
  const monitoring = cecMonitoringStatus(context, weekly);
  return result(statusForReasons(reasons, insufficient), monitoring.status, "CEC_WFH", [...reasons, ...insufficient]);
}

function addAbsenceReasons(metrics: WfhMetrics, reasons: string[], insufficient: string[]) {
  if (!isValid(metrics.abs)) insufficient.push("Dados insuficientes de ABS");
  else if (metrics.abs > 5) reasons.push("ABS acima do target (5%)");
}

function adsMonitoringStatus(context: WfhEmployeeContext, weekly: WfhWeeklyMetrics[]) {
  const reasons: string[] = [];
  if (!context.hasCurrentWfhStatusData || !context.isCurrentlyWfh) return { status: "NOT_MONITORED" as const, reasons: ["Status atual de WFH não conectado"] };
  const lastWeek = lastWeeksWithData(weekly, 1)[0];
  if (lastWeek?.submit != null && lastWeek.submit < 350) reasons.push("Retorno necessário: produtividade ADS abaixo de 350/dia por 1 semana");
  if (lastWeek?.ahtSeconds != null && lastWeek.ahtSeconds > 50) reasons.push("Retorno necessário: AHT ADS acima de 50s por 1 semana");
  if (weekly.some((week) => week.qualityDenominator > 0 && week.quality < 95)) reasons.push("Retorno imediato: qualidade ADS abaixo de 95%");
  if (weekly.some((week) => week.unjustifiedAbsences > 0)) reasons.push("Retorno imediato: ausência injustificada em WFH");
  return { status: reasons.length ? "RETURN_REQUIRED" as const : "NOT_MONITORED" as const, reasons };
}

function cecMonitoringStatus(context: WfhEmployeeContext, weekly: WfhWeeklyMetrics[]) {
  const reasons: string[] = [];
  if (!context.hasCurrentWfhStatusData || !context.isCurrentlyWfh) return { status: "NOT_MONITORED" as const, reasons: ["Status atual de WFH não conectado"] };
  const lastWeek = lastWeeksWithData(weekly, 1)[0];
  if (lastWeek?.submit != null && lastWeek.submit < 90) reasons.push("Retorno necessário: produtividade CEC abaixo de 90/dia por 1 semana");
  if (weekly.some((week) => week.qualityDenominator > 0 && week.quality < 95)) reasons.push("Retorno imediato: qualidade CEC abaixo de 95%");
  if (weekly.some((week) => week.unjustifiedAbsences > 0)) reasons.push("Retorno imediato: ausência injustificada em WFH");
  if (!context.hasSlaData) reasons.push("Monitoramento de SLA CEC em 4h não conectado");
  return { status: reasons.some((item) => item.startsWith("Retorno")) ? "RETURN_REQUIRED" as const : "NOT_MONITORED" as const, reasons };
}

function statusForReasons(reasons: string[], insufficient: string[]): WfhEligibilityStatus {
  if (insufficient.length) return "INSUFFICIENT_DATA";
  return reasons.length ? "NOT_QUALIFIED" : "QUALIFIED";
}

function adsTnsStatus(metrics: WfhMetrics, reasons: string[], insufficient: string[]): WfhEligibilityStatus {
  if (insufficient.length) return "INSUFFICIENT_DATA";
  const qualityOk = metrics.quality >= 95;
  const ahtOk = metrics.ahtSeconds <= 60;
  const absOk = metrics.abs <= 5;
  const submitOk = metrics.submit >= 350;
  if (qualityOk && ahtOk && absOk && submitOk) return "QUALIFIED";
  if (qualityOk && ahtOk && absOk && !submitOk) return "PENDING_VALIDATION";
  return reasons.length ? "NOT_QUALIFIED" : "QUALIFIED";
}

function result(wfhStatus: WfhEligibilityStatus, monitoringStatus: WfhMonitoringStatus, rule: WfhRuleCode, reasons: string[]): WfhResult {
  return {
    wfhStatus,
    wfhStatusLabel: eligibilityLabel(wfhStatus),
    wfhMonitoringStatus: monitoringStatus,
    wfhMonitoringLabel: monitoringLabel(monitoringStatus),
    wfhRule: rule,
    wfhFailedCriteria: reasons,
    wfhReasons: reasons
  };
}

function eligibilityLabel(status: WfhEligibilityStatus) {
  if (status === "QUALIFIED") return "Qualificado para Home";
  if (status === "PENDING_VALIDATION") return "Aguardando Validação";
  if (status === "NOT_QUALIFIED") return "Não Qualificado para Home";
  if (status === "INSUFFICIENT_DATA") return "Dados insuficientes";
  return "N/A";
}

function monitoringLabel(status: WfhMonitoringStatus) {
  if (status === "RETURN_REQUIRED") return "Retorno necessário";
  if (status === "AT_RISK") return "Em risco";
  return "Não monitorado";
}

function weightedQuality(weeks: WfhWeeklyMetrics[]) {
  const numerator = weeks.reduce((sum, week) => sum + (week.qualityDenominator * week.quality) / 100, 0);
  const denominator = weeks.reduce((sum, week) => sum + week.qualityDenominator, 0);
  return { value: denominator > 0 ? (numerator / denominator) * 100 : Number.NaN, denominator };
}

function lastWeeksWithData(weekly: WfhWeeklyMetrics[], count: number) {
  return [...weekly].sort((a, b) => a.weekStart.localeCompare(b.weekStart)).slice(-count);
}

function isValid(value: number) {
  return Number.isFinite(value);
}

function normalizeLob(value: string) {
  const lob = value.trim().toLowerCase();
  if (lob === "project") return "ads";
  if (lob === "video" || lob === "comments") return "tns";
  return lob;
}
