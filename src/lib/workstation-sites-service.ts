import { Prisma } from "@prisma/client";
import type { Actor } from "@/lib/mock-db";
import { prisma } from "@/lib/prisma";
import { addDateKeyDays, saoPauloDateKey, startOfSaoPauloDate } from "@/lib/realtime-hours-timeline";
import { shiftCategoryName } from "@/lib/shift-display";
import { requireActivityViewer, visibleEmployeeIdsForViewer } from "@/lib/workstation-activity-query";
import { isSiteClassification, normalizeSiteDomain, siteConfigPrefix, type SiteClassification } from "@/lib/workstation-site-classification";

export type SiteUsage = {
  domain: string; classification: SiteClassification; seconds: number; segments: number;
  agents: number; lastActivityAt: string;
};
export type SiteAgentUsage = {
  domain: string; classification: SiteClassification; employeeName: string; wbLogin: string | null;
  agentKey: string; lob: string; shift: string; supervisor: string; seconds: number; segments: number;
};
type SiteResult = { sites: SiteUsage[]; byAgent: SiteAgentUsage[]; reportRows: number; filterOptions?: Array<{ lob: string; shift: string }> };
const fail = (error: string, status = 400) => ({ success: false as const, error, status });

export async function saveWorkstationSiteClassification(actor: Actor, input: unknown) {
  const access = await requireActivityViewer(actor);
  if (!access.success) return access;
  if (!input || typeof input !== "object") return fail("Classificação inválida.");
  const { domain: rawDomain, classification } = input as Record<string, unknown>;
  const domain = normalizeSiteDomain(rawDomain);
  if (!domain || !isSiteClassification(classification)) return fail("Informe um domínio e uma classificação válidos.");
  const value = { domain, classification, updatedBy: access.viewer.email, updatedAt: new Date().toISOString() };
  // One key per domain avoids overwriting another site's concurrent update.
  await prisma.systemConfig.upsert({
    where: { key: `${siteConfigPrefix}${domain}` },
    create: { key: `${siteConfigPrefix}${domain}`, value, description: "Classificação de produtividade do site nas Atividades" },
    update: { value }
  });
  return { success: true as const, domain, classification };
}

export async function getWorkstationSiteClassifications(actor: Actor) {
  const access = await requireActivityViewer(actor);
  if (!access.success) return access;
  const configs = await prisma.systemConfig.findMany({ where: { key: { startsWith: siteConfigPrefix } }, select: { key: true, value: true } });
  const classifications: Record<string, SiteClassification> = {};
  for (const config of configs) {
    const value = config.value as { classification?: unknown } | null;
    if (isSiteClassification(value?.classification)) classifications[config.key.slice(siteConfigPrefix.length)] = value.classification;
  }
  return { success: true as const, classifications };
}

