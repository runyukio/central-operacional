export const DAY_OFF_REQUEST_START = "2026-10-01";
export const DAY_OFF_REQUEST_END = "2026-11-30";
export const DAY_OFF_OCTOBER_END = "2026-10-31";
export const DAY_OFF_REQUEST_NOTICE = "Outubro de 2026: todas as movimentações de folga disponíveis. Novembro de 2026: apenas troca casada e venda de folga.";

type DayOffRequest = {
  type?: string;
  dayOffKind?: string;
  currentDayOffDate?: string;
  desiredDayOffDate?: string;
  dayOffToSellDate?: string;
  desiredDayOffRequestDate?: string;
  requestedDate?: string;
};

function kindFromType(type = "") {
  const normalized = type.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/troca casada/.test(normalized)) return "PAIRED_DAY_OFF_SWAP";
  if (/venda de folga|vender folga/.test(normalized)) return "DAY_OFF_SELL";
  if (/troca de folga|trocar folga/.test(normalized)) return "DAY_OFF_SWAP";
  if (/solicitacao de (dia de )?folga|dia de folga|folga solicitada|pedido de folga/.test(normalized)) return "DAY_OFF_REQUEST";
  return null;
}

function isAllowedDate(date: string | undefined, end: string) {
  if (!date || !/^2026-(10|11)-\d{2}$/.test(date) || date < DAY_OFF_REQUEST_START || date > end) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

// Applied only when creating requests; existing requests keep their approval flow.
export function validateDayOffRequestPolicy(input: DayOffRequest) {
  const typeKind = kindFromType(input.type);
  if (typeKind && input.dayOffKind && typeKind !== input.dayOffKind) {
    return "O tipo da solicitação não corresponde à movimentação de folga informada.";
  }
  const kind = typeKind ?? input.dayOffKind;
  if (kind === "DAY_OFF_SWAP" && (!isAllowedDate(input.currentDayOffDate, DAY_OFF_OCTOBER_END) || !isAllowedDate(input.desiredDayOffDate, DAY_OFF_OCTOBER_END))) {
    return "A troca simples de folga está disponível apenas para datas de outubro de 2026. Em novembro, utilize troca casada.";
  }
  if (kind === "DAY_OFF_REQUEST" && !isAllowedDate(input.desiredDayOffRequestDate || input.desiredDayOffDate || input.requestedDate, DAY_OFF_OCTOBER_END)) {
    return "A solicitação de dia de folga está disponível apenas para datas de outubro de 2026.";
  }
  if (kind === "PAIRED_DAY_OFF_SWAP" && (!isAllowedDate(input.currentDayOffDate, DAY_OFF_REQUEST_END) || !isAllowedDate(input.desiredDayOffDate, DAY_OFF_REQUEST_END))) {
    return "As duas datas da troca casada devem estar entre 1º de outubro e 30 de novembro de 2026.";
  }
  if (kind === "DAY_OFF_SELL" && !isAllowedDate(input.dayOffToSellDate, DAY_OFF_REQUEST_END)) {
    return "A data da venda de folga deve estar entre 1º de outubro e 30 de novembro de 2026.";
  }
  return "";
}
