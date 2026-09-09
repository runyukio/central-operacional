import { MeuEspacoError } from "./meu-espaco-access";
import { spaceLobFamily } from "./meu-espaco-metrics";
import { isSpaceMaterialSkill } from "./meu-espaco-targets";
import type { MeuEspacoScope } from "./meu-espaco-scope";

/** Select only from the server-authorized current team; never fall back on an unknown ID. */
export function selectSpaceGlideEmployees(scope: Pick<MeuEspacoScope, "employees">, lob: string, metric: string, employeeId = "") {
  const selected = employeeId ? scope.employees.find((p) => p.id === employeeId) : undefined;
  if (employeeId && !selected) throw new MeuEspacoError("Parceiro fora do seu escopo de consulta.", 403);
  if (selected && spaceLobFamily(selected.lob.name) !== lob) throw new MeuEspacoError("O parceiro não pertence à operação selecionada.");
  const eligible = scope.employees.filter((p) => (!employeeId || p.id === employeeId)
    && spaceLobFamily(p.lob.name) === lob && (metric !== "materialDaily" || isSpaceMaterialSkill(p.skill))
    && (lob !== "TNS" || (!["aht", "latency"].includes(metric) || p.lob.name.toUpperCase() !== "COMMENTS") && (metric !== "commentsLatency" || p.lob.name.toUpperCase() !== "VIDEO")));
  if (selected && !eligible.length) throw new MeuEspacoError("Esta meta não se aplica à skill ou operação do parceiro.");
  return eligible;
}
