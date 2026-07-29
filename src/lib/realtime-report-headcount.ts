type ReportHeadcountRow = {
  presenceStatus: string;
  isSchedulePresent?: boolean;
};

const activePresenceStatuses = new Set(["Online", "Tela bloqueada", "Ocioso"]);

export function isReportOnlineHeadcountRow(row: ReportHeadcountRow) {
  // A pausa pode deixar a estação bloqueada, ociosa ou temporariamente sem
  // heartbeat. Enquanto a presença estiver confirmada no cronograma, o agente
  // continua compondo o headcount do report.
  return Boolean(row.isSchedulePresent) || activePresenceStatuses.has(row.presenceStatus);
}

export function isExecutivePresentHeadcountRow(row: ReportHeadcountRow) {
  return isReportOnlineHeadcountRow(row);
}
