/** Explicit opt-in, synthetic QA only. Never run against a production database. */
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma";
import type { Actor } from "../src/lib/mock-db";
import { getMeuEspacoScope } from "../src/lib/meu-espaco-scope";
import { getSpaceCoverage, justifySpaceCoverage } from "../src/lib/meu-espaco-coverage-service";
import { getSpaceResults } from "../src/lib/meu-espaco-results-service";
import { getSpaceMonthlyHours } from "../src/lib/meu-espaco-hours-service";
import { listSpacePending } from "../src/lib/meu-espaco-pending-service";
import { getSpaceGlide } from "../src/lib/meu-espaco-glide-service";
import { spaceToday } from "../src/lib/meu-espaco-filters";
import { moveSpaceDay, spaceMonthEnd } from "../src/lib/meu-espaco-glide";
import { allPerformanceQueueIds, getPerformanceQueueMetadataById } from "../src/lib/performance-service";

async function main() {
  const url = new URL(process.env.DATABASE_URL || "http://invalid");
  assert.ok(process.env.MEU_ESPACO_LOCAL_QA === "1" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/quality_qa", "Requires explicit isolated local QA database.");
  const today = spaceToday(), month = today.slice(0, 7), start = `${month}-01`, end = spaceMonthEnd(month), tomorrow = moveSpaceDay(today, 1);
  const date = (day: string) => new Date(`${day}T00:00:00Z`);
  const lob = await prisma.lob.upsert({ where: { name: "ADS" }, update: {}, create: { name: "ADS" } });
  const team = await prisma.team.upsert({ where: { name_lobId: { name: "QA Meu Espaço", lobId: lob.id } }, update: {}, create: { name: "QA Meu Espaço", lobId: lob.id } });
  const shift = await prisma.shift.upsert({ where: { name: "Manhã (QA Espaço)" }, update: {}, create: { name: "Manhã (QA Espaço)", startsAt: "08:00", endsAt: "17:00", color: "#2563eb" } });
  const night = await prisma.shift.upsert({ where: { name: "Noite (QA Espaço)" }, update: {}, create: { name: "Noite (QA Espaço)", startsAt: "23:00", endsAt: "08:00", color: "#2563eb" } });
  const base = { lobId: lob.id, teamId: team.id, shiftId: shift.id, admissionDate: date("2026-01-01"), goLiveDate: date("2026-01-01"), scheduleType: "5x2", operationalStatus: "Ativo" };
  const passwordHash = await bcrypt.hash("QA-Local-Only-123!", 4);
  const actors = new Map<string, Actor>();
  for (const roleName of ["ADMIN", "WFM", "GESTOR", "SUPERVISOR"] as const) {
    const role = await prisma.role.upsert({ where: { name: roleName }, update: {}, create: { name: roleName, label: roleName } });
    const email = `qa-space-${roleName.toLowerCase()}@example.invalid`, name = `QA Espaço ${roleName}`;
    const user = await prisma.user.upsert({ where: { email }, update: { passwordChangedAt: new Date() }, create: { email, name, passwordHash, passwordChangedAt: new Date(), roleId: role.id, status: "ACTIVE" } });
    actors.set(roleName, { email, name, role: roleName });
    if (roleName === "SUPERVISOR") await prisma.employeeProfile.upsert({ where: { id: "qa-space-sup-a" }, update: {}, create: { ...base, id: "qa-space-sup-a", userId: user.id, fullName: "QA Supervisor A", wbLogin: "qa_space_sup_a", roleTitle: "Supervisor" } });
  }
  for (const [id, name, shiftId] of [["b", "QA Supervisor B", shift.id], ["night", "QA Supervisor Noite", night.id]]) {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: "SUPERVISOR" } });
    const email = `qa-space-${id}@example.invalid`;
    const user = await prisma.user.upsert({ where: { email }, update: {}, create: { email, name, passwordHash, roleId: role.id, status: "ACTIVE" } });
    await prisma.employeeProfile.upsert({ where: { id: `qa-space-sup-${id}` }, update: { userId: user.id }, create: { ...base, id: `qa-space-sup-${id}`, userId: user.id, fullName: name, wbLogin: `qa_space_sup_${id}`, roleTitle: "Supervisor", shiftId } });
  }
  for (let i = 0; i < 61; i++) {
    const id = `qa-space-agent-${String(i).padStart(2, "0")}`;
    await prisma.employeeProfile.upsert({ where: { id }, update: {}, create: { ...base, id, fullName: `QA Parceiro ${String(i).padStart(2, "0")}`, wbLogin: id, roleTitle: "Agente", supervisorId: "qa-space-sup-a", skill: i === 1 ? "Account" : "Material Queues" } });
    const h = `${id}-hours`;
    await prisma.workHourRecord.upsert({ where: { id: h }, update: {}, create: { id: h, employeeId: id, wbLogin: id, date: date(start), actualHours: i + 1, effectiveHours: i + 1 } });
    await prisma.workHourAdherenceJustification.upsert({ where: { id: h }, update: {}, create: { id: h, reconciliationKey: h, employeeId: id, supervisorId: "qa-space-sup-a", date: date(start), slotKey: h, wbLogin: id, lob: "ADS", classification: "ADS", sourceDurationMs: 3600000 } });
    for (let day = start; day <= end; day = moveSpaceDay(day, 1)) await prisma.schedule.upsert({ where: { employeeId_date: { employeeId: id, date: date(day) } }, update: {}, create: { employeeId: id, date: date(day), shiftId: shift.id, lobId: lob.id, supervisorId: "qa-space-sup-a", startsAt: "08:00", endsAt: "17:00", status: "ESCALADO" } });
  }
  const queue = allPerformanceQueueIds().find((id) => getPerformanceQueueMetadataById(id).lob === "ADS")!;
  for (let day = start; day < today; day = moveSpaceDay(day, 1)) {
    for (let i = 0; i < 2; i++) {
      const id = `qa-space-agent-0${i}`, key = `${id}-${day}`, output = i ? 100 : 300;
      await prisma.productionRecord.upsert({ where: { productionKey: key }, update: {}, create: { productionKey: key, employeeId: id, wbLogin: id, bzTime: date(day), bzDay: date(day), queueId: queue, submitNum: output, moderationSeconds: output * (i ? 120 : 60), latencyMinutesSum: output * 120 } });
      for (let j = 0; j < 10; j++) {
        const q = `${key}-quality-${j}`;
        await prisma.qualityRecord.upsert({ where: { id: q }, update: {}, create: { id: q, employeeId: id, wbLogin: id, auditDate: date(day), auditTime: date(day), finalResult: j === 9 ? "Leakage" : "Correct", caseOrderId: q, auditCaseOrderId: q, concatKey: q } });
      }
    }
  }
  const requiredId = "qa-space-required";
  await prisma.staffCoverage.upsert({ where: { id: requiredId }, update: { requiredStaff: 1000 }, create: { id: requiredId, date: date(tomorrow), lobId: lob.id, shiftId: shift.id, plannedStaff: 0, requiredStaff: 1000, coveragePercent: 0, gap: -1000, risk: "CRITICO" } });
  const admin = await getMeuEspacoScope(actors.get("ADMIN")!);
  const own = await getMeuEspacoScope(actors.get("SUPERVISOR")!);
  assert.equal(own.supervisorId, "qa-space-sup-a");
  await assert.rejects(() => getMeuEspacoScope(actors.get("SUPERVISOR")!, "qa-space-sup-b"), { status: 403 });
  const params = new URLSearchParams({ startDate: tomorrow, endDate: tomorrow });
  const shared = (await getSpaceCoverage(admin, params)).data.find((row) => row.id === requiredId)!;
  const scoped = (await getSpaceCoverage(own, params)).data.find((row) => row.id === requiredId)!;
  assert.equal(shared.available, 61); assert.equal(scoped.available, shared.available);
  assert.equal(shared.supervisors.length, 2); assert.equal(scoped.supervisors.length, 1);
  // A pre-existing note fixture verifies read-only audit preservation, not a new UI workflow.
  await prisma.spaceCoverageNote.upsert({ where: { requestId: "qa-space-historical-note" }, update: {}, create: {
    requestId: "qa-space-historical-note", requirementId: requiredId, supervisorId: "qa-space-sup-a", supervisorName: "QA Supervisor A",
    actorId: admin.user.id, actorName: admin.user.name, date: date(tomorrow), lobId: lob.id, shiftId: shift.id,
    required: 1000, available: 61, text: "Synthetic historical note, preserved read-only" } });
  const beforeNotes = await prisma.spaceCoverageNote.count();
  const body = { supervisorId: "qa-space-sup-a", text: "Must not be stored", requestId: "qa-space-no-new-note" };
  for (const role of ["ADMIN", "WFM", "GESTOR", "SUPERVISOR"]) {
    const scope = await getMeuEspacoScope(actors.get(role)!);
    assert.equal((await getSpaceCoverage(scope, params)).canRespond, false);
    await assert.rejects(() => justifySpaceCoverage(scope, requiredId, body), { status: 403 });
  }
  assert.equal(await prisma.spaceCoverageNote.count(), beforeNotes);
  await prisma.staffCoverage.update({ where: { id: requiredId }, data: { requiredStaff: 1 } });
  assert.equal((await getSpaceCoverage(own, params)).data.find((r) => r.id === requiredId)!.state, "covered");
  await assert.rejects(() => justifySpaceCoverage(own, requiredId, body), { status: 403 });
  await prisma.staffCoverage.update({ where: { id: requiredId }, data: { requiredStaff: 1000 } });
  const closed = (await getSpaceCoverage(own, params, new Date(`${tomorrow}T21:00:00Z`))).data.find((r) => r.id === requiredId)!;
  assert.equal(closed.state, "ended_deficit"); assert.ok(closed.notes.length > 0);
  const filtered = new URLSearchParams({ month, search: "QA Parceiro", sort: "effectiveHours", direction: "desc" });
  const hours1 = await getSpaceMonthlyHours(own, filtered);
  filtered.set("page", "2"); const hours2 = await getSpaceMonthlyHours(own, filtered);
  assert.equal(hours1.data[0].effectiveHours, 61); assert.equal(hours2.data.length, 11); assert.equal(hours2.data.at(-1)!.effectiveHours, 1);
  for (const order of ["asc", "desc"]) {
    const q = new URLSearchParams({ kind: "hours", search: "QA Parceiro", order });
    const first = await listSpacePending(own, q); assert.equal(first.data.length, 50);
    q.set("cursor", first.nextCursor!); const second = await listSpacePending(own, q); assert.equal(second.data.length, 11);
    assert.equal(new Set([...first.data, ...second.data].map((row) => row.id)).size, 61);
  }
  const result = await getSpaceResults(own, new URLSearchParams({ startDate: start, endDate: moveSpaceDay(today, -1) }));
  const metrics = result.groups[0].metric.targets!;
  assert.equal(metrics.find((m) => m.id === "materialDaily")!.value, 300);
  assert.equal(metrics.find((m) => m.id === "aht")!.value, 75);
  const glide = await getSpaceGlide(own, new URLSearchParams({ month, lob: "ADS", metric: "materialDaily" }));
  assert.equal(glide.overall, 300); assert.equal(glide.cutoff, moveSpaceDay(today, -1)); assert.ok(glide.automaticWeight! > 0);
  assert.equal(glide.automaticWeight, glide.futureScheduled, "Missing partner-days must not reduce the observed productivity to zero");
  const teamAht = await getSpaceGlide(own, new URLSearchParams({ month, lob: "ADS", metric: "aht" }));
  const partnerAht = await getSpaceGlide(own, new URLSearchParams({ month, lob: "ADS", metric: "aht", employeeId: "qa-space-agent-01" }));
  assert.equal(teamAht.overall, 75); assert.equal(partnerAht.overall, 120);
  assert.ok(partnerAht.futureScheduled < teamAht.futureScheduled);
  await assert.rejects(() => getSpaceGlide(own, new URLSearchParams({ month, lob: "ADS", metric: "aht", employeeId: "qa-space-sup-b" })), { status: 403 });
  console.log("Local PostgreSQL QA passed: read-only coverage for every role, automatic closure and preserved history, scoped partner Glide, weighted targets, 61-partner ordering/pagination and unchanged monthly hours.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
