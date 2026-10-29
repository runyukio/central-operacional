import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { MeuEspacoError } from "./meu-espaco-access";

const localRequire = createRequire(import.meta.url);
const source = readFileSync(new URL("../app/api/meu-espaco/pendencias/[kind]/[id]/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const calls: Array<Record<string, unknown>> = [];
const dependencies: Record<string, unknown> = {
  "@/lib/api-actor": { getApiActor: async () => ({ role: "ADMIN" }) },
  "@/lib/meu-espaco-scope": { getMeuEspacoScope: async () => ({ canRespond: true }) },
  "@/lib/meu-espaco-pending-service": { respondSpacePending: async (_scope: unknown, _kind: unknown, _id: unknown, input: Record<string, unknown>) => { calls.push(input); return { data: { status: "APPROVED" } }; } },
  "@/lib/meu-espaco-access": { MeuEspacoError },
  "@/lib/meu-espaco-api": { spaceJson: (data: unknown) => Response.json(data), spaceApiError: (error: MeuEspacoError) => Response.json({ error: error.message }, { status: error.status ?? 500 }) }
};
const route = { exports: {} as { POST: (request: Request, context: { params: Promise<{ kind: string; id: string }> }) => Promise<Response> } };
new Function("require", "exports", "module", compiled)((id: string) => dependencies[id] ?? localRequire(id), route.exports, route);
async function post(body: Record<string, unknown>) {
  calls.length = 0;
  return route.exports.POST(new Request("http://localhost/api/meu-espaco/pendencias/overtime/review", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ kind: "overtime", id: "review" }) });
}

test("Meu Espaço API blocks approval without a nonblank justification before calling the decision service", async () => {
  for (const justification of [undefined, "", " \n\t ", "x".repeat(10001)]) {
    const response = await post({ action: "approve", version: 1, justification });
    assert.equal(response.status, 400);
    assert.equal(calls.length, 0);
  }
  assert.equal((await post({ action: "approve", version: 1, rejectionReason: "Não é justificativa de aprovação" })).status, 400);
  assert.equal(calls.length, 0);
});

test("Meu Espaço API forwards the trimmed approval justification and keeps legacy rejection compatible", async () => {
  assert.equal((await post({ action: "approve", version: 1, justification: "  Cobertura extraordinária validada  " })).status, 200);
  assert.equal(calls[0].justification, "Cobertura extraordinária validada");
  assert.equal((await post({ action: "reject", version: 1, justification: "  Sessão indevida  " })).status, 200);
  assert.equal(calls[0].justification, "Sessão indevida");
  assert.equal((await post({ action: "reject", version: 1, rejectionReason: "  Sessão indevida  " })).status, 200);
  assert.equal(calls[0].rejectionReason, "Sessão indevida");
  assert.equal((await post({ action: "reject", version: 1 })).status, 400);
  assert.equal(calls.length, 0);
});
