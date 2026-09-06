import assert from "node:assert/strict";
import test from "node:test";
import { redactCredentialFields } from "./credential-redaction";

test("settings audit redacts new plaintext passwords and previous credential hashes recursively", () => {
  const source = { id: "user-id", password: "plaintext-example", previous: { passwordHash: "hash-example", securityAnswerHash: "answer-example", roleId: "role-id" }, children: [{ access_token: "token-example" }] };
  const result = JSON.stringify(redactCredentialFields(source));
  for (const secret of ["plaintext-example", "hash-example", "answer-example", "token-example"]) assert.equal(result.includes(secret), false);
  assert.equal(result.includes("user-id"), true);
  assert.equal(result.includes("role-id"), true);
  assert.equal(source.password, "plaintext-example");
});
