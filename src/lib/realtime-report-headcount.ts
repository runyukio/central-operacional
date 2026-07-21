export type ReportPresenceStatus = "Online" | "Tela bloqueada" | "Ocioso" | "Offline";

type ReportHeadcountRow = {
  presenceStatus: ReportPresenceStatus;
  isSchedulePresent: boolean;
};

export function isReportOnlineHeadcountRow(row: ReportHeadcountRow) {
  return row.isSchedulePresent
    || row.presenceStatus === "Online"
    || row.presenceStatus === "Tela bloqueada"
    || row.presenceStatus === "Ocioso";
}
