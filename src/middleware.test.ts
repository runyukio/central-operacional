import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, test } from "node:test";
import { encode, type JWT } from "next-auth/jwt";
import { NextRequest } from "next/server";

import { middleware } from "./middleware";
import { sessionValidationData } from "./lib/session-validation";
import { sessionAuthVersion } from "./lib/session-security";
import type { PasswordUserRecord } from "./lib/password-user-repository";

const testSecret = randomBytes(32).toString("hex");
const previousSecret = process.env.NEXTAUTH_SECRET;
const previousLookup = sessionValidationData.findUser;
let currentUser: PasswordUserRecord | null = null;
before(() => { process.env.NEXTAUTH_SECRET = testSecret; });
after(() => {
  sessionValidationData.findUser = previousLookup;
  if (previousSecret === undefined) delete process.env.NEXTAUTH_SECRET;
  else process.env.NEXTAUTH_SECRET = previousSecret;
});

async function requestAs(path: string, claims?: JWT) {
  const headers = new Headers();
  if (claims) {
    currentUser = { id: "u1", email: "test@example.com", name: "Test", passwordHash: "test-hash", status: "ACTIVE",
      roleName: String(claims.role), roleTitle: claims.roleTitle ?? null, skill: null, lob: claims.lob ?? null,
      mustChangePassword: Boolean(claims.mustChangePassword), temporaryPassword: false, updatedAt: new Date("2026-09-06T12:00:00Z"),
      passwordChangedAt: new Date(), lastPasswordResetAt: null };
    sessionValidationData.findUser = async () => currentUser;
    const token = await encode({ token: { ...claims, sub: currentUser.id, email: currentUser.email, authVersion: sessionAuthVersion(currentUser) }, secret: testSecret, maxAge: 60 });
    headers.set("authorization", `Bearer ${token}`);
  }
  return middleware(new NextRequest(`http://localhost${path}`, { headers }));
}

test("middleware libera as telas pessoais de POC ADS sem liberar Performance geral ou Staff", async () => {
  const poc = { role: "POC", roleTitle: "Agente", lob: "ADS" };
  for (const path of ["/performance/meus-dados", "/api/performance/me", "/campanha", "/campanha/agente", "/api/campaigns/raffle"]) {
    const response = await requestAs(path, poc);
    assert.equal(response.headers.get("x-middleware-next"), "1", path);
  }
  for (const path of ["/api/performance", "/api/performance/export", "/api/performance/import"]) {
    assert.equal((await requestAs(path, poc)).status, 403, path);
  }
  for (const path of ["/performance", "/campanha/staff"]) {
    assert.equal((await requestAs(path, poc)).status, 307, path);
  }
});

test("middleware returns 401 for revoked API sessions before any service can run", async () => {
  await requestAs("/api/employees/reset-password", { role: "ADMIN" });
  const claims = { sub: currentUser!.id, email: currentUser!.email, role: "ADMIN", authVersion: sessionAuthVersion(currentUser!) };
  currentUser = { ...currentUser!, status: "BLOCKED" };
  const token = await encode({ token: claims, secret: testSecret, maxAge: 60 });
  const response = await middleware(new NextRequest("http://localhost/api/employees/reset-password", { headers: { authorization: `Bearer ${token}` } }));
  assert.equal(response.status, 401);
  assert.match((await response.json()).message, /Entre novamente/);
});

test("middleware não concede Rifa ao POC de outra LOB", async () => {
  for (const lob of ["CEC", "VIDEO"]) {
    const poc = { role: "POC", roleTitle: "Agente", lob };
    assert.equal((await requestAs("/api/performance/me", poc)).status, 200);
    assert.equal((await requestAs("/campanha", poc)).status, 307);
    assert.equal((await requestAs("/api/campaigns/raffle", poc)).status, 403);
  }
});

test("sessões atuais de POC e agente sem LOB chegam à validação da Rifa no servidor", async () => {
  for (const role of ["POC", "COLABORADOR"]) {
    const response = await requestAs("/api/campaigns/raffle", { role, roleTitle: "Agente" });
    assert.equal(response.headers.get("x-middleware-next"), "1", role);
    assert.equal((await requestAs("/api/performance", { role, roleTitle: "Agente" })).status, 403);
  }
  assert.equal((await requestAs("/api/campaigns/raffle", { role: "RTA", roleTitle: "Agente" })).status, 403);
});

test("middleware rejects legacy unversioned sessions and explains the new login", async () => {
  await requestAs("/api/employees", { role: "ADMIN" });
  const token = await encode({ token: { sub: currentUser!.id, email: currentUser!.email, role: "ADMIN" }, secret: testSecret, maxAge: 60 });
  const headers = { authorization: `Bearer ${token}` };
  assert.equal((await middleware(new NextRequest("http://localhost/api/employees", { headers }))).status, 401);
  const response = await middleware(new NextRequest("http://localhost/configuracoes", { headers }));
  assert.equal(new URL(response.headers.get("location")!).searchParams.get("reason"), "session-expired");
});

test("telas pessoais continuam exigindo autenticação e troca de senha obrigatória", async () => {
  for (const path of ["/performance/meus-dados", "/campanha"]) {
    const unauthenticated = await requestAs(path);
    assert.equal(new URL(unauthenticated.headers.get("location")!).pathname, "/login");
    const changePassword = await requestAs(path, { role: "POC", roleTitle: "Agente", lob: "ADS", mustChangePassword: true });
    assert.equal(new URL(changePassword.headers.get("location")!).pathname, "/alterar-senha");
  }
});
