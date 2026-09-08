import { NextResponse } from "next/server";
import { MeuEspacoError } from "@/lib/meu-espaco-access";

export function spaceJson(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "private, no-store" } });
}
export function spaceApiError(error: unknown) {
  if (error instanceof MeuEspacoError) return spaceJson({ error: error.message }, error.status);
  console.error("[Meu Espaço] Falha na consulta", error instanceof Error ? error.name : "UnknownError");
  return spaceJson({ error: "Não foi possível concluir. Tente novamente; seus dados não serão substituídos por zeros." }, 500);
}
