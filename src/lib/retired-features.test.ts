import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { isRetiredFeaturePath } from "./retired-features";

test("retired route matching respects path boundaries and preserves Billing campaigns", () => {
  for (const route of ["/campanha", "/campanha/", "/campanha/agente", "/campanha/staff", "/api/campaigns/raffle", "/api/campaigns/raffle/export"]) {
    assert.equal(isRetiredFeaturePath(route), true, route);
  }
  for (const route of ["/", "/billing", "/api/billing", "/meu-perfil", "/api/campaigns/other", "/campanhas", "/campanha-other", "/api/campaigns/raffle-other"]) {
    assert.equal(isRetiredFeaturePath(route), false, route);
  }
});

test("raffle pages, mutations, export and Prisma models are removed", () => {
  const root = process.cwd();
  for (const file of [
    "src/app/(app)/campanha/page.tsx",
    "src/app/(app)/campanha/agente/page.tsx",
    "src/app/(app)/campanha/staff/page.tsx",
    "src/app/api/campaigns/raffle/route.ts",
    "src/app/api/campaigns/raffle/export/route.ts",
    "src/components/campaign-raffle-page.tsx",
    "src/lib/campaign-raffle-service.ts"
  ]) assert.equal(existsSync(path.join(root, file)), false, file);
  const schema = readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
  assert.doesNotMatch(schema, /RaffleCampaign|RaffleDistribution|RaffleTicketAssignment/);
  assert.match(schema, /model EmployeeCampaignSegment/);
  assert.match(schema, /campaignAmount/);
});

test("removal migration is transactional and drops only the three exclusive raffle tables", () => {
  const sql = readFileSync(path.join(process.cwd(), "prisma/migrations/20260920123330_remove_campaign_raffle/migration.sql"), "utf8");
  assert.match(sql, /BEGIN;/);
  assert.match(sql, /COMMIT;/);
  assert.doesNotMatch(sql, /\bCASCADE\b|\bTRUNCATE\b/);
  assert.deepEqual([...sql.matchAll(/DROP TABLE "([^"]+)" RESTRICT;/g)].map((match) => match[1]), [
    "RaffleTicketAssignment", "RaffleDistribution", "RaffleCampaign"
  ]);
  assert.equal([...sql.matchAll(/DELETE FROM/g)].length, 2);
  assert.match(sql, /DELETE FROM "AuditLog"\s+WHERE "entity" IN \('RaffleCampaign', 'RaffleDistribution', 'RaffleTicketAssignment'\)/);
});
