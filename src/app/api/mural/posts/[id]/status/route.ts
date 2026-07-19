import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { MuralError, updateMuralPostStatus } from "@/lib/mural-service";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const actor = await getApiActor();
    const body = await request.json();
    return NextResponse.json(await updateMuralPostStatus(actor, id, String(body.status ?? "")));
  } catch (error) {
    if (error instanceof MuralError) {
      return NextResponse.json({ success: false, error: error.message, message: error.message, fields: error.fields }, { status: error.status });
    }
    console.error("[mural/status] erro inesperado", error);
    return NextResponse.json({ success: false, error: "Não foi possível atualizar o aviso.", message: "Não foi possível atualizar o aviso." }, { status: 500 });
  }
}
