import type { AdsOnlineProductivityReportSnapshot } from "./ads-online-productivity-report-core";

export const ONLINE_PRODUCTIVITY_IMAGE_WIDTH = 1600;
export const ONLINE_PRODUCTIVITY_MAX_IMAGE_HEIGHT = 3200;
export const ONLINE_PRODUCTIVITY_ROW_HEIGHT = 80;
export const ONLINE_PRODUCTIVITY_MIN_IMAGE_HEIGHT = 1400;
export const ONLINE_PRODUCTIVITY_FIXED_HEIGHT = 760;
export const ONLINE_PRODUCTIVITY_SKILL_CARDS_PER_ROW = 4;
export const ONLINE_PRODUCTIVITY_SKILL_CARD_HEIGHT = 104;
export const ONLINE_PRODUCTIVITY_SKILL_CARD_GAP = 14;
const MAX_SKILL_CARDS_PER_PAGE = 12;

export type OnlineProductivityReportPage = {
  report: AdsOnlineProductivityReportSnapshot;
  pageNumber: number;
  pageCount: number;
  rowOffset: number;
  totalRows: number;
  maxSubmit: number;
  height: number;
};

function skillSectionHeight(skillCount: number) {
  const rows = Math.ceil(skillCount / ONLINE_PRODUCTIVITY_SKILL_CARDS_PER_ROW);
  return rows ? 49 + rows * ONLINE_PRODUCTIVITY_SKILL_CARD_HEIGHT + Math.max(0, rows - 1) * ONLINE_PRODUCTIVITY_SKILL_CARD_GAP : 0;
}

export function onlineProductivityImageHeight(rowCount: number, skillCount: number) {
  return Math.max(ONLINE_PRODUCTIVITY_MIN_IMAGE_HEIGHT, ONLINE_PRODUCTIVITY_FIXED_HEIGHT + skillSectionHeight(skillCount) + rowCount * ONLINE_PRODUCTIVITY_ROW_HEIGHT);
}

/** Split display rows only; global totals/averages and ranking remain unchanged. */
export function paginateOnlineProductivityReport(report: AdsOnlineProductivityReportSnapshot): OnlineProductivityReportPage[] {
  const pages: OnlineProductivityReportPage[] = [];
  const maxSubmit = report.rows.reduce((maximum, row) => Math.max(maximum, row.currentSubmit), 1);
  let rowOffset = 0, skillOffset = 0;
  do {
    const skillAverages = report.skillAverages.slice(skillOffset, skillOffset + MAX_SKILL_CARDS_PER_PAGE);
    const rowCapacity = Math.floor((ONLINE_PRODUCTIVITY_MAX_IMAGE_HEIGHT - ONLINE_PRODUCTIVITY_FIXED_HEIGHT - skillSectionHeight(skillAverages.length)) / ONLINE_PRODUCTIVITY_ROW_HEIGHT);
    const rows = report.rows.slice(rowOffset, rowOffset + rowCapacity);
    pages.push({
      report: { ...report, rows, skillAverages },
      pageNumber: pages.length + 1,
      pageCount: 0,
      rowOffset,
      totalRows: report.rows.length,
      maxSubmit,
      height: onlineProductivityImageHeight(rows.length, skillAverages.length)
    });
    rowOffset += rows.length;
    skillOffset += skillAverages.length;
  } while (rowOffset < report.rows.length || skillOffset < report.skillAverages.length);
  for (const page of pages) page.pageCount = pages.length;
  return pages;
}

export function onlineProductivityPageDelivery(baseFileName: string, baseIdempotencyKey: string, page: Pick<OnlineProductivityReportPage, "pageNumber" | "pageCount">) {
  if (page.pageCount === 1) return { fileName: baseFileName, idempotencyKey: baseIdempotencyKey };
  const suffix = `page-${page.pageNumber}-of-${page.pageCount}`;
  return {
    fileName: baseFileName.replace(/\.png$/i, `_${suffix}.png`),
    idempotencyKey: `${baseIdempotencyKey}:${suffix}`
  };
}
