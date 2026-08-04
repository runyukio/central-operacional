import assert from "node:assert/strict";
import test from "node:test";

import { isProjectExcludedFromAdsCoverage } from "@/lib/coverage-lob-rules";

test("exclui colaborador PROJECT quando o slot de cobertura foi marcado como ADS", () => {
  assert.equal(isProjectExcludedFromAdsCoverage("PROJECT", "ADS"), true);
  assert.equal(isProjectExcludedFromAdsCoverage(" project ", "ads"), true);
});

test("mantém ADS e mantém PROJECT na própria LOB", () => {
  assert.equal(isProjectExcludedFromAdsCoverage("ADS", "ADS"), false);
  assert.equal(isProjectExcludedFromAdsCoverage("PROJECT", "PROJECT"), false);
  assert.equal(isProjectExcludedFromAdsCoverage("PROJECT", null), false);
});
