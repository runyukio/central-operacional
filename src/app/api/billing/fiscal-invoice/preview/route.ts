import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { previewBillingFiscalInvoice } from "@/lib/billing-service";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const actor = await getApiActor();

  try {
    const form = await request.formData();
    const fileValue = form.get("file");
    const result = await previewBillingFiscalInvoice(actor, {
      referenceMonth: String(form.get("referenceMonth") ?? ""),
      employeeId: String(form.get("employeeId") ?? ""),
      file: fileValue instanceof File && fileValue.size > 0 ? fileValue : null
    });
    if ("error" in result) {
      return NextResponse.json({ error: result.error, message: result.error }, { status: result.status ?? 400 });
    }
    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { error: "Não foi possível processar a nota fiscal enviada." },
      { status: 500 }
    );
  }
}
