import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { DEFAULT_BILLING_REFERENCE_MONTH } from "./billing-reference-month";
import { DEFAULT_BILLING_REFERENCE_MONTH as serverDefault } from "./billing-service";

test("Billing and profile use the September operational cycle without overriding explicit periods", () => {
  assert.equal(DEFAULT_BILLING_REFERENCE_MONTH, "2026-09");
  assert.equal(serverDefault, DEFAULT_BILLING_REFERENCE_MONTH);
  for (const component of ["billing-page", "my-invoice-page"]) {
    const source = readFileSync(new URL(`../components/${component}.tsx`, import.meta.url), "utf8");
    assert.match(source, /QueryParam\("referenceMonth"\) \|\| DEFAULT_BILLING_REFERENCE_MONTH/);
    assert.doesNotMatch(source, /useState\([^\n]*2026-08/);
  }
  const profile = readFileSync(new URL("./employee-profile-service.ts", import.meta.url), "utf8");
  assert.match(profile, /getEmployeeBillingPreview\(employee.id, DEFAULT_BILLING_REFERENCE_MONTH\)/);
});
