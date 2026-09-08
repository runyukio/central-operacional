import { getApiActor } from "@/lib/api-actor";
import { getMeuEspacoScope } from "@/lib/meu-espaco-scope";
import { getSpaceSummary, listSpacePending } from "@/lib/meu-espaco-pending-service";
import { getSpaceResults } from "@/lib/meu-espaco-results-service";
import { spaceApiError, spaceJson } from "@/lib/meu-espaco-api";
import { spacePeriod } from "@/lib/meu-espaco-filters";
import { MeuEspacoError } from "@/lib/meu-espaco-access";
import { listOperationalWorkHours } from "@/lib/work-hours-service";

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
    const page = Number(query.get("page") || 1);
    if (!Number.isSafeInteger(page) || page < 1 || page > 10000) throw new MeuEspacoError("Página inválida.");
    const result = await listOperationalWorkHours(scope.actor, { ...spacePeriod(query), page, limit: 50,
      employeeId: employeeId || undefined, collaborator: (query.get("search") || "").slice(0, 120), lob: query.get("lob") || undefined }, scope.employeeIds);
    if ("error" in result) throw new MeuEspacoError(result.error || "Não foi possível consultar horas.", 500);
    // Read-only DTO: adjustment actions and personal audit fields are not exposed here.
    return spaceJson({ pagination: result.pagination, period: result.period, data: result.data.map((row) => ({ id: row.id, employeeId: row.employeeId,
      employeeName: row.employeeName, wbLogin: row.wbLogin, date: row.date, lob: row.lob, plannedHours: row.plannedHours,
      actualHours: row.actualHours, capturedHours: row.capturedHours, effectiveHours: row.effectiveHours, adjustedHours: row.adjustedHours,
      differenceMinutes: row.differenceMinutes, status: row.status })) });
  } catch (error) { return spaceApiError(error); }
}
