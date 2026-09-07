import { NextResponse } from "next/server";
import { getApiActor } from "@/lib/api-actor";
import { errorStatus, createServerError } from "@/lib/api-errors";
import { getWorkHourAdherenceFilterOptions } from "@/lib/work-hours-capture-integration-service";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  try {
    const result = await getWorkHourAdherenceFilterOptions(await getApiActor(), {
      startDate: params.get("startDate") ?? undefined,
      endDate: params.get("endDate") ?? undefined,
      lob: params.get("lob") ?? undefined
    });
    return NextResponse.json(result, { status: "error" in result ? errorStatus(result) : 200 });
  } catch (error) {
    return NextResponse.json(createServerError(error, "Não foi possível carregar os filtros de justificativas."), { status: 500 });
  }
}
