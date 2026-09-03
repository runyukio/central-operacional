import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, test } from "node:test";
import { encode, type JWT } from "next-auth/jwt";
import { NextRequest } from "next/server";

import { middleware } from "./middleware";

const testSecret = randomBytes(32).toString("hex");
const previousSecret = process.env.NEXTAUTH_SECRET;
before(() => { process.env.NEXTAUTH_SECRET = testSecret; });
after(() => {
  if (previousSecret === undefined) delete process.env.NEXTAUTH_SECRET;
  else process.env.NEXTAUTH_SECRET = previousSecret;
});

async function requestAs(path: string, claims?: JWT) {
  const headers = new Headers();
  if (claims) {
    const token = await encode({ token: claims, secret: testSecret, maxAge: 60 });
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

test("middleware não concede Rifa ao POC de outra LOB", async () => {
  for (const lob of ["CEC", "VIDEO"]) {
    const poc = { role: "POC", roleTitle: "Agente", lob };
    assert.equal((await requestAs("/api/performance/me", poc)).status, 200);
    assert.equal((await requestAs("/campanha", poc)).status, 307);
    assert.equal((await requestAs("/api/campaigns/raffle", poc)).status, 403);
  }
});

test("sessões antigas de POC e agente sem LOB chegam à validação da Rifa no servidor", async () => {
  for (const role of ["POC", "COLABORADOR"]) {
    const response = await requestAs("/api/campaigns/raffle", { role, roleTitle: "Agente" });
    assert.equal(response.headers.get("x-middleware-next"), "1", role);
    assert.equal((await requestAs("/api/performance", { role, roleTitle: "Agente" })).status, 403);
  }
  assert.equal((await requestAs("/api/campaigns/raffle", { role: "RTA", roleTitle: "Agente" })).status, 403);
});

test("telas pessoais continuam exigindo autenticação e troca de senha obrigatória", async () => {
  for (const path of ["/performance/meus-dados", "/campanha"]) {
    const unauthenticated = await requestAs(path);
    assert.equal(new URL(unauthenticated.headers.get("location")!).pathname, "/login");
    const changePassword = await requestAs(path, { role: "POC", roleTitle: "Agente", lob: "ADS", mustChangePassword: true });
    assert.equal(new URL(changePassword.headers.get("location")!).pathname, "/alterar-senha");
  }
});
