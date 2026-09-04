import assert from "node:assert/strict";
import test from "node:test";

import { updateSupabasePasswordIfPresent } from "./supabase-auth";

const originalEnv = {
  APP_ENV: process.env.APP_ENV,
  USE_LOCAL_DB: process.env.USE_LOCAL_DB,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY
};
const originalFetch = globalThis.fetch;

test.beforeEach(() => {
  process.env.APP_ENV = "production";
  delete process.env.USE_LOCAL_DB;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-anon-value";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "private-service-value";
});

test.afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  globalThis.fetch = originalFetch;
});

test("atualiza somente a identidade do Supabase com e-mail exato", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, init });
    if (requests.length === 1) {
      return new Response(JSON.stringify({ users: [
        { id: "wrong", email: "another@example.com" },
        { id: "right/id", email: "Agent@Example.com" }
      ] }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  };

  const result = await updateSupabasePasswordIfPresent("agent@example.com", "nova-senha");
  assert.equal(result, "UPDATED");
  assert.match(requests[0].url, /admin\/users\?filter=agent%40example.com/);
  assert.equal(requests[1].url, "https://project.supabase.co/auth/v1/admin/users/right%2Fid");
  assert.equal(requests[1].init?.method, "PUT");
  assert.deepEqual(JSON.parse(String(requests[1].init?.body)), { password: "nova-senha" });
});

test("não envia alteração quando não existe identidade correspondente", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ users: [{ id: "u2", email: "other@example.com" }] }), { status: 200 });
  };

  assert.equal(await updateSupabasePasswordIfPresent("agent@example.com", "nova-senha"), "NOT_FOUND");
  assert.equal(calls, 1);
});

test("não acessa a API administrativa sem service role configurada", async () => {
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  let called = false;
  globalThis.fetch = async () => { called = true; return new Response(); };

  assert.equal(await updateSupabasePasswordIfPresent("agent@example.com", "nova-senha"), "NOT_CONFIGURED");
  assert.equal(called, false);
});
