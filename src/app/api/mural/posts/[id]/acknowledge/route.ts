import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { acknowledgeMuralPost, MuralError } from "@/lib/mural-service";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const actor = await getApiActor();
    return NextResponse.json(await acknowledgeMuralPost(actor, id));
  } catch (error) {
    if (error instanceof MuralError) {
      return NextResponse.json({ success: false, error: error.message, message: error.message, fields: error.fields }, { status: error.status });
    }
    console.error("[mural/acknowledge] erro inesperado", error);
    return NextResponse.json({ success: false, error: "Não foi possível registrar ciência.", message: "Não foi possível registrar ciência." }, { status: 500 });
  }
}
