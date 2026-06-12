import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { listMuralBirthdays, MuralError } from "@/lib/mural-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await getApiActor();
    return NextResponse.json(await listMuralBirthdays(actor));
  } catch (error) {
    if (error instanceof MuralError) {
      return NextResponse.json({ success: false, error: error.message, message: error.message, fields: error.fields }, { status: error.status });
    }
    console.error("[mural/birthdays] erro inesperado", error);
    return NextResponse.json({ success: false, error: "Não foi possível carregar aniversários.", message: "Não foi possível carregar aniversários." }, { status: 500 });
  }
}
