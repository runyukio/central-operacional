import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { exportMuralPostAcknowledgements, MuralError } from "@/lib/mural-service";
import { buildXlsxResponse } from "@/lib/xlsx-export";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const actor = await getApiActor();
    const url = new URL(request.url);
    const payload = await exportMuralPostAcknowledgements(actor, id, {
      status: url.searchParams.get("status"),
      lobId: url.searchParams.get("lobId"),
      role: url.searchParams.get("role"),
      supervisorId: url.searchParams.get("supervisorId"),
      q: url.searchParams.get("q")
    });
    return buildXlsxResponse(payload);
  } catch (error) {
    if (error instanceof MuralError) {
      return NextResponse.json({ success: false, error: error.message, message: error.message, fields: error.fields }, { status: error.status });
    }
    console.error("[mural/acknowledgements/export] erro inesperado", error);
    return NextResponse.json({ success: false, error: "Não foi possível exportar aderência.", message: "Não foi possível exportar aderência." }, { status: 500 });
  }
}
