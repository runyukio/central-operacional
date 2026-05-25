import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import { commitMonthlyAdvanceImport } from "@/lib/monthly-advance-service";

const commitSchema = z.object({
  referenceMonth: z.string().optional(),
  rows: z.array(z.record(z.unknown()))
});

export async function POST(request: Request) {
  const parsed = commitSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos para importar adiantamento.", message: "Dados inválidos para importar adiantamento." }, { status: 400 });
  }

  const actor = await getApiActor();
  const result = await commitMonthlyAdvanceImport(actor, parsed.data.rows, parsed.data.referenceMonth);
  if ("error" in result) {
    const preview = "preview" in result ? result.preview : undefined;
    return NextResponse.json({ error: result.error, message: result.error, preview }, { status: result.status ?? 400 });
  }
  return NextResponse.json(result);
}
