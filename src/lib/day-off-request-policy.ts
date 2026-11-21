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

function isValidDate(date?: string): date is string {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
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
  if (kind === "DAY_OFF_SWAP" && (!isValidDate(input.currentDayOffDate) || !isValidDate(input.desiredDayOffDate))) {
    return "Informe duas datas válidas para a troca de folga.";
  }
  if (kind === "DAY_OFF_REQUEST" && !isValidDate(input.desiredDayOffRequestDate || input.desiredDayOffDate || input.requestedDate)) {
    return "Informe uma data válida para a solicitação de folga.";
  }
  if (kind === "PAIRED_DAY_OFF_SWAP" && (!isValidDate(input.currentDayOffDate) || !isValidDate(input.desiredDayOffDate))) {
    return "Informe duas datas válidas para a troca casada.";
  }
  if (kind === "DAY_OFF_SELL" && !isValidDate(input.dayOffToSellDate)) {
    return "Informe uma data válida para a venda de folga.";
  }
  return "";
}
