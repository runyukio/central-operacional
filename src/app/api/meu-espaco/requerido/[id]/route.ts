import { getApiActor } from "@/lib/api-actor";
import { getMeuEspacoScope } from "@/lib/meu-espaco-scope";
import { justifySpaceCoverage } from "@/lib/meu-espaco-coverage-service";
import { spaceApiError, spaceJson } from "@/lib/meu-espaco-api";
import { MeuEspacoError } from "@/lib/meu-espaco-access";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const origin = request.headers.get("origin");
    if (!origin || new URL(origin).origin !== new URL(request.url).origin) throw new MeuEspacoError("Origem da solicitação inválida.", 403);
    const actor = await getApiActor(), { id } = await context.params;
    const scope = await getMeuEspacoScope(actor, new URL(request.url).searchParams.get("supervisorId") || undefined);
    if (Number(request.headers.get("content-length") || 0) > 20000) throw new MeuEspacoError("Justificativa muito longa.", 413);
    const raw = await request.text();
    if (raw.length > 20000) throw new MeuEspacoError("Justificativa muito longa.", 413);
    let body;
    try { body = JSON.parse(raw); } catch { throw new MeuEspacoError("Justificativa inválida."); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new MeuEspacoError("Justificativa inválida.");
    return spaceJson(await justifySpaceCoverage(scope, id, { supervisorId: typeof body.supervisorId === "string" ? body.supervisorId : undefined, text: typeof body.text === "string" ? body.text : "", requestId: typeof body.requestId === "string" ? body.requestId : "" }));
  } catch (error) { return spaceApiError(error); }
}
