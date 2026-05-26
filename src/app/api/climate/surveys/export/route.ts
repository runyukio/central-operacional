import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { EngagementError, exportClimateSurveyCsv } from "@/lib/engagement-service";

export async function GET() {
  const actor = await getApiActor();
  try {
    const csv = await exportClimateSurveyCsv(actor);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="pesquisa_clima.csv"`
      }
    });
  } catch (error) {
    if (error instanceof EngagementError) {
      return NextResponse.json({ error: error.message, message: error.message }, { status: error.status });
    }
    console.error("[climate/surveys/export] erro inesperado", error);
    return NextResponse.json({ error: "Não foi possível exportar Pesquisa de Clima." }, { status: 500 });
  }
}
