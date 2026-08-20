import assert from "node:assert/strict";
import test from "node:test";

import { billingCnpjMatchesSearch } from "./billing-service";

test("busca do Billing encontra CNPJ com ou sem pontuação", () => {
  assert.equal(billingCnpjMatchesSearch("12.345.678/0001-90", "12345678000190"), true);
  assert.equal(billingCnpjMatchesSearch("12345678000190", "12.345.678/0001-90"), true);
  assert.equal(billingCnpjMatchesSearch("12.345.678/0001-90", "6780001"), true);
  assert.equal(billingCnpjMatchesSearch("12.345.678/0001-90", ""), false);
  assert.equal(billingCnpjMatchesSearch("12.345.678/0001-90", "999"), false);
});
