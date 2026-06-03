import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import { createOperationalRequest, getOperationalRequest, listOperationalRequests } from "@/lib/request-service";

const createRequestSchema = z.object({
  type: z.string().min(1),
  title: z.string().min(1),
  priority: z.enum(["Baixa", "Média", "Alta", "Crítica"]).default("Média"),
  description: z.string().min(1),
  dayOffKind: z.enum(["DAY_OFF_SWAP", "DAY_OFF_SELL", "DAY_OFF_REQUEST"]).optional(),
  requestedDate: z.string().optional(),
  currentDayOffDate: z.string().optional(),
  desiredDayOffDate: z.string().optional(),
  dayOffToSellDate: z.string().optional(),
  availabilityShift: z.string().optional(),
  preferredStartTime: z.string().optional(),
  preferredEndTime: z.string().optional(),
  acknowledgement: z.boolean().optional(),
  desiredDayOffRequestDate: z.string().optional(),
  dayOffReason: z.string().optional(),
  urgency: z.enum(["Baixa", "Média", "Alta", "Crítica"]).optional(),
  justification: z.string().optional(),
  attachmentUrl: z.string().optional(),
  monthlyAdvanceReferenceMonth: z.string().optional(),
  currentAdvanceOptIn: z.boolean().optional(),
  requestedAdvanceOptIn: z.boolean().optional(),
  currentAdvanceAmount: z.number().optional(),
  requestedAdvanceAmount: z.number().optional(),
  monthlyAdvanceReason: z.string().optional(),
  shiftChangeType: z.enum(["Fixa", "Temporária"]).optional(),
  shiftChangeDate: z.string().optional(),
  shiftChangeStartDate: z.string().optional(),
  shiftChangeEndDate: z.string().optional(),
  currentShift: z.string().optional(),
  desiredShift: z.string().optional(),
  shiftChangeReason: z.string().optional(),
  shiftChangeObservation: z.string().optional()
});

export async function GET(request: Request) {
  const actor = await getApiActor();
  const url = new URL(request.url);
  const detailId = url.searchParams.get("id") ?? url.searchParams.get("request");
  if (detailId) {
    const data = await getOperationalRequest(actor, detailId);
    if (!data) return NextResponse.json({ error: "Solicitação não encontrada." }, { status: 404 });
    return NextResponse.json({ data, actor: { role: actor.role, name: actor.name } });
  }

  const result = await listOperationalRequests(actor, {
    type: url.searchParams.get("type") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    priority: url.searchParams.get("priority") ?? undefined,
    requester: url.searchParams.get("requester") ?? undefined,
    assignee: url.searchParams.get("assignee") ?? undefined,
    assignedTo: url.searchParams.get("assignedTo") ?? undefined,
    date: url.searchParams.get("date") ?? undefined,
    startDate: url.searchParams.get("startDate") ?? undefined,
    endDate: url.searchParams.get("endDate") ?? undefined,
    lob: url.searchParams.get("lob") ?? undefined,
    supervisor: url.searchParams.get("supervisor") ?? undefined,
    supervisorId: url.searchParams.get("supervisorId") ?? undefined,
    collaborator: url.searchParams.get("collaborator") ?? undefined,
    employeeId: url.searchParams.get("employeeId") ?? undefined,
    wbLogin: url.searchParams.get("wbLogin") ?? undefined,
    search: url.searchParams.get("search") ?? undefined,
    pendingAction: url.searchParams.get("pendingAction") ?? undefined,
    scope: url.searchParams.get("scope") === "mine" ? "mine" : "all",
    page: url.searchParams.get("page") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined
  });
  return NextResponse.json({ ...result, actor: { role: actor.role, name: actor.name } });
}

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = createRequestSchema.safeParse(body);

  if (!parsed.success) {
    const flattened = parsed.error.flatten();
    const fieldErrors = Object.fromEntries(
      Object.entries(flattened.fieldErrors).map(([field, messages]) => [field, messages?.[0] ?? "Campo inválido."])
    );
    return NextResponse.json({
      success: false,
      type: "VALIDATION_ERROR",
      message: "Não foi possível criar a solicitação. Revise os campos destacados.",
      error: "Não foi possível criar a solicitação. Revise os campos destacados.",
      fieldErrors,
      issues: flattened
    }, { status: 400 });
  }

  const actor = await getApiActor();
  const result = await createOperationalRequest(actor, parsed.data);
  if ("error" in result) {
    const message = result.message ?? result.error;
    return NextResponse.json({
      success: false,
      type: result.type ?? "REQUEST_ERROR",
      message,
      error: message,
      fieldErrors: result.fieldErrors ?? {}
    }, { status: result.status ?? 400 });
  }
  return NextResponse.json({ data: result.data, persisted: result.persisted }, { status: 201 });
}
