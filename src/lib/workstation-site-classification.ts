export const siteClassifications = ["PRODUCTIVE", "UNPRODUCTIVE", "UNCLASSIFIED"] as const;
export type SiteClassification = (typeof siteClassifications)[number];
export const siteClassificationLabels: Record<SiteClassification, string> = {
  PRODUCTIVE: "Produtivo", UNPRODUCTIVE: "Improdutivo", UNCLASSIFIED: "Sem classificação"
};
export const siteConfigPrefix = "workstation-site:";

export function isSiteClassification(value: unknown): value is SiteClassification {
  return siteClassifications.includes(value as SiteClassification);
}

export function normalizeSiteDomain(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim() || value.length > 2048) return null;
  try {
    const url = new URL(value.includes("://") ? value.trim() : `https://${value.trim()}`);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    const domain = url.hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
    if (domain.length > 253 || !domain.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return null;
    return domain;
  } catch { return null; }
}
