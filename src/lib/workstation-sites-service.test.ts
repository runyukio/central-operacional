import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { Prisma } from "@prisma/client";
import * as XLSX from "xlsx";
import { prisma } from "./prisma";
import { normalizeSiteDomain } from "./workstation-site-classification";
import { getWorkstationSites, getWorkstationSiteClassifications, saveWorkstationSiteClassification } from "./workstation-sites-service";
import { buildWorkstationSitesReport } from "./workstation-sites-export";

const actor = { email: "leader@example.test", name: "Leader", role: "ADMIN" as const };
function fixture(t: TestContext, role = "ADMIN", patch: Record<string, unknown> = {}, result: unknown[] = []) {
  const sql: Prisma.Sql[] = [], writes: Array<Record<string, unknown>> = [];
  const configs = new Map<string, { key: string; value: unknown }>();
  const names = ["user", "employeeProfile", "shift", "systemConfig", "$queryRaw"];
  const descriptors = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(prisma, name)]));
  const set = (name: string, value: unknown) => Object.defineProperty(prisma, name, { configurable: true, value });
  set("user", { findUnique: async () => ({ email: actor.email, role: { name: role }, status: "ACTIVE", deletedAt: null, employeeProfile: { id: "supervisor" }, ...patch }) });
  set("employeeProfile", { findMany: async () => [{ id: "team-agent" }] });
  set("shift", { findMany: async () => [{ name: "Manha ADS" }, { name: "Tarde (15:00–00:00)" }] });
  set("systemConfig", { upsert: async (args: { where: { key: string }; create: { value: unknown }; update: { value: unknown } }) => {
    writes.push(args); configs.set(args.where.key, { key: args.where.key, value: args.update.value });
  }, findMany: async () => Array.from(configs.values()) });
  set("$queryRaw", async (query: Prisma.Sql) => { sql.push(query); return result; });
  t.after(() => { for (const [name, descriptor] of descriptors) { if (descriptor) Object.defineProperty(prisma, name, descriptor); else Reflect.deleteProperty(prisma, name); } });
  return { sql, writes, configs };
}

test("normalize safe domains and reject non-web schemes, credentials and invalid labels", () => {
  assert.equal(normalizeSiteDomain("https://WWW.Example.COM/path?q=x"), "example.com");
  assert.equal(normalizeSiteDomain("app.example.com."), "app.example.com");
  for (const value of ["javascript:alert(1)", "file:///private", "chrome://settings", "https://user:pass@example.com", "https://-bad.test", "https://bad..test", ""]) assert.equal(normalizeSiteDomain(value), null, value);
});

test("denied or inactive database roles cannot query, list or write classifications", async (t) => {
  for (const patch of [{ role: { name: "COLABORADOR" } }, { status: "INACTIVE" }, { deletedAt: new Date() }]) {
    await t.test(JSON.stringify(patch), async (child) => {
      const f = fixture(child, "ADMIN", patch);
      for (const result of [await getWorkstationSites(actor, new URLSearchParams()), await getWorkstationSiteClassifications(actor), await saveWorkstationSiteClassification(actor, { domain: "example.test", classification: "PRODUCTIVE" })]) {
        assert.equal(result.success, false); assert.equal(result.status, 403);
      }
      assert.equal(f.sql.length, 0); assert.equal(f.writes.length, 0);
    });
  }
});

test("classification survives a read, uses independent domain keys and can be cleared", async (t) => {
  const f = fixture(t);
  assert.equal((await saveWorkstationSiteClassification(actor, { domain: "https://www.example.test/page", classification: "PRODUCTIVE" })).success, true);
  assert.equal((await saveWorkstationSiteClassification(actor, { domain: "other.test", classification: "UNPRODUCTIVE" })).success, true);
  let result = await getWorkstationSiteClassifications(actor);
  assert.ok(result.success);
  assert.deepEqual(result.classifications, { "example.test": "PRODUCTIVE", "other.test": "UNPRODUCTIVE" });
  await saveWorkstationSiteClassification(actor, { domain: "example.test", classification: "UNCLASSIFIED" });
  result = await getWorkstationSiteClassifications(actor);
  assert.ok(result.success); assert.equal(result.classifications["example.test"], "UNCLASSIFIED");
  assert.equal(f.configs.size, 2);
  assert.ok(f.writes.every((value) => JSON.stringify(value).includes(actor.email)), "record who set the tag");
  const invalid = await saveWorkstationSiteClassification(actor, { domain: "example.test", classification: "CUSTOM" });
  assert.equal(invalid.success, false); assert.equal(f.writes.length, 3);
});

