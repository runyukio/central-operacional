import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import { createServerError, errorResponse, errorStatus, mapZodError } from "@/lib/api-errors";
import { importEmployeeRows } from "@/lib/employee-registration-service";

const schema = z.object({
  rows: z.array(z.record(z.unknown())).default([]),
  allowPartial: z.boolean().optional()
});

export async function POST(request: Request) {
  try {
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return errorResponse(mapZodError(parsed.error));
    }

    const actor = await getApiActor();
    const result = await importEmployeeRows(actor, parsed.data.rows, Boolean(parsed.data.allowPartial));
    if ("error" in result) return NextResponse.json(result, { status: errorStatus(result as any) || 409 });

    return NextResponse.json(result);
  } catch (error) {
    console.error("[employee-import:commit-route] falha inesperada", error);
    return errorResponse(createServerError(error, "Não foi possível confirmar a importação de colaboradores. Tente novamente ou contate o administrador."));
  }
}
