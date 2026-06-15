import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { exportFormalFeedbackXlsxData, FormalFeedbackError } from "@/lib/formal-feedback-service";
import { buildXlsxResponse } from "@/lib/xlsx-export";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await getApiActor();
  const url = new URL(request.url);
  try {
    const payload = await exportFormalFeedbackXlsxData(actor, {
      startDate: url.searchParams.get("startDate") ?? undefined,
      endDate: url.searchParams.get("endDate") ?? undefined,
      employeeId: url.searchParams.get("employeeId") ?? undefined,
      authorId: url.searchParams.get("authorId") ?? undefined,
      type: url.searchParams.get("type") ?? undefined,
      category: url.searchParams.get("category") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      lob: url.searchParams.get("lob") ?? undefined,
      jobTitle: url.searchParams.get("jobTitle") ?? undefined,
      skill: url.searchParams.get("skill") ?? undefined,
      supervisor: url.searchParams.get("supervisor") ?? undefined,
      search: url.searchParams.get("search") ?? undefined
    });
    return buildXlsxResponse(payload);
  } catch (error) {
    if (error instanceof FormalFeedbackError) {
      return NextResponse.json({ error: error.message, message: error.message }, { status: error.status });
    }
    console.error("[feedbacks/export] erro inesperado", error);
    return NextResponse.json({ error: "Não foi possível exportar Feedback Formal.", message: "Não foi possível exportar Feedback Formal." }, { status: 500 });
  }
}
