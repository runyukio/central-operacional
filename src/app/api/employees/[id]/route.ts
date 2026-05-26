import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import { errorResponse, errorStatus, mapZodError } from "@/lib/api-errors";
import { deleteOperationalEmployee, getOperationalEmployeeDetail } from "@/lib/employee-service";

const deleteSchema = z.object({
  reason: z.string().trim().min(1, "Motivo da exclusão é obrigatório."),
  confirmation: z.string().trim()
});

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const actor = await getApiActor();
  const result = await getOperationalEmployeeDetail(actor, params.id);
  if ("error" in result) return errorResponse(result, errorStatus(result));
  return NextResponse.json(result);
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const parsed = deleteSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return errorResponse(mapZodError(parsed.error));

  const actor = await getApiActor();
  const result = await deleteOperationalEmployee(actor, { id: params.id, ...parsed.data });
  if ("error" in result) return errorResponse(result, errorStatus(result));
  return NextResponse.json(result);
}
