import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { refreshSessionClaims, sessionAuthVersion } from "./session-security";
import type { PasswordUserRecord } from "./password-user-repository";

const previousSecret = process.env.NEXTAUTH_SECRET;
test.before(() => { process.env.NEXTAUTH_SECRET = randomBytes(32).toString("hex"); });
test.after(() => { if (previousSecret === undefined) delete process.env.NEXTAUTH_SECRET; else process.env.NEXTAUTH_SECRET = previousSecret; });

const user: PasswordUserRecord = { id: "u1", email: "user@example.com", name: "Example", passwordHash: "hash-not-a-real-credential",
  status: "ACTIVE", roleName: "ADMIN", roleTitle: "Admin", skill: null, lob: "ADS", mustChangePassword: false, temporaryPassword: false,
  updatedAt: new Date("2026-09-06T12:00:00Z"), passwordChangedAt: new Date("2026-09-01T12:00:00Z"), lastPasswordResetAt: null };
const claims = () => ({ sub: user.id, email: user.email, role: user.roleName, authVersion: sessionAuthVersion(user) });

test("session version is opaque and current fields are refreshed", () => {
  const result = refreshSessionClaims(claims(), { ...user, roleTitle: "Financeiro", lob: "CEC" });
  assert.equal(result.roleTitle, "Financeiro");
  assert.equal(result.lob, "CEC");
  assert.equal(result.authVersion?.includes(user.passwordHash), false);
  assert.equal("passwordHash" in result, false);
});

test("old, blocked, deleted, demoted and password-reset sessions fail closed", () => {
  assert.equal(refreshSessionClaims({ sub: user.id, role: "ADMIN" }, user).authInvalid, true);
  assert.equal(refreshSessionClaims(claims(), null).authInvalid, true);
  assert.equal(refreshSessionClaims(claims(), { ...user, status: "BLOCKED" }).authInvalid, true);
  assert.equal(refreshSessionClaims(claims(), { ...user, status: "INACTIVE" }).authInvalid, true);
  assert.equal(refreshSessionClaims(claims(), { ...user, roleName: "COLABORADOR", updatedAt: new Date(user.updatedAt.getTime() + 1) }).authInvalid, true);
  assert.equal(refreshSessionClaims(claims(), { ...user, passwordHash: "new-hash" }).authInvalid, true);
  assert.equal(refreshSessionClaims({ ...claims(), sub: "other" }, user).authInvalid, true);
  assert.equal(refreshSessionClaims({ ...claims(), authInvalid: true }, user).authInvalid, true);
});
