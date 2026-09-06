import assert from "node:assert/strict";
import test from "node:test";
import bcrypt from "bcryptjs";
import { passwordCredentialProviders, synchronizeUserPassword, verifyAccountPassword } from "./password-credentials";

const originals = { ...passwordCredentialProviders };
test.afterEach(() => Object.assign(passwordCredentialProviders, originals));

test("legacy external password remains usable only before local authority exists", async () => {
  const user = { email: "test@example.com", passwordHash: await bcrypt.hash("local", 4) };
  passwordCredentialProviders.verifyExternal = async (_email, password) => password === "external" ? { id: "external-id", email: user.email, name: "Test" } : null;
  assert.equal(await verifyAccountPassword(user, "external"), true);
  assert.equal(await verifyAccountPassword({ ...user, passwordChangedAt: new Date() }, "external"), false);
  assert.equal(await verifyAccountPassword({ ...user, lastPasswordResetAt: new Date() }, "external"), false);
  assert.equal(await verifyAccountPassword({ ...user, passwordChangedAt: new Date() }, "local"), true);
});

test("provider failure after local save never restores the old password", async () => {
  const user = { email: "test@example.com", passwordHash: await bcrypt.hash("old-password", 4), passwordChangedAt: null as Date | null };
  passwordCredentialProviders.isExternalConfigured = () => true;
  passwordCredentialProviders.isExternalAdminConfigured = () => true;
  passwordCredentialProviders.updateExternal = async () => { throw new Error("provider unavailable"); };
  passwordCredentialProviders.verifyExternal = async () => ({ id: "external-id", email: user.email, name: "Test" });
  const result = await synchronizeUserPassword({ email: user.email, password: "new-password", persistLocal: async (hash) => {
    user.passwordHash = hash; user.passwordChangedAt = new Date();
  } });
  assert.equal(result, "LOCAL_SAVED_EXTERNAL_PENDING");
  assert.equal(await verifyAccountPassword(user, "old-password"), false);
  assert.equal(await verifyAccountPassword(user, "new-password"), true);
});

test("missing admin configuration and local write failure do not mutate external credentials", async () => {
  let writes = 0;
  passwordCredentialProviders.isExternalConfigured = () => true;
  passwordCredentialProviders.isExternalAdminConfigured = () => false;
  passwordCredentialProviders.updateExternal = async () => { writes++; return "UPDATED"; };
  await assert.rejects(synchronizeUserPassword({ email: "test@example.com", password: "new-password", persistLocal: async () => { writes++; } }));
  assert.equal(writes, 0);
  passwordCredentialProviders.isExternalAdminConfigured = () => true;
  await assert.rejects(synchronizeUserPassword({ email: "test@example.com", password: "new-password", persistLocal: async () => { throw new Error("database unavailable"); } }));
  assert.equal(writes, 0);
});

test("successful update persists authoritative credential before external sync", async () => {
  const calls: string[] = [];
  passwordCredentialProviders.isExternalConfigured = () => false;
  passwordCredentialProviders.updateExternal = async () => { calls.push("external"); return "UPDATED"; };
  assert.equal(await synchronizeUserPassword({ email: "test@example.com", password: "new-password", persistLocal: async (hash) => {
    calls.push("local"); assert.equal(await bcrypt.compare("new-password", hash), true);
  } }), "UPDATED");
  assert.deepEqual(calls, ["local", "external"]);
});
