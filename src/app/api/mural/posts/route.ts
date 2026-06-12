import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { createMuralPost, listMuralPosts, MuralError } from "@/lib/mural-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await getApiActor();
    const url = new URL(request.url);
    return NextResponse.json(await listMuralPosts(actor, url.searchParams));
  } catch (error) {
    return muralErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await getApiActor();
    return NextResponse.json(await createMuralPost(actor, await request.json()));
  } catch (error) {
    return muralErrorResponse(error);
  }
}

function muralErrorResponse(error: unknown) {
  if (error instanceof MuralError) {
    return NextResponse.json({ success: false, error: error.message, message: error.message, fields: error.fields }, { status: error.status });
  }
  console.error("[mural/posts] erro inesperado", error);
  return NextResponse.json({ success: false, error: "Não foi possível carregar o Mural.", message: "Não foi possível carregar o Mural." }, { status: 500 });
}
