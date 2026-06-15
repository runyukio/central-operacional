import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { listMuralPostAcknowledgements, MuralError } from "@/lib/mural-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: { id: string } }) {
  try {
    const actor = await getApiActor();
    const url = new URL(request.url);
    return NextResponse.json(await listMuralPostAcknowledgements(actor, context.params.id, {
      status: url.searchParams.get("status"),
      lobId: url.searchParams.get("lobId"),
      role: url.searchParams.get("role"),
      supervisorId: url.searchParams.get("supervisorId"),
      q: url.searchParams.get("q")
    }));
  } catch (error) {
    if (error instanceof MuralError) {
      return NextResponse.json({ success: false, error: error.message, message: error.message, fields: error.fields }, { status: error.status });
    }
    console.error("[mural/acknowledgements] erro inesperado", error);
    return NextResponse.json({ success: false, error: "Não foi possível carregar aderência.", message: "Não foi possível carregar aderência." }, { status: 500 });
  }
}
