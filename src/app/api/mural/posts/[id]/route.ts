import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { deleteMuralPost, getMuralPost, MuralError, updateMuralPost } from "@/lib/mural-service";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const actor = await getApiActor();
    return NextResponse.json(await getMuralPost(actor, id));
  } catch (error) {
    return muralErrorResponse(error);
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const actor = await getApiActor();
    return NextResponse.json(await updateMuralPost(actor, id, await request.json()));
  } catch (error) {
    return muralErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const actor = await getApiActor();
    return NextResponse.json(await deleteMuralPost(actor, id));
  } catch (error) {
    return muralErrorResponse(error);
  }
}

function muralErrorResponse(error: unknown) {
  if (error instanceof MuralError) {
    return NextResponse.json({ success: false, error: error.message, message: error.message, fields: error.fields }, { status: error.status });
  }
  console.error("[mural/post] erro inesperado", error);
  return NextResponse.json({ success: false, error: "Não foi possível carregar o aviso.", message: "Não foi possível carregar o aviso." }, { status: 500 });
}
