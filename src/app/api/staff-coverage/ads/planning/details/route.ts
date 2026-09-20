import { NextResponse } from "next/server";
import { getApiActor } from "@/lib/api-actor";
import { AdsCapacityError, readAdsCapacityPlan } from "@/lib/ads-capacity-service";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const actor = await getApiActor();
  try {
    const query = new URL(request.url).searchParams;
    const snapshot = await readAdsCapacityPlan(actor, { startDate: query.get("startDate") ?? undefined, endDate: query.get("endDate") ?? undefined, shift: query.get("shift") ?? undefined });
    if (query.get("version") !== snapshot.version) throw new AdsCapacityError("Os dados foram atualizados. Aplique novamente o período antes de abrir o detalhe.", 409);
    const row = snapshot.data.find((row) => row.key === query.get("key"));
    if (!row) throw new AdsCapacityError("Turno não encontrado no período selecionado.", 404);
    return NextResponse.json({ row, historyPeriod: snapshot.historyPeriod }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (!(error instanceof AdsCapacityError)) console.error("[ads-capacity] details failed", error);
    return NextResponse.json({ message: error instanceof AdsCapacityError ? error.message : "Não foi possível carregar os parceiros." }, { status: error instanceof AdsCapacityError ? error.status : 500 });
  }
}
