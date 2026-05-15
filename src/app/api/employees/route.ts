import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import { listOperationalEmployees, updateOperationalEmployee } from "@/lib/employee-service";

const updateSchema = z.object({
  id: z.string().min(1),
  roleTitle: z.string().trim().optional(),
  operationalStatus: z.string().trim().optional(),
  roleName: z.string().trim().optional(),
  supervisorId: z.string().trim().optional()
});

export async function GET() {
  const actor = await getApiActor();
  return NextResponse.json({ data: await listOperationalEmployees(actor) });
}

export async function PATCH(request: Request) {
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos para atualizar colaborador.", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const actor = await getApiActor();
  const result = await updateOperationalEmployee(actor, parsed.data);
  if ("error" in result) return NextResponse.json(result, { status: 403 });

  return NextResponse.json(result);
}
