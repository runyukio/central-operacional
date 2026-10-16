export const DAY_OFF_REQUEST_START = "2026-11-01";
export const DAY_OFF_REQUEST_END = "2026-11-30";
export const DAY_OFF_REQUEST_NOTICE = "Disponíveis apenas troca casada e venda de folga, para datas de 1º a 30 de novembro de 2026.";

type DayOffRequest = {
  type?: string;
  dayOffKind?: string;
  currentDayOffDate?: string;
  desiredDayOffDate?: string;
  dayOffToSellDate?: string;
};

function kindFromType(type = "") {
  const normalized = type.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/troca casada/.test(normalized)) return "PAIRED_DAY_OFF_SWAP";
  if (/venda de folga|vender folga/.test(normalized)) return "DAY_OFF_SELL";
  if (/troca de folga|trocar folga/.test(normalized)) return "DAY_OFF_SWAP";
  if (/solicitacao de (dia de )?folga|dia de folga|folga solicitada|pedido de folga/.test(normalized)) return "DAY_OFF_REQUEST";
  return null;
}

export function isDayOffRequestCreationEnabled(type: string) {
  const kind = kindFromType(type);
  return kind !== "DAY_OFF_SWAP" && kind !== "DAY_OFF_REQUEST";
}

function isNovemberDate(date?: string) {
  return Boolean(date && /^2026-11-\d{2}$/.test(date) && date >= DAY_OFF_REQUEST_START && date <= DAY_OFF_REQUEST_END);
}

// Applied only when creating requests; existing requests keep their approval flow.
export function validateDayOffRequestPolicy(input: DayOffRequest) {
  const typeKind = kindFromType(input.type);
  const kinds = [typeKind, input.dayOffKind];
  if (kinds.some(kind => kind === "DAY_OFF_SWAP" || kind === "DAY_OFF_REQUEST")) {
    return "Troca simples de folga e solicitação de dia de folga estão desabilitadas. " + DAY_OFF_REQUEST_NOTICE;
  }
  if (typeKind && input.dayOffKind && typeKind !== input.dayOffKind) {
    return "O tipo da solicitação não corresponde à movimentação de folga informada.";
  }
  if (kinds.includes("PAIRED_DAY_OFF_SWAP") && (!isNovemberDate(input.currentDayOffDate) || !isNovemberDate(input.desiredDayOffDate))) {
    return "As duas datas da troca casada devem estar entre 1º e 30 de novembro de 2026.";
  }
  if (kinds.includes("DAY_OFF_SELL") && !isNovemberDate(input.dayOffToSellDate)) {
    return "A data da venda de folga deve estar entre 1º e 30 de novembro de 2026.";
  }
  return "";
}
