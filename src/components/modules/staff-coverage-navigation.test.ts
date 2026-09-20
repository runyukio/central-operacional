import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canAccessAdsCapacity } from "../../lib/ads-capacity-permissions";
import { canAccessAdsStaffCoverage, canAccessPerformance } from "../../lib/permissions";

test("server supplies ADS visibility from the authenticated session before coverage is loaded", () => {
  const route = readFileSync(new URL("../../app/(app)/staff-cobertura/page.tsx", import.meta.url), "utf8");
  assert.match(route, /await getServerSession\(authOptions\)/);
  assert.match(route, /initialCanPlanAds=\{canAccessAdsCapacity\(\{ \.\.\.session\?\.user, status: "ACTIVE" \}\)\}/);
  assert.doesNotMatch(route, /listStaffCoverage|readAdsCapacityPlan|fetch\(/);
});

test("ADS navigation has a server-rendered fallback and still honors later API denial", () => {
  const source = readFileSync(new URL("./staff-coverage-page.tsx", import.meta.url), "utf8");
  assert.match(source, /initialCanPlanAds = false/);
  assert.match(source, /const canPlanAds = payload\?\.permissions\.canPlanAds \?\? initialCanPlanAds;/);
  assert.match(source, /\.\.\.\(canPlanAds \? \["ADS" as const\]/);
  assert.match(source, /const AdsCapacityPanel = dynamic\(/, "the heavy ADS panel stays lazy-loaded");
});

test("initial ADS visibility uses the same existing permission intersection as its API", () => {
  for (const role of ["ADMIN", "WFM", "GESTOR", "SUPERVISOR", "POC", "COLABORADOR", "RH", "FINANCEIRO", "CLIENT", "GLOBAL"]) {
    const user = { role, status: "ACTIVE" };
    assert.equal(canAccessAdsCapacity(user), canAccessAdsStaffCoverage(user) && canAccessPerformance(user), role);
    assert.equal(canAccessAdsCapacity({ ...user, status: "INACTIVE" }), false, role);
  }
});
