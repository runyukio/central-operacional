import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { EngagementError, exportAnonymousFeedbackXlsxData } from "@/lib/engagement-service";
import { buildXlsxResponse } from "@/lib/xlsx-export";

export async function GET(request: Request) {
  const actor = await getApiActor();
  const url = new URL(request.url);
  try {
    const payload = await exportAnonymousFeedbackXlsxData(actor, {
      startDate: url.searchParams.get("startDate") ?? undefined,
      endDate: url.searchParams.get("endDate") ?? undefined,
      category: url.searchParams.get("category") ?? undefined,
      urgency: url.searchParams.get("urgency") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      lobId: url.searchParams.get("lobId") ?? undefined,
      lob: url.searchParams.get("lob") ?? undefined,
      jobTitle: url.searchParams.get("jobTitle") ?? undefined,
      search: url.searchParams.get("search") ?? undefined
    });
    return buildXlsxResponse(payload);
  } catch (error) {
    if (error instanceof EngagementError) {
      return NextResponse.json({ error: error.message, message: error.message }, { status: error.status });
    }
    console.error("[anonymous-feedback/export] erro inesperado", error);
    return NextResponse.json({ error: "Não foi possível exportar Feedback Anônimo." }, { status: 500 });
  }
}
