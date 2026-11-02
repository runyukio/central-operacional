import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiActor } from "@/lib/api-actor";
import { errorResponse, errorStatus, mapZodError } from "@/lib/api-errors";
import { listOperationalWorkHourCaptures } from "@/lib/work-hours-service";

const schema = z.object({
  recordIds: z.array(z.string().min(1).max(200)).min(1).max(100),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
});

export async function POST(request: Request) {
  const actor = await getApiActor();
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return errorResponse(mapZodError(parsed.error));
  try {
    const result = await listOperationalWorkHourCaptures(actor, parsed.data);
    if ("error" in result) return NextResponse.json(result, { status: errorStatus(result as any) });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[work-hours/capture] falha ao consultar captura", error);
    return NextResponse.json({ error: "Não foi possível carregar as horas de captura." }, { status: 500 });
  }
}
