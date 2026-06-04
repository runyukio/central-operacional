import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import {
  AdditionalRegistrationDataError,
  exportAdditionalRegistrationDataTracking
} from "@/lib/additional-registration-data-service";
import { buildXlsxResponse } from "@/lib/xlsx-export";

export async function GET(request: Request) {
  const actor = await getApiActor();
  const url = new URL(request.url);
  try {
    const payload = await exportAdditionalRegistrationDataTracking(actor, {
      status: url.searchParams.get("status") ?? undefined,
      lob: url.searchParams.get("lob") ?? undefined,
      supervisorId: url.searchParams.get("supervisorId") ?? undefined,
      role: url.searchParams.get("role") ?? undefined,
      skill: url.searchParams.get("skill") ?? undefined,
      wave: url.searchParams.get("wave") ?? undefined,
      search: url.searchParams.get("search") ?? undefined
    });
    return buildXlsxResponse(payload);
  } catch (error) {
    if (error instanceof AdditionalRegistrationDataError) {
      return NextResponse.json({ error: error.message, message: error.message, fields: error.fields ?? {} }, { status: error.status });
    }
    console.error("[employee-additional-data/export] erro inesperado", error);
    return NextResponse.json({ error: "Não foi possível exportar Dados Cadastrais Adicionais." }, { status: 500 });
  }
}
