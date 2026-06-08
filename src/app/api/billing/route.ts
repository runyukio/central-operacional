import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import {
  adminDecideInvoiceAdjustment,
  createBillingAdjustment,
  getBillingDashboard,
  saveBillingRates,
  supervisorReviewInvoiceAdjustment,
  updateBillingCycleStatus
} from "@/lib/billing-service";

export async function GET(request: Request) {
  const actor = await getApiActor();
  const url = new URL(request.url);
  const result = await getBillingDashboard(actor, {
    referenceMonth: url.searchParams.get("referenceMonth"),
    startDate: url.searchParams.get("startDate"),
    endDate: url.searchParams.get("endDate"),
    lob: url.searchParams.get("lob"),
    supervisorId: url.searchParams.get("supervisorId"),
    skill: url.searchParams.get("skill"),
    shiftId: url.searchParams.get("shiftId"),
    employeeStatus: url.searchParams.get("employeeStatus"),
    invoiceStatus: url.searchParams.get("invoiceStatus"),
    cycleStatus: url.searchParams.get("cycleStatus"),
    search: url.searchParams.get("search"),
    section: url.searchParams.get("section")
  });
  if ("error" in result) return NextResponse.json({ error: result.error, message: result.error }, { status: result.status ?? 400 });
  return NextResponse.json(result);
}

export async function POST(request: Request) {
  const actor = await getApiActor();
  const body = await request.json().catch(() => ({}));
  const action = String(body.action ?? "");
  const result =
    action === "set-cycle-status"
      ? await updateBillingCycleStatus(actor, { referenceMonth: body.referenceMonth, status: String(body.status ?? "") })
      : action === "save-rates"
        ? await saveBillingRates(actor, body.rates ?? {})
        : action === "create-adjustment"
          ? await createBillingAdjustment(actor, body)
          : action === "supervisor-review-adjustment"
            ? await supervisorReviewInvoiceAdjustment(actor, { id: String(body.id ?? ""), observation: String(body.observation ?? "") })
            : action === "admin-decide-adjustment"
              ? await adminDecideInvoiceAdjustment(actor, {
                id: String(body.id ?? ""),
                decision: body.decision === "RECUSADO" ? "RECUSADO" : "APROVADO",
                finalResponse: String(body.finalResponse ?? ""),
                adjustmentAmount: body.adjustmentAmount === "" ? null : Number(body.adjustmentAmount ?? 0),
                finalMinutes: body.finalMinutes === "" || body.finalMinutes === undefined ? null : Number(body.finalMinutes)
              })
              : { error: "Ação de Billing inválida.", status: 400 };
  if ("error" in result) return NextResponse.json({ error: result.error, message: result.error }, { status: result.status ?? 400 });
  return NextResponse.json(result);
}
