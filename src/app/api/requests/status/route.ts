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
    finalApprovedEndTime: z.string().optional()
  }).optional()
});

export async function PATCH(request: Request) {
  const body = await request.json();
  const parsed = updateStatusSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos", issues: parsed.error.flatten() }, { status: 400 });
  }

  const actor = await getApiActor();
  const result = await updateOperationalRequestStatus(actor, parsed.data.id, parsed.data.status, parsed.data.reason, parsed.data.actionInput);

  if (!result) {
    return NextResponse.json({ error: "Solicitação não encontrada" }, { status: 404 });
  }

  if (result === "FORBIDDEN") {
    return NextResponse.json({ error: "Sem permissão para alterar esta solicitação" }, { status: 403 });
  }

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    data: result.data,
    request: result.data,
    message: `Solicitação ${result.data.id} atualizada para ${result.data.status}.`,
    scheduleUpdated: result.scheduleUpdated,
    persisted: result.persisted
  });
}