export async function getWorkstationSites(actor: Actor, params: URLSearchParams) {
  const access = await requireActivityViewer(actor);
  if (!access.success) return access;
  const startDate = params.get("startDate") ?? saoPauloDateKey(new Date());
  const endDate = params.get("endDate") ?? startDate;
  const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
  if (!validDate(startDate) || !validDate(endDate) || endDate < startDate || (Date.parse(endDate) - Date.parse(startDate)) / 86400000 > 30) {
    return fail("Escolha um período válido de até 31 dias.");
  }
  const classification = params.get("classification") || "";
  if (classification && !isSiteClassification(classification)) return fail("Classificação inválida.");
  const start = startOfSaoPauloDate(startDate), end = startOfSaoPauloDate(addDateKeyDays(endDate, 1));
  const conditions: Prisma.Sql[] = [Prisma.sql`activity."sourceType" = 'WEB'`, Prisma.sql`activity."domain" IS NOT NULL`,
    Prisma.sql`activity."startedAt" < ${end}`, Prisma.sql`activity."endedAt" > ${start}`];
  const ids = await visibleEmployeeIdsForViewer(access.viewer);
  if (ids) conditions.push(ids.length ? Prisma.sql`activity."employeeId" IN (${Prisma.join(ids)})` : Prisma.sql`FALSE`);
  const agentKey = params.get("agentKey") || "";
  if (agentKey.startsWith("employee:")) conditions.push(Prisma.sql`activity."employeeId" = ${agentKey.slice(9)}`);
  else if (agentKey) conditions.push(Prisma.sql`activity."employeeId" IS NULL AND 'device:' || LOWER(activity."hostname") || '|' || LOWER(COALESCE(activity."windowsUser", '')) = ${agentKey}`);
  const filters: Prisma.Sql[] = [];
  const lob = (params.get("lob") || "").trim().slice(0, 120);
  const shift = (params.get("shift") || "").trim().slice(0, 120);
  if (lob) filters.push(Prisma.sql`lob = ${lob}`);
  if (shift) {
    const shifts = await prisma.shift.findMany({ select: { name: true } });
    const names = shifts.filter((item) => shiftCategoryName(item.name) === shiftCategoryName(shift)).map((item) => item.name);
    if (shiftCategoryName(shift) === "Sem turno") names.push("Sem turno");
    filters.push(names.length ? Prisma.sql`shift IN (${Prisma.join(names)})` : Prisma.sql`FALSE`);
  }
  const search = (params.get("search") || "").trim().slice(0, 120);
  // Search is by domain; agent selection is an explicit scoped filter.
  if (search) filters.push(Prisma.sql`domain ILIKE ${`%${search}%`}`);
  if (classification) filters.push(Prisma.sql`classification = ${classification}`);
  const report = params.get("export") === "xlsx";
  const [result] = await prisma.$queryRaw<SiteResult[]>(Prisma.sql`
    WITH usage AS MATERIALIZED (
      SELECT activity."domain", COALESCE(config."value"->>'classification', 'UNCLASSIFIED') AS classification,
        CASE WHEN activity."employeeId" IS NOT NULL THEN 'employee:' || activity."employeeId"
          ELSE 'device:' || LOWER(activity."hostname") || '|' || LOWER(COALESCE(activity."windowsUser", '')) END AS "agentKey",
        COALESCE(employee."fullName", activity."wbLogin", activity."windowsUser", activity."hostname") AS "employeeName",
        activity."wbLogin", COALESCE(lob."name", 'Sem LOB') AS lob, COALESCE(shift."name", 'Sem turno') AS shift,
        COALESCE(supervisor."fullName", 'Sem supervisor') AS supervisor,
        EXTRACT(EPOCH FROM (LEAST(activity."endedAt", ${end}) - GREATEST(activity."startedAt", ${start}))) AS seconds,
        LEAST(activity."endedAt", ${end}) AS "endedAt"
      FROM "agent_activity"."WorkstationActivitySegment" activity
      LEFT JOIN public."EmployeeProfile" employee ON employee.id = activity."employeeId"
      LEFT JOIN public."Lob" lob ON lob.id = employee."lobId"
      LEFT JOIN public."Shift" shift ON shift.id = employee."shiftId"
      LEFT JOIN public."EmployeeProfile" supervisor ON supervisor.id = employee."supervisorId"
      LEFT JOIN public."SystemConfig" config ON config.key = ${siteConfigPrefix} || activity.domain
      WHERE ${Prisma.join(conditions, " AND ")}
    ), filtered AS (SELECT * FROM usage ${filters.length ? Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}` : Prisma.empty}),
    sites AS (
      SELECT domain, classification, SUM(seconds)::float8 AS seconds, COUNT(*)::int AS segments,
        COUNT(DISTINCT "agentKey")::int AS agents,
        to_char(MAX("endedAt"), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "lastActivityAt"
      FROM filtered GROUP BY domain, classification
    )
    ${report ? Prisma.sql`, agent_usage AS (
      SELECT domain, classification, "agentKey", MIN("employeeName") AS "employeeName", MIN("wbLogin") AS "wbLogin",
        MIN(lob) AS lob, MIN(shift) AS shift, MIN(supervisor) AS supervisor,
        SUM(seconds)::float8 AS seconds, COUNT(*)::int AS segments
      FROM filtered GROUP BY domain, classification, "agentKey"
    )` : Prisma.empty}
    SELECT (SELECT COALESCE(jsonb_agg(sites ORDER BY seconds DESC, domain), '[]'::jsonb) FROM sites) AS sites,
      (SELECT COALESCE(jsonb_agg(options), '[]'::jsonb) FROM (SELECT DISTINCT lob, shift FROM usage) options) AS "filterOptions",
      ${report ? Prisma.sql`(SELECT COALESCE(jsonb_agg(bounded), '[]'::jsonb) FROM (SELECT * FROM agent_usage ORDER BY seconds DESC, domain, "agentKey" LIMIT 50001) bounded)` : Prisma.sql`'[]'::jsonb`} AS "byAgent",
      ${report ? Prisma.sql`(SELECT COUNT(*)::int FROM agent_usage)` : Prisma.sql`0`} AS "reportRows"
  `);
  if ((result?.reportRows ?? 0) > 50000) return fail("O relatório excede 50 mil linhas. Reduza o período ou filtre a equipe.", 422);
  const sites = result?.sites ?? [];
  const summary = { totalSeconds: 0, productiveSeconds: 0, unproductiveSeconds: 0, unclassifiedSeconds: 0, domains: sites.length };
  for (const site of sites) {
    summary.totalSeconds += site.seconds;
    summary[site.classification === "PRODUCTIVE" ? "productiveSeconds" : site.classification === "UNPRODUCTIVE" ? "unproductiveSeconds" : "unclassifiedSeconds"] += site.seconds;
  }
  const options = result?.filterOptions ?? [];
  const filterOptions = {
    lobs: Array.from(new Set(options.map((item) => item.lob))).sort((a, b) => a.localeCompare(b, "pt-BR")),
    shifts: Array.from(new Set(options.map((item) => shiftCategoryName(item.shift)))).sort((a, b) => a.localeCompare(b, "pt-BR"))
  };
  return { success: true as const, startDate, endDate, sites, summary, filterOptions, byAgent: result?.byAgent ?? [],
    filters: { lob, shift, search, classification: classification as SiteClassification | "", agentKey } };
}
