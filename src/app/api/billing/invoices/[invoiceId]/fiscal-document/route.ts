import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { getBillingFiscalInvoiceDownload } from "@/lib/billing-service";

export async function GET(_: Request, context: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await context.params;
  const actor = await getApiActor();
  const result = await getBillingFiscalInvoiceDownload(actor, invoiceId);
  if ("error" in result) {
    return NextResponse.json({ error: result.error, message: result.error }, { status: result.status ?? 400 });
  }

  return new NextResponse(new Uint8Array(result.data.body), {
    status: 200,
    headers: {
      "Content-Type": result.data.contentType,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.data.fileName)}`,
      "Cache-Control": "private, no-store"
    }
  });
}
