import assert from "node:assert/strict";
import test from "node:test";
import { selectSpaceGlideEmployees } from "./meu-espaco-glide-scope";
import type { SpaceEmployee } from "./meu-espaco-scope";
import { spaceAgePriority } from "./meu-espaco-order";

const employee = (id: string, lob = "ADS", skill = "Material Queues") => ({ id, lob: { name: lob }, skill } as SpaceEmployee);
const scope = { employees: [employee("material"), employee("account", "ADS", "Account"), employee("video", "VIDEO"), employee("comments", "COMMENTS")] };
test("unselected Glide uses the authorized operation; a selected partner narrows it", () => {
  assert.deepEqual(selectSpaceGlideEmployees(scope, "ADS", "quality").map((p) => p.id), ["material", "account"]);
  assert.deepEqual(selectSpaceGlideEmployees(scope, "ADS", "quality", "account").map((p) => p.id), ["account"]);
  assert.deepEqual(selectSpaceGlideEmployees(scope, "ADS", "materialDaily").map((p) => p.id), ["material"]);
});
test("unknown partner is rejected, never silently converted into a team query", () => {
  assert.throws(() => selectSpaceGlideEmployees(scope, "ADS", "quality", "other-team"), { status: 403 });
  assert.throws(() => selectSpaceGlideEmployees(scope, "ADS", "quality", "video"), { status: 400 });
  assert.throws(() => selectSpaceGlideEmployees(scope, "ADS", "materialDaily", "account"), { status: 400 });
});
test("Glide retains VIDEO and Comments eligibility", () => {
  assert.deepEqual(selectSpaceGlideEmployees(scope, "TNS", "aht").map((p) => p.id), ["video"]);
  assert.deepEqual(selectSpaceGlideEmployees(scope, "TNS", "commentsLatency").map((p) => p.id), ["comments"]);
});
test("age colors indicate age, not SLA; closed occurrences are neutral", () => {
  const today = "2026-09-09";
  assert.equal(spaceAgePriority("2026-09-10", today), "future");
  assert.equal(spaceAgePriority(today, today), "new");
  assert.equal(spaceAgePriority("2026-09-08", today), "medium");
  assert.equal(spaceAgePriority("2026-09-02", today), "high");
  assert.equal(spaceAgePriority("2026-09-08", today, true), "high");
  assert.equal(spaceAgePriority("2026-09-01", today, true, false), "neutral");
});
