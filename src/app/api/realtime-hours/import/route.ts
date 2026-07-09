import { NextResponse } from "next/server";

import { importRealtimeHoursSnapshot, validateRealtimeHoursImportToken } from "@/lib/realtime-hours-service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const tokenValidation = validateRealtimeHoursImportToken(request.headers.get("authorization"));
  if ("error" in tokenValidation) {
    return NextResponse.json({ success: false, error: tokenValidation.error, message: tokenValidation.error }, { status: tokenValidation.status });
  }

  try {
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({
        success: false,
        error: "JSON inválido no corpo da requisição.",
        message: "JSON inválido no corpo da requisição."
      }, { status: 400 });
    }

    const result = await importRealtimeHoursSnapshot(body);
    if ("error" in result) {
      const status = typeof result.status === "number" ? result.status : 400;
      return NextResponse.json(result, { status });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error("[realtime-hours/import] erro inesperado", error);
    return NextResponse.json({
      success: false,
      error: "Não foi possível importar o snapshot de horas em tempo real.",
      message: "Não foi possível importar o snapshot de horas em tempo real."
    }, { status: 500 });
  }
}
