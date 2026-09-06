import assert from "node:assert/strict";
import test from "node:test";
import { genericUploadOwnershipError } from "./generic-upload-ownership";

test("generic uploads use only the authenticated owner", () => {
  const owner = { email: "partner@example.invalid", employeeId: "own-profile" };
  assert.equal(genericUploadOwnershipError(owner, {}), null);
  assert.equal(genericUploadOwnershipError(owner, { ownerUserEmail: " PARTNER@example.invalid ", employeeId: "own-profile" }), null);
  assert.match(genericUploadOwnershipError(owner, { ownerUserEmail: "admin@example.invalid" })!, /proprietário/);
  assert.match(genericUploadOwnershipError(owner, { employeeId: "another-profile" })!, /outro parceiro/);
  assert.match(genericUploadOwnershipError(owner, { entity: "BillingInvoice", entityId: "another-invoice" })!, /vincular/);
  assert.match(genericUploadOwnershipError({ email: owner.email }, { employeeId: "unrelated" })!, /outro parceiro/);
});
