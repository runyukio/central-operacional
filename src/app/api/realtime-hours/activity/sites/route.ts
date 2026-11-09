import { NextResponse } from "next/server";
import { getApiActor } from "@/lib/api-actor";
import { getWorkstationSites } from "@/lib/workstation-sites-service";
import { buildWorkstationSitesReport } from "@/lib/workstation-sites-export";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await getApiActor();
  try {
    const params = new URL(request.url).searchParams;
    const data = await getWorkstationSites(actor, params);
    if (!data.success) return NextResponse.json(data, { status: data.status, headers: { "Cache-Control": "private, no-store" } });
    if (params.get("export") === "xlsx") {
      const response = buildWorkstationSitesReport(data);
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    }
    return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[activity/sites]", error);
    return NextResponse.json({ success: false, error: "Não foi possível consultar os sites. Tente novamente." }, { status: 500 });
  }
}
