export const equipmentUsageLabels = {
  AGENTE: "Agente",
  STAFF: "Staff",
  TREINAMENTO: "Treinamento"
} as const;

export type EquipmentUsageValue = keyof typeof equipmentUsageLabels;

export function normalizeEquipmentUsage(value: string): EquipmentUsageValue | null {
  const key = value.trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(equipmentUsageLabels, key)
    ? key as EquipmentUsageValue
    : null;
}
