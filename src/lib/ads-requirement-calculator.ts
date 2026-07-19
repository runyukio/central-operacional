export const ADS_REQUIREMENT_FORECAST_DAYS = 14;
export const ADS_REQUIREMENT_SHRINKAGE_FACTOR = 1.0625;
export const ADS_REQUIREMENT_BUFFER = 3;

export type AdsRequirementShift = "Manhã" | "Tarde" | "Noite";

export type AdsHourlyVolume = {
  at: Date;
  volume: number;
};

export type AdsShiftRequirement = {
  date: string;
  shift: AdsRequirementShift;
  required: number;
  peakHour: string;
  peakRollingVolume: number;
};

const hourMs = 60 * 60 * 1000;
const dayMs = 24 * hourMs;

export function calculateAdsHourlyRequirement(rollingVolume: number, ahtSeconds: number) {
  if (!Number.isFinite(rollingVolume) || rollingVolume < 0) throw new Error("Volume ADS inválido.");
  if (!Number.isFinite(ahtSeconds) || ahtSeconds <= 0) throw new Error("AHT ADS inválido.");
  return Math.ceil((rollingVolume * ahtSeconds / 3600) * ADS_REQUIREMENT_SHRINKAGE_FACTOR + ADS_REQUIREMENT_BUFFER);
}

export function buildAdsShiftRequirements(input: {
  startDate: Date;
  hourlyVolumes: AdsHourlyVolume[];
  ahtSeconds: number;
  days?: number;
}): AdsShiftRequirement[] {
  const days = input.days ?? ADS_REQUIREMENT_FORECAST_DAYS;
  const startDate = startOfUtcDay(input.startDate);
  const volumeByHour = new Map<number, number>();
  for (const row of input.hourlyVolumes) {
    const hour = startOfUtcHour(row.at).getTime();
    volumeByHour.set(hour, Math.max(0, Number(row.volume) || 0));
  }

  const requirements: AdsShiftRequirement[] = [];
  for (let dayIndex = 0; dayIndex < days; dayIndex += 1) {
    const date = new Date(startDate.getTime() + dayIndex * dayMs);
    requirements.push(
      peakRequirement(date, "Manhã", hoursForShift(date, "Manhã"), volumeByHour, input.ahtSeconds),
      peakRequirement(date, "Tarde", hoursForShift(date, "Tarde"), volumeByHour, input.ahtSeconds),
      peakRequirement(date, "Noite", hoursForShift(date, "Noite"), volumeByHour, input.ahtSeconds)
    );
  }
  return requirements;
}

function peakRequirement(
  date: Date,
  shift: AdsRequirementShift,
  hours: Date[],
  volumeByHour: Map<number, number>,
  ahtSeconds: number
): AdsShiftRequirement {
  let peak = { required: 0, hour: hours[0], rollingVolume: 0 };
  for (const hour of hours) {
    const current = requiredVolume(volumeByHour, hour);
    const next = requiredVolume(volumeByHour, new Date(hour.getTime() + hourMs));
    const rollingVolume = (current + next) / 2;
    const required = calculateAdsHourlyRequirement(rollingVolume, ahtSeconds);
    if (required > peak.required || (required === peak.required && rollingVolume > peak.rollingVolume)) {
      peak = { required, hour, rollingVolume };
    }
  }
  return {
    date: date.toISOString().slice(0, 10),
    shift,
    required: peak.required,
    peakHour: peak.hour.toISOString(),
    peakRollingVolume: Math.round(peak.rollingVolume * 100) / 100
  };
}

function requiredVolume(volumeByHour: Map<number, number>, hour: Date) {
  const value = volumeByHour.get(startOfUtcHour(hour).getTime());
  if (value === undefined) throw new Error(`Forecast ADS ausente para ${hour.toISOString().slice(0, 13)}:00.`);
  return value;
}

function hoursForShift(date: Date, shift: AdsRequirementShift) {
  if (shift === "Manhã") return range(8, 16).map((hour) => utcHour(date, hour));
  if (shift === "Tarde") return range(14, 22).map((hour) => utcHour(date, hour));
  return [utcHour(date, 23), ...range(0, 7).map((hour) => new Date(utcHour(date, hour).getTime() + dayMs))];
}

function range(start: number, end: number) {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function utcHour(date: Date, hour: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour));
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function startOfUtcHour(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours()));
}
