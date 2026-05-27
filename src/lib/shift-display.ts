const shiftAliasByKey: Record<string, string> = {
  MANHA: "Manhã",
  TARDE: "Tarde",
  NOITE: "Noite",
  FOLGA: "Folga"
};

const blockedShiftKeys = new Set(["FERIAS", "PLANTAO"]);
const noShiftKeys = new Set(["SEM_TURNO", "SEM_SHIFT", "SEM_ESCALA", "SEM_CRONOGRAMA", "NO_SHIFT", "NONE", "NULL"]);

export const standardShiftNames = ["Manhã", "Tarde", "Noite", "Folga"] as const;

export function shiftLookupKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase()
    .replace(/[\s/-]+/g, "_");
}

export function cleanShiftName(value?: string | null) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const withoutTimeSuffix = raw.replace(/\s*\([^)]*\)\s*$/g, "").trim();
  return shiftAliasByKey[shiftLookupKey(withoutTimeSuffix)] ?? withoutTimeSuffix;
}

export function shiftCategoryName(value?: string | null) {
  const clean = cleanShiftName(value);
  if (!clean) return "";
  const key = shiftLookupKey(clean);
  if (noShiftKeys.has(key)) return "Sem turno";
  if (key.startsWith("MANHA")) return "Manhã";
  if (key.startsWith("TARDE")) return "Tarde";
  if (key.startsWith("NOITE")) return "Noite";
  if (key.startsWith("FOLGA")) return "Folga";
  return clean;
}

export function isNoShiftFilter(value?: string | null) {
  return shiftCategoryName(value) === "Sem turno";
}

export function isBlockedShiftName(value?: string | null) {
  const clean = cleanShiftName(value);
  return !clean || blockedShiftKeys.has(shiftLookupKey(clean));
}

export function isSelectableShiftName(value?: string | null) {
  return Boolean(cleanShiftName(value)) && !isBlockedShiftName(value);
}

export function cleanShiftOptions(values: Array<string | null | undefined> = [], includeStandard = true) {
  const seen = new Set<string>();
  const options: string[] = [];
  const add = (value?: string | null) => {
    const clean = cleanShiftName(value);
    if (!clean || isBlockedShiftName(clean) || seen.has(clean)) return;
    seen.add(clean);
    options.push(clean);
  };
  if (includeStandard) standardShiftNames.forEach(add);
  values.forEach(add);
  return options;
}
