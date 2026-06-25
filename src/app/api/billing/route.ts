import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import {
  adminDecideInvoiceAdjustment,
  createBillingAdjustment,
  deleteBillingAdjustment,
  getBillingDashboard,
  releaseEmployeeBillingInvoiceForReview,
  saveBillingRates,
  setEmployeeBillingInvoiceFinalized,
  supervisorReviewInvoiceAdjustment,
  updateBillingAdjustment,
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
    employeeId: url.searchParams.get("employeeId"),
    employeeStatus: url.searchParams.get("employeeStatus"),
    invoiceStatus: url.searchParams.get("invoiceStatus"),
    cycleStatus: url.searchParams.get("cycleStatus"),
    roleTitle: url.searchParams.get("roleTitle"),
    billingRule: url.searchParams.get("billingRule"),
    adjustmentType: url.searchParams.get("adjustmentType"),
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
  let result;
  switch (action) {
    case "set-cycle-status":
      result = await updateBillingCycleStatus(actor, { referenceMonth: body.referenceMonth, status: String(body.status ?? "") });
      break;
    case "save-rates":
      result = await saveBillingRates(actor, body.rates ?? {});
      break;
    case "create-adjustment":
      result = await createBillingAdjustment(actor, body);
      break;
    case "update-adjustment":
      result = await updateBillingAdjustment(actor, {
        id: String(body.id ?? ""),
        type: String(body.type ?? ""),
        description: String(body.description ?? ""),
        amount: Number(body.amount ?? NaN)
      });
      break;
    case "delete-adjustment":
      result = await deleteBillingAdjustment(actor, { id: String(body.id ?? "") });
      break;
    case "set-employee-invoice-finalized":
      result = await setEmployeeBillingInvoiceFinalized(actor, {
        referenceMonth: body.referenceMonth,
        employeeId: String(body.employeeId ?? ""),
        finalized: Boolean(body.finalized)
      });
      break;
    case "release-employee-invoice-review":
      result = await releaseEmployeeBillingInvoiceForReview(actor, {
        referenceMonth: body.referenceMonth,
        employeeId: String(body.employeeId ?? "")
      });
      break;
    case "supervisor-review-adjustment":
      result = await supervisorReviewInvoiceAdjustment(actor, { id: String(body.id ?? ""), observation: String(body.observation ?? "") });
      break;
    case "admin-decide-adjustment":
      result = await adminDecideInvoiceAdjustment(actor, {
        id: String(body.id ?? ""),
        decision: body.decision === "RECUSADO" ? "RECUSADO" : "APROVADO",
        finalResponse: String(body.finalResponse ?? ""),
        adjustmentAmount: body.adjustmentAmount === "" ? null : Number(body.adjustmentAmount ?? 0),
        finalMinutes: body.finalMinutes === "" || body.finalMinutes === undefined ? null : Number(body.finalMinutes)
      });
      break;
    default:
      result = { error: "Ação de Billing inválida.", status: 400 };
  }
  if ("error" in result) return NextResponse.json({ error: result.error, message: result.error }, { status: result.status ?? 400 });
  return NextResponse.json(result);
}