test("hub and export preserve supervisor scope even with another employee selected", async (t) => {
  const f = fixture(t, "SUPERVISOR");
  for (const format of ["", "xlsx"]) {
    await getWorkstationSites(actor, new URLSearchParams({ startDate: "2026-11-08", endDate: "2026-11-09", agentKey: "employee:outside-team", export: format, lob: "ADS", shift: "Manhã" }));
    const query = f.sql.at(-1)!;
    assert.ok(query.text.includes('activity."employeeId" IN ('));
    for (const value of ["team-agent", "outside-team", "ADS", "Manha ADS"]) assert.ok(query.values.includes(value));
    assert.ok(query.values.some((value) => value instanceof Date && value.toISOString() === "2026-11-08T03:00:00.000Z"));
    assert.ok(query.values.some((value) => value instanceof Date && value.toISOString() === "2026-11-10T03:00:00.000Z"));
    assert.ok(query.text.includes('LEAST(activity."endedAt"'));
    assert.ok(query.text.includes('GREATEST(activity."startedAt"'));
  }
});

test("supervisor without profile fails closed and domain search stays parameterized", async (t) => {
  const f = fixture(t, "SUPERVISOR", { employeeProfile: null });
  const search = "x' OR TRUE --";
  await getWorkstationSites(actor, new URLSearchParams({ search }));
  assert.ok(f.sql[0].text.includes(" AND FALSE")); assert.ok(!f.sql[0].text.includes(search)); assert.ok(f.sql[0].values.includes(`%${search}%`));
});

test("invalid, inverted and oversized periods never read activity", async (t) => {
  const f = fixture(t);
  for (const [startDate, endDate] of [["", "2026-11-09"], ["2026-02-31", "2026-03-01"], ["2026-11-09", "2026-11-08"], ["2026-10-01", "2026-11-09"]]) {
    assert.equal((await getWorkstationSites(actor, new URLSearchParams({ startDate, endDate }))).success, false);
  }
  assert.equal(f.sql.length, 0);
});

test("complete domain aggregates drive totals and export has an explicit overflow error", async (t) => {
  const sites = [
    { domain: "productive.test", classification: "PRODUCTIVE", seconds: 7200, agents: 3, segments: 10 },
    { domain: "other.test", classification: "UNPRODUCTIVE", seconds: 3600, agents: 2, segments: 5 },
    { domain: "new.test", classification: "UNCLASSIFIED", seconds: 600, agents: 1, segments: 2 }
  ];
  const f = fixture(t, "ADMIN", {}, [{ sites, byAgent: [], reportRows: 0 }]);
  const result = await getWorkstationSites(actor, new URLSearchParams({ classification: "PRODUCTIVE", export: "xlsx" }));
  assert.ok(result.success); assert.deepEqual(result.summary, { totalSeconds: 11400, productiveSeconds: 7200, unproductiveSeconds: 3600, unclassifiedSeconds: 600, domains: 3 });
  const query = f.sql[0];
  assert.ok(query.values.includes("PRODUCTIVE"));
  const aggregation = query.text.slice(query.text.indexOf("sites AS ("), query.text.indexOf("agent_usage AS ("));
  assert.ok(!aggregation.includes("LIMIT"), "pagination must never truncate site totals");
  assert.ok(query.text.includes("LIMIT 50001"));
  assert.ok(query.text.includes('COUNT(*)::int FROM agent_usage'));
});

test("oversized export is rejected instead of silently truncating agent rows", async (t) => {
  fixture(t, "ADMIN", {}, [{ sites: [], byAgent: [], reportRows: 50001 }]);
  const result = await getWorkstationSites(actor, new URLSearchParams({ export: "xlsx" }));
  assert.equal(result.success, false); assert.equal(result.status, 422);
});

test("Excel contains the report filters, complete site rows and numeric durations above 24 hours", async (t) => {
  const site = { domain: "example.test", classification: "PRODUCTIVE", seconds: 93600, agents: 1, segments: 100 };
  fixture(t, "ADMIN", {}, [{ sites: [site], byAgent: [{ ...site, employeeName: "=Example", wbLogin: "wb", agentKey: "employee:one", lob: "ADS", shift: "Manha ADS", supervisor: "Supervisor" }], reportRows: 1 }]);
  const data = await getWorkstationSites(actor, new URLSearchParams({ startDate: "2026-11-08", endDate: "2026-11-09", lob: "ADS", export: "xlsx" }));
  assert.ok(data.success);
  const response = buildWorkstationSitesReport(data);
  const workbook = XLSX.read(Buffer.from(await response.arrayBuffer()), { type: "buffer", cellNF: true });
  assert.deepEqual(workbook.SheetNames, ["Resumo", "Sites", "Sites por agente"]);
  assert.equal(workbook.Sheets.Sites.C2.v, 93600 / 86400);
  assert.ok(workbook.Sheets.Sites.C2.z?.includes("[h]"));
  assert.equal(workbook.Sheets["Sites por agente"].A2.t, "s");
  assert.equal(workbook.Sheets["Sites por agente"].A2.f, undefined, "names beginning with = remain text");
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets.Resumo, { header: 1 }) as unknown[][];
  assert.ok(rows.some((row) => row[0] === "LOB" && row[1] === "ADS"));
  assert.ok(rows.some((row) => row[0] === "Início" && row[1] === "2026-11-08"));
});
