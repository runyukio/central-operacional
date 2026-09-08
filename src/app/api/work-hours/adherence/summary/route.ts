import { NextResponse } from "next/server";
import { getApiActor } from "@/lib/api-actor";
import { errorStatus, createServerError } from "@/lib/api-errors";
import { getWorkHourAdherenceSummary } from "@/lib/work-hours-capture-integration-service";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const result = await getWorkHourAdherenceSummary(await getApiActor(), {
      startDate: params.get("startDate") ?? undefined,
      endDate: params.get("endDate") ?? undefined
    });
    return NextResponse.json(result, { status: "error" in result ? errorStatus(result) : 200, headers });
  } catch (error) {
    return NextResponse.json(createServerError(error, "Não foi possível carregar o resumo de justificativas."), { status: 500, headers });
  }
}
