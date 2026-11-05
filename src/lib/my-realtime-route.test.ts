import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

const localRequire = createRequire(import.meta.url);
const source = readFileSync(new URL("../app/api/realtime/me/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function harness(read: (actor: unknown) => Promise<unknown>) {
  const actor = { email: "own@example.test", role: "COLABORADOR" };
  const imports: Record<string, unknown> = {
    "@/lib/api-actor": { getApiActor: async () => actor },
    "@/lib/my-realtime-service": { getMyRealtime: read }
  };
  const compiledModule = { exports: {} as { GET: (request: Request) => Promise<Response> } };
  new Function("require", "exports", "module", compiled)((name: string) => imports[name] ?? localRequire(name), compiledModule.exports, compiledModule);
  return { ...compiledModule.exports, actor };
}

test("HTTP pessoal encaminha somente a sessão e impede cache compartilhado", async () => {
  const route = harness(async (actor) => {
    assert.deepEqual(actor, route.actor);
    return { success: true, employee: { wbLogin: "own" } };
  });
  const response = await route.GET(new Request("https://example.test/api/realtime/me"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal((await response.json()).employee.wbLogin, "own");
});

test("HTTP rejeita identidade, datas e quaisquer filtros sem consultar dados", async () => {
  for (const query of ["wbLogin=other", "employeeId=other", "role=ADMIN", "date=2026-11-01", "startDate=2026-01-01", "search=other"]) {
    const route = harness(async () => { assert.fail("Não deve consultar os dados com filtros"); });
    const response = await route.GET(new Request(`https://example.test/api/realtime/me?${query}`));
    assert.equal(response.status, 400, query);
    assert.equal((await response.json()).success, false);
  }
});

test("HTTP preserva recusas de autenticação, permissão e vínculo", async () => {
  for (const status of [401, 403, 404]) {
    const route = harness(async () => ({ error: "Consulta recusada", status }));
    const response = await route.GET(new Request("https://example.test/api/realtime/me"));
    assert.equal(response.status, status);
    assert.equal((await response.json()).success, false);
  }
});

test("HTTP falha com mensagem legível sem expor detalhes internos", async (t) => {
  t.mock.method(console, "error", () => {});
  const route = harness(async () => { throw new Error("private database details"); });
  const response = await route.GET(new Request("https://example.test/api/realtime/me"));
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.success, false);
  assert.doesNotMatch(body.message, /private/);
});
