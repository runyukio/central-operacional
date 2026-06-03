import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import { updateOperationalRequestStatus } from "@/lib/request-service";

const updateStatusSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["Aberto", "Em análise", "Aprovado", "Recusado", "Concluído", "Cancelado"]),
  reason: z.string().optional(),
  actionInput: z.object({
    finalApprovedShift: z.string().optional(),
    finalApprovedStartTime: z.string().optional(),
    finalApprovedEndTime: z.string().optional(),
    confirmCoverageWarning: z.union([z.boolean(), z.string()]).optional()
  }).optional()
});

export async function PATCH(request: Request) {
  const body = await request.json();
  const parsed = updateStatusSchema.safeParse(body);

  if (!parsed.success) {
    const flattened = parsed.error.flatten();
    const fieldErrors = Object.fromEntries(
      Object.entries(flattened.fieldErrors).map(([field, messages]) => [field, messages?.[0] ?? "Campo inválido."])
    );
    return NextResponse.json({
      success: false,
      type: "VALIDATION_ERROR",
      message: "Dados inválidos para atualizar a solicitação.",
      error: "Dados inválidos para atualizar a solicitação.",
      fieldErrors,
      issues: flattened
    }, { status: 400 });
  }

  const actor = await getApiActor();
  const result = await updateOperationalRequestStatus(actor, parsed.data.id, parsed.data.status, parsed.data.reason, parsed.data.actionInput);

  if (!result) {
    return NextResponse.json({ success: false, type: "NOT_FOUND", message: "Solicitação não encontrada.", error: "Solicitação não encontrada.", fieldErrors: {} }, { status: 404 });
  }

  if (result === "FORBIDDEN") {
    return NextResponse.json({ success: false, type: "FORBIDDEN", message: "Você não tem permissão para mover esta solicitação.", error: "Você não tem permissão para mover esta solicitação.", fieldErrors: {} }, { status: 403 });
  }

  if (!("data" in result)) {
    const errorResult = result as { error?: string; message?: string; type?: string; fieldErrors?: Record<string, string>; details?: Record<string, unknown>; status?: number };
    const message = errorResult.message ?? errorResult.error ?? "Não foi possível atualizar a solicitação.";
    return NextResponse.json({
      success: false,
      type: errorResult.type ?? "REQUEST_STATUS_ERROR",
      message,
      error: message,
      fieldErrors: errorResult.fieldErrors ?? {},
      details: errorResult.details ?? {},
      coverageImpact: errorResult.details?.coverageImpact
    }, { status: errorResult.status ?? 400 });
  }

  const successResult = result as { data: { id: string; status: string }; scheduleUpdated: boolean; persisted?: boolean };
  return NextResponse.json({
    success: true,
    data: successResult.data,
    request: successResult.data,
    message: `Solicitação ${successResult.data.id} atualizada para ${successResult.data.status}.`,
    scheduleUpdated: successResult.scheduleUpdated,
    persisted: successResult.persisted
  });
}
