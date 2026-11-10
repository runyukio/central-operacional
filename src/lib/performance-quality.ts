export const QUALITY_LOBS = ["ADS", "TNS", "VIDEO", "COMMENTS", "CEC"] as const;
export type QualityLob = typeof QUALITY_LOBS[number];

export const QUALITY_CATEGORIES = ["PUSH", "USER", "COMMENTS", "VIDEO"] as const;
export type QualityCategory = typeof QUALITY_CATEGORIES[number];
export const QUALITY_CATEGORY_LABELS: Record<QualityCategory, string> = {
  PUSH: "Push", USER: "User", COMMENTS: "Comments", VIDEO: "Video"
};

// Quality categories are defined by the audited queue, independently of the agent's LOB.
export const QUALITY_CATEGORY_QUEUE_IDS: Record<QualityCategory, readonly string[]> = {
  COMMENTS: ["600001300", "600001295", "600001305", "600001312", "600001306", "600001311", "600001199", "600001263", "600000970", "600000615", "2538", "3701", "5121", "5130"],
  USER: ["600001275", "600001276", "600001260"],
  PUSH: ["5486", "5487", "6992", "600001428", "8571", "8572", "600001812"],
  VIDEO: ["5860", "11364", "9550", "9551", "9553", "7338"]
};

export function isTnsQualityLob(lob: string) {
  return lob === "TNS" || lob === "VIDEO" || lob === "COMMENTS";
}

export function readQualityLob(value: string | null | undefined): QualityLob {
  return QUALITY_LOBS.find((lob) => lob === value) ?? "ADS";
}

export function readQualityCategory(value: string | null | undefined): QualityCategory | undefined {
  return QUALITY_CATEGORIES.find((category) => category === value?.toUpperCase());
}

export function readPerformanceQualityParams(params: URLSearchParams) {
  const view = params.get("view");
  const sort = params.get("sortDirection");
  return {
    startDate: params.get("startDate") ?? undefined,
    endDate: params.get("endDate") ?? undefined,
    lob: readQualityLob(params.get("lob")),
    category: readQualityCategory(params.get("category")),
    view: view === "monthly" || view === "weekly" || view === "daily" ? view : undefined,
    sortDirection: sort === "asc" || sort === "desc" ? sort : undefined
  } as const;
}

export function normalizeQualityQueueId(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!/^\d+(?:\.0+)?$/.test(raw)) return null;
  return raw.replace(/\.0+$/, "");
}

export function filterQualityAgents<T extends { employeeName: string; wbLogin: string; supervisor: string }>(agents: T[], search: string): T[] {
  const term = search.trim().toLocaleLowerCase("pt-BR");
  return term ? agents.filter((agent) => [agent.employeeName, agent.wbLogin, agent.supervisor]
    .some((value) => value.toLocaleLowerCase("pt-BR").includes(term))) : agents;
}
