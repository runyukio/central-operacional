import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import { createPermissionError, createServerError, errorResponse, errorStatus, mapZodError } from "@/lib/api-errors";
import { canImportWorkHours } from "@/lib/permissions";
import { auditPermissionDenied } from "@/lib/permission-audit";
import { commitOperationalWorkHoursImport } from "@/lib/work-hours-service";

const commitSchema = z.object({
  fileName: z.string().min(1),
  allowPartial: z.boolean().default(false),
  rows: z.array(z.record(z.unknown())).default([])
});

export async function POST(request: Request) {
  try {
    const parsed = commitSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return errorResponse(mapZodError(parsed.error));

    console.info("[work-hours-import:commit-route]", { fileName: parsed.data.fileName, totalRows: parsed.data.rows.length, allowPartial: parsed.data.allowPartial });
    const actor = await getApiActor();
    if (!canImportWorkHours({ role: actor.role, status: "ACTIVE" })) {
      const reason = actor.role === "SUPERVISOR" ? "Apenas WFM ou ADMIN podem importar Horas Operacionais." : "Você não tem permissão para importar horas.";
      await auditPermissionDenied(actor, { action: "WORK_HOURS_IMPORT_COMMIT", entity: "WorkHourRecord", reason });
      return errorResponse(createPermissionError(reason));
    }
    const result = await commitOperationalWorkHoursImport(actor, parsed.data);
    if ("error" in result) return NextResponse.json(result, { status: errorStatus(result as any) || 409 });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[work-hours-import:commit-route] falha inesperada", error);
    return errorResponse(createServerError(error, "Não foi possível confirmar a importação de horas. Tente novamente ou contate o administrador."));
  }
}
