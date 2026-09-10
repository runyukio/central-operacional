export type SpaceKpiId = "quality" | "materialDaily" | "abs" | "aht" | "latency" | "commentsLatency" | "cpd" | "normalFrt" | "urgentFrt" | "ur";
export type MetricWeight = { numerator: number; denominator: number };
export type SpaceWeights = Partial<Record<SpaceKpiId, MetricWeight>>;
export type SpaceTarget = { id: SpaceKpiId; label: string; target: number; direction: "min" | "max"; unit: string; scale: number; weightLabel: string; bounded?: boolean };
export type SpaceKpi = SpaceTarget & { value: number | null; met: boolean | null; gap: number | null };

export function spaceTargets(lob: string): SpaceTarget[] {
  if (!["ADS", "TNS", "CEC"].includes(lob)) return [];
  const quality: SpaceTarget = { id: "quality", label: "Qualidade", target: lob === "TNS" ? 98 : 95, direction: "min", unit: "%", scale: 100, weightLabel: "avaliações", bounded: true };
  const abs: SpaceTarget = { id: "abs", label: "ABS do time", target: 7.5, direction: "max", unit: "%", scale: 100, weightLabel: "dias-parceiro escalados", bounded: true };
  const ur: SpaceTarget = { id: "ur", label: "UR · Utilização", target: 60, direction: "min", unit: "%", scale: 100, weightLabel: "horas de escala (8h por dia-parceiro)" };
  if (lob === "CEC") return [quality, ur,
    { id: "cpd", label: "CPD médio da operação", target: 100, direction: "min", unit: "tickets/dia-parceiro", scale: 1, weightLabel: "dias-parceiro com produção positiva" }, abs,
    { id: "normalFrt", label: "SLA/FRT · Normal", target: 97, direction: "min", unit: "%", scale: 100, weightLabel: "primeiras respostas Normal >0", bounded: true },
    { id: "urgentFrt", label: "SLA/FRT · P0 + HM", target: 97, direction: "min", unit: "%", scale: 100, weightLabel: "primeiras respostas P0 + HM >0", bounded: true }];
  return [quality, ur,
    { id: "aht", label: lob === "TNS" ? "AHT · vídeo 15 min" : "AHT ADS", target: lob === "TNS" ? 50 : 60, direction: "max", unit: "s", scale: 1, weightLabel: "submits das filas elegíveis" }, abs,
    { id: "latency", label: lob === "TNS" ? "Latência · vídeo 15 min" : "Latência média ADS", target: lob === "TNS" ? 15 : 2, direction: "max", unit: lob === "TNS" ? "min" : "h", scale: lob === "TNS" ? 1 : 1 / 60, weightLabel: "submits com latência válida" },
    ...(lob === "TNS" ? [{ id: "commentsLatency" as const, label: "Latência · Comments", target: 24, direction: "max" as const, unit: "h", scale: 1 / 60, weightLabel: "submits Comments com latência válida" }] :
      [{ id: "materialDaily" as const, label: "Média diária · Material Queues", target: 300, direction: "min" as const, unit: "submits/dia-parceiro", scale: 1, weightLabel: "dias-parceiro Material Queues com base" }])];
}

export function assessSpaceTarget(target: SpaceTarget, weight?: MetricWeight): SpaceKpi {
  const valid = weight && Number.isFinite(weight.numerator) && Number.isFinite(weight.denominator) && weight.denominator > 0;
  const value = valid ? weight.numerator / weight.denominator * target.scale : null;
  const gap = value === null ? null : Math.max(0, target.direction === "min" ? target.target - value : value - target.target);
  return { ...target, value, gap, met: gap === null ? null : gap <= 1e-10 };
}

export function isSpaceMaterialSkill(skill: string | null | undefined) {
  return String(skill ?? "").trim().toLowerCase().replace(/\s+/g, " ") === "material queues";
}

export function addMetricWeights(weights: Array<MetricWeight | undefined>): MetricWeight {
  return weights.reduce<MetricWeight>((sum, value) => ({ numerator: sum.numerator + (value?.numerator ?? 0), denominator: sum.denominator + (value?.denominator ?? 0) }), { numerator: 0, denominator: 0 });
}
