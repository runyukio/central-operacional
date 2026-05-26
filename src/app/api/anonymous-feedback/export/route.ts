import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { EngagementError, exportAnonymousFeedbackCsv } from "@/lib/engagement-service";

export async function GET(request: Request) {
  const actor = await getApiActor();
  const url = new URL(request.url);
  try {
    const csv = await exportAnonymousFeedbackCsv(actor, {
      startDate: url.searchParams.get("startDate") ?? undefined,
      endDate: url.searchParams.get("endDate") ?? undefined,
      category: url.searchParams.get("category") ?? undefined,
      urgency: url.searchParams.get("urgency") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      lobId: url.searchParams.get("lobId") ?? undefined,
      jobTitle: url.searchParams.get("jobTitle") ?? undefined,
      search: url.searchParams.get("search") ?? undefined
    });
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="feedback_anonimo.csv"`
      }
    });
  } catch (error) {
    if (error instanceof EngagementError) {
      return NextResponse.json({ error: error.message, message: error.message }, { status: error.status });
    }
    console.error("[anonymous-feedback/export] erro inesperado", error);
    return NextResponse.json({ error: "Não foi possível exportar Feedback Anônimo." }, { status: 500 });
  }
}
