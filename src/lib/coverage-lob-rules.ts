function normalizeLob(value?: string | null) {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

export function isProjectExcludedFromAdsCoverage(employeeLob?: string | null, coverageLob?: string | null) {
  return normalizeLob(employeeLob) === "PROJECT" && normalizeLob(coverageLob) === "ADS";
}
