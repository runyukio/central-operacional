import assert from "node:assert/strict";
import test from "node:test";
import { addCapacityDays, buildAdsCapacityPlan, buildCapacityRates, capacityClock, capacityDay, capacityHistoryPeriod, capacityPeriod, uniqueCapacityIntervals, CAPACITY_HOUR as H, type CapacitySchedule, type CapacityProduction } from "./ads-capacity-core";

const day = "2026-09-20";
function schedule(id: string, date: string, start = 8, end = 17, employeeId = "a", shift = "Manhã"): CapacitySchedule {
  return { id, date, employeeId, wbLogin: `wb_${employeeId}`, name: employeeId, skill: "Material Queues", shift, status: "PRESENTE", statusLabel: "Presente", start: capacityDay(date) + start * H, end: capacityDay(date) + end * H };
}
function hours(s: CapacitySchedule, submit = 10): CapacityProduction[] {
  return Array.from({ length: (s.end! - s.start!) / H }, (_, i) => ({ employeeId: s.employeeId, at: s.start! + i * H, submit, valid: true }));
}
function reference() {
  const schedules = [0, 1, 2].map((i) => schedule(`h${i}`, addCapacityDays("2026-09-07", i)));
  return buildCapacityRates(schedules, schedules.flatMap((s) => hours(s)), new Set(), capacityDay(day));
}
function plan(schedules: CapacitySchedule[], extra: Partial<Parameters<typeof buildAdsCapacityPlan>[0]> = {}) {
  return buildAdsCapacityPlan({ schedules, history: reference(), requirements: [], forecast: [0, 1].flatMap((d) => Array.from({ length: 24 }, (_, hour) => ({ dateKey: addCapacityDays(day, d), hour, input: 100 }))), startDate: day, endDate: day, shift: "Todos", templates: [{ shift: "Manhã", startsAt: "08:00", endsAt: "17:00" }], ...extra });
}
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test("São Paulo, duas semanas completas e virada domingo/segunda", () => {
  assert.deepEqual(capacityHistoryPeriod(day), { startDate: "2026-08-31", endDate: "2026-09-13" });
  assert.deepEqual(capacityHistoryPeriod("2026-09-21"), { startDate: "2026-09-07", endDate: "2026-09-20" });
  assert.equal(capacityClock(new Date("2026-09-21T02:59:00Z")), capacityDay(day) + 23 * H + 59 * H / 60);
  assert.deepEqual(capacityHistoryPeriod("2027-01-01"), { startDate: "2026-12-14", endDate: "2026-12-27" });
});
test("limites inclusivos, até 31 dias, datas inválidas e período inicial", () => {
  assert.equal(capacityPeriod({}, day).endDate, "2026-10-03");
  assert.doesNotThrow(() => capacityPeriod({ endDate: "2026-10-20" }, day));
  for (const query of [{ endDate: "2026-10-21" }, { startDate: "2026-09-19" }, { endDate: "2026-02-30" }, { shift: "invalid" }]) assert.throws(() => capacityPeriod(query, day));
});
test("produtividade ponderada, sem média de médias nem desconto de pausas", () => {
  const ss = [schedule("1", "2026-09-01", 8, 17), schedule("2", "2026-09-02", 8, 17), schedule("3", "2026-09-03", 8, 11)];
  const h = buildCapacityRates(ss, [...hours(ss[0], 10), ...hours(ss[1], 10), ...hours(ss[2], 30)], new Set(), capacityDay(day));
  near(h.rates.get("a")!.rate!, 270 / 21);
  assert.equal(h.rates.get("a")!.hours, 21);
});
test("zeros explícitos contam; lacunas e lotes parciais não viram zero", () => {
  const ss = [0, 1, 2].map((i) => schedule(`${i}`, addCapacityDays("2026-09-07", i)));
  assert.equal(buildCapacityRates(ss, ss.flatMap((s) => hours(s, 0)), new Set(), capacityDay(day)).rates.get("a")!.rate, 0);
  assert.equal(buildCapacityRates(ss, ss.flatMap((s) => hours(s, 0).slice(1)), new Set(), capacityDay(day)).rates.get("a")!.rate, null);
  assert.equal(buildCapacityRates(ss, ss.flatMap((s) => hours(s).map((r) => ({ ...r, valid: false }))), new Set(), capacityDay(day)).rates.get("a")!.rate, null);
});
test("turno em andamento não participa; zero sem presença não comprova trabalho", () => {
  const s = { ...schedule("1", day), status: "ESCALADO" };
  assert.equal(buildCapacityRates([s], hours(s), new Set(), s.start! + H).rates.get("a")!.validShifts, 0);
  assert.equal(buildCapacityRates([s], hours(s, 0), new Set(), s.end!).rates.get("a")!.validShifts, 0);
  assert.equal(buildCapacityRates([s], hours(s, 0), new Set([s.id]), s.end!).rates.get("a")!.validShifts, 1);
});
test("produção fora do horário não infla média e madrugada pertence ao início", () => {
  const s = schedule("1", "2026-09-13", 23, 32, "a", "Noite");
  const h = buildCapacityRates([s], [...hours(s), { employeeId: "a", at: s.start! - H, submit: 999, valid: true }], new Set(), capacityDay(day));
  assert.equal(h.rates.get("a")!.submit, 90);
  assert.equal(h.rates.get("a")!.outsideSubmit, 999);
  assert.equal(h.rates.get("a")!.hours, 9);
});
test("fallback somente pela mesma skill; ausente deixa total parcial", () => {
  const result = plan([schedule("1", day), schedule("2", day, 8, 17, "b"), { ...schedule("3", day, 8, 17, "c"), skill: "Accounts" }]);
  const row = result.data[0];
  assert.equal(row.individual, 1); assert.equal(row.skill, 1); assert.equal(row.missing, 1);
  assert.equal(row.capacity, 180); assert.equal(row.gap, null); assert.equal(row.calculatedRequired, null);
  assert.equal(row.state, "incomplete");
});
test("fallback ponderado entre doadores com três turnos, inclusive taxa zero", () => {
  const a = [0, 1, 2].map((i) => schedule(`a${i}`, addCapacityDays("2026-09-07", i), 8, 17, "a"));
  const b = [0, 1, 2].map((i) => schedule(`b${i}`, addCapacityDays("2026-09-07", i), 8, 11, "b"));
  const c = [schedule("c", "2026-09-07", 8, 17, "c")];
  const h = buildCapacityRates([...a, ...b, ...c], [...a.flatMap((s) => hours(s, 0)), ...b.flatMap((s) => hours(s, 40)), ...c.flatMap((s) => hours(s, 999))], new Set(), capacityDay(day));
  const row = plan([schedule("new", day, 8, 17, "new")], { history: h }).data[0];
  assert.equal(row.agents[0].rate, 10);
});
test("jornada parcial futura e duplicidades de troca/venda são contadas uma vez", () => {
  const a = { ...schedule("1", day, 8.5, 12.5), status: "TROCA_APROVADA" };
  const b = { ...schedule("2", day, 10.5, 13.5), status: "VENDA_FOLGA_APROVADA" };
  const intervals = uniqueCapacityIntervals([a, a, b]);
  assert.equal(intervals.length, 2); assert.equal(intervals[1].start, a.end);
  const row = plan([a, a, b]).data[0];
  assert.equal(row.scheduled, 1); assert.equal(row.capacity, 50);
});
test("forecast proporcional a horas-pessoa, antes do filtro de turno", () => {
  const ss = [schedule("a", day, 8, 10), schedule("b", day, 9, 10, "b", "Tarde")];
  const all = plan(ss, { templates: [{ shift: "Manhã", startsAt: "08:00", endsAt: "10:00" }] });
  const filtered = plan(ss, { templates: [{ shift: "Manhã", startsAt: "08:00", endsAt: "10:00" }], shift: "Tarde" });
  assert.equal(all.data[0].forecast, 150); assert.equal(all.data[1].forecast, 50);
  assert.equal(filtered.summary.forecast, 50);
  near(all.summary.forecast!, all.reconciliation.sourceForecast);
});
test("volume descoberto preservado e requisito ausente distinto de zero", () => {
  const p = plan([], { requirements: [{ date: day, shift: "Manhã", required: 0 }] });
  assert.equal(p.summary.uncoveredForecast, 900);
  assert.equal(p.summary.gap, -900);
  assert.equal(p.data[0].required, 0); assert.equal(p.data[1].required, null);
  assert.equal(p.data[0].calculatedRequired, null);
  assert.equal(p.data[0].state, "incomplete");
});
test("noite inclui dia seguinte e reconcilia partes de turnos adjacentes", () => {
  const ss = [schedule("a", day, 23, 32, "a", "Noite"), schedule("b", "2026-09-21", 6, 15, "b")];
  const p = plan(ss, { templates: [{ shift: "Noite", startsAt: "23:00", endsAt: "08:00" }] });
  assert.equal(p.data.find((r) => r.shift === "Noite")!.forecast, 800);
  assert.equal(p.reconciliation.outsideForecast, 100);
  near(p.summary.forecast! + p.reconciliation.outsideForecast, p.reconciliation.sourceForecast);
});
test("forecast ausente/incompleto não apresenta zero nem meta atingida", () => {
  for (const forecast of [[], [{ dateKey: day, hour: 8, input: 100 }]]) {
    const p = plan([schedule("a", day)], { forecast });
    assert.equal(p.summary.capacity, 90); assert.equal(p.summary.forecast, null); assert.equal(p.summary.gap, null);
    assert.equal(p.data[0].state, "incomplete");
  }
});
test("totais individuais, turnos e consolidado reconciliam sem arredondamento antecipado", () => {
  const p = plan([schedule("a", day, 8, 17), schedule("b", day, 8, 17, "b")]);
  near(p.summary.capacity, p.data.flatMap((r) => r.agents).reduce((sum, a) => sum + (a.capacity ?? 0), 0));
  assert.equal(p.data[0].calculatedRequired, 10);
  assert.equal(p.data[0].peopleGap, -8);
  near(p.byDay[0].forecast!, p.summary.forecast!);
});

test("contagem de referência é por parceiro único, não por participações", () => {
  const p = plan([schedule("a1", day), schedule("a2", "2026-09-21"), schedule("b1", day, 8, 17, "b")], { endDate: "2026-09-21" });
  assert.deepEqual(p.summary.reference, { individual: 1, skill: 1, missing: 0 });
  assert.equal(p.summary.scheduled, 3);
});
