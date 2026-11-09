import { NextResponse } from "next/server";
import { getApiActor } from "@/lib/api-actor";
import { getWorkstationSiteClassifications, saveWorkstationSiteClassification } from "@/lib/workstation-sites-service";

export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await getApiActor();
  try {
    const result = await getWorkstationSiteClassifications(actor);
    return NextResponse.json(result, { status: result.success ? 200 : result.status, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[activity/sites/classifications]", error);
    return NextResponse.json({ success: false, error: "Não foi possível carregar as classificações." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const actor = await getApiActor();
  const input: unknown = await request.json().catch(() => null);
  try {
    const result = await saveWorkstationSiteClassification(actor, input);
    return NextResponse.json(result, { status: result.success ? 200 : result.status, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[activity/sites/classifications]", error);
    return NextResponse.json({ success: false, error: "Não foi possível salvar a classificação. Tente novamente." }, { status: 500 });
  }
}
