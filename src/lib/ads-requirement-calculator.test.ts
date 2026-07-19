import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAdsShiftRequirements,
  calculateAdsHourlyRequirement,
  type AdsHourlyVolume
} from "./ads-requirement-calculator";

test("aplica AHT, shrinkage de 6,25%, buffer de 3 e arredondamento para cima", () => {
  assert.equal(calculateAdsHourlyRequirement(100, 36), 5);
  assert.equal(calculateAdsHourlyRequirement(40, 3600), 46);
});

test("usa a média das janelas móveis de duas horas do turno", () => {
  const startDate = new Date("2026-07-20T00:00:00.000Z");
  const hourlyVolumes: AdsHourlyVolume[] = [];
  for (let hour = 0; hour <= 32; hour += 1) {
    hourlyVolumes.push({ at: new Date(startDate.getTime() + hour * 60 * 60 * 1000), volume: 0 });
  }
  setVolume(hourlyVolumes, "2026-07-20T14:00:00.000Z", 40);
  setVolume(hourlyVolumes, "2026-07-20T15:00:00.000Z", 40);
  setVolume(hourlyVolumes, "2026-07-20T23:00:00.000Z", 60);
  setVolume(hourlyVolumes, "2026-07-21T00:00:00.000Z", 60);

  const rows = buildAdsShiftRequirements({ startDate, hourlyVolumes, ahtSeconds: 3600, days: 1 });

  assert.deepEqual(rows.map((row) => ({ shift: row.shift, required: row.required })), [
    { shift: "Manhã", required: 13 },
    { shift: "Tarde", required: 14 },
    { shift: "Noite", required: 14 }
  ]);
  assert.deepEqual(rows[2].referenceHours.slice(0, 2), [
    "2026-07-20T23:00:00.000Z",
    "2026-07-21T00:00:00.000Z"
  ]);
  assert.equal(rows[2].planningVolume, 10);
});

test("dilui um pico noturno isolado em vez de aplicá-lo ao turno inteiro", () => {
  const startDate = new Date("2026-07-20T00:00:00.000Z");
  const hourlyVolumes: AdsHourlyVolume[] = [];
  for (let hour = 0; hour <= 32; hour += 1) {
    hourlyVolumes.push({ at: new Date(startDate.getTime() + hour * 60 * 60 * 1000), volume: 10 });
  }
  setVolume(hourlyVolumes, "2026-07-21T02:00:00.000Z", 100);

  const night = buildAdsShiftRequirements({ startDate, hourlyVolumes, ahtSeconds: 3600, days: 1 })
    .find((row) => row.shift === "Noite");

  assert.equal(night?.planningVolume, 20);
  assert.equal(night?.required, 25);
});

function setVolume(rows: AdsHourlyVolume[], at: string, volume: number) {
  const row = rows.find((item) => item.at.toISOString() === at);
  if (!row) throw new Error(`Hora de teste ausente: ${at}`);
  row.volume = volume;
}
