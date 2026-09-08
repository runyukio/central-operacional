import { getApiActor } from "@/lib/api-actor";
import { getMeuEspacoScope } from "@/lib/meu-espaco-scope";
import { getSpaceSummary, listSpacePending } from "@/lib/meu-espaco-pending-service";
import { getSpaceResults } from "@/lib/meu-espaco-results-service";
import { spaceApiError, spaceJson } from "@/lib/meu-espaco-api";
import { getSpaceMonthlyHours } from "@/lib/meu-espaco-hours-service";
import { MeuEspacoError } from "@/lib/meu-espaco-access";

export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ section: string }> }) {
  const actor = await getApiActor();
  try {
    const { section } = await context.params;
    if (!["resumo", "pendencias", "resultados", "horas"].includes(section)) throw new MeuEspacoError("Consulta não encontrada.", 404);
    const query = new URL(request.url).searchParams;
    const scope = await getMeuEspacoScope(actor, query.get("supervisorId") || undefined);
    const employeeId = query.get("employeeId");
    if (employeeId && !scope.employeeIds.includes(employeeId)) throw new MeuEspacoError("Parceiro fora do time autorizado.", 403);
    if (section === "resumo") return spaceJson(await getSpaceSummary(scope, query));
    if (section === "pendencias") return spaceJson(await listSpacePending(scope, query));
    if (section === "resultados") return spaceJson(await getSpaceResults(scope, query));
    return spaceJson(await getSpaceMonthlyHours(scope, query));
  } catch (error) { return spaceApiError(error); }
}
