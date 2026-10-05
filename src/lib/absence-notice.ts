// The supervisor evaluates the notice window; it is never inferred from dates.
export function absenceNoticeLabel(value?: boolean | null) {
  return value === true ? "Sim" : value === false ? "Não" : "Não informado";
}

export function requiresAbsenceNotice(status: string) {
  return ["Falta", "Falta Justificada", "Falta Injustificada", "FALTA", "FALTA_JUSTIFICADA", "FALTA_INJUSTIFICADA"].includes(status);
}

export const ABSENCE_NOTICE_REQUIRED = "Informe Sim ou Não para o aviso dentro de 48h.";
