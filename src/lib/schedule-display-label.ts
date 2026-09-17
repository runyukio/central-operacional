/** Presentation only: keep legacy status/reason values in storage and requests. */
const scheduleDisplayLabels: Readonly<Record<string, string>> = {
  Escalado: "No cronograma",
  "Sem escala": "Sem cronograma",
  "Não escalado": "Sem cronograma",
  "Erro de escala": "Erro de cronograma",
  "Erro de programação de escala": "Erro de programação de cronograma",
  "Erro de visualização de escala": "Erro de visualização de cronograma"
};

export function scheduleDisplayLabel(value: string): string {
  return Object.prototype.hasOwnProperty.call(scheduleDisplayLabels, value) ? scheduleDisplayLabels[value] : value;
}

/** Accept the new template label without changing the canonical stored status. */
export function scheduleImportStatusValue(value: string): string {
  return value.trim().toLowerCase() === "no cronograma" ? "Escalado" : value;
}
