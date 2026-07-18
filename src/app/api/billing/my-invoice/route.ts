import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { approveMyBillingInvoice, getMyBillingInvoice, retryMyBillingInvoiceOmie, submitInvoiceAdjustmentRequest } from "@/lib/billing-service";

export async function GET(request: Request) {
  const actor = await getApiActor();
  const url = new URL(request.url);
  const result = await getMyBillingInvoice(actor, url.searchParams.get("referenceMonth"));
  if ("error" in result) return NextResponse.json({ error: result.error, message: result.error }, { status: result.status ?? 400 });
  return NextResponse.json(result);
}

export async function POST(request: Request) {
  const actor = await getApiActor();
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const action = String(form.get("action") ?? "");
    const fileValue = form.get("file");
    const result = action === "approve"
      ? await approveMyBillingInvoice(actor, {
        referenceMonth: String(form.get("referenceMonth") ?? ""),
        invoiceNumber: String(form.get("invoiceNumber") ?? ""),
        serviceDescription: String(form.get("serviceDescription") ?? ""),
        file: fileValue instanceof File && fileValue.size > 0 ? fileValue : null
      })
      : { error: "Ação de invoice inválida.", status: 400 };
    if ("error" in result) return NextResponse.json({ error: result.error, message: result.error }, { status: result.status ?? 400 });
    return NextResponse.json(result);
  }

  const body = await request.json().catch(() => ({}));
  const action = String(body.action ?? "");
  const result = action === "request-adjustment"
    ? await submitInvoiceAdjustmentRequest(actor, {
        referenceMonth: body.referenceMonth,
        type: String(body.type ?? ""),
        questionedItem: String(body.questionedItem ?? ""),
        description: String(body.description ?? "")
      })
    : action === "retry-omie"
      ? await retryMyBillingInvoiceOmie(actor, body.referenceMonth)
      : { error: "Ação de invoice inválida.", status: 400 };
  if ("error" in result) return NextResponse.json({ error: result.error, message: result.error }, { status: result.status ?? 400 });
  return NextResponse.json(result);
}
