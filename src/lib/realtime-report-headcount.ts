type ReportHeadcountRow = {
  presenceStatus: string;
  isSchedulePresent?: boolean;
};

export function isReportOnlineHeadcountRow(row: ReportHeadcountRow) {
  return row.presenceStatus === "Online";
}

export function isExecutivePresentHeadcountRow(row: ReportHeadcountRow) {
  return Boolean(row.isSchedulePresent) || row.presenceStatus === "Online";
}
