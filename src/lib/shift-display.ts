const shiftAliasByKey: Record<string, string> = {
  MANHA: "Manhã",
  TARDE: "Tarde",
  NOITE: "Noite",
  FOLGA: "Folga"
};

const blockedShiftKeys = new Set(["FERIAS", "PLANTAO"]);

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
