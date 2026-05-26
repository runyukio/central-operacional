import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import { deleteEquipment, listEquipment, saveEquipment } from "@/lib/equipment-service";

const schema = z.object({
  id: z.string().optional(),
  numeroSerie: z.string().optional(),
  code: z.string().optional(),
  serial: z.string().optional(),
  responsibleEmployeeId: z.string().optional(),
  responsavelWbLogin: z.string().optional(),
  responsavelEmail: z.string().optional(),
  responsavelNome: z.string().optional(),
  deliveredAt: z.string().optional(),
  dataEntrega: z.string().optional(),
  type: z.string().optional(),
  tipoEquipamento: z.string().optional(),
  model: z.string().optional(),
  modelo: z.string().optional(),
  status: z.string().optional(),
  observation: z.string().optional(),
  observacao: z.string().optional()
});

export async function GET(request: Request) {
  const actor = await getApiActor();
  const url = new URL(request.url);
  return NextResponse.json(await listEquipment(actor, {
    status: url.searchParams.get("status") ?? undefined,
    type: url.searchParams.get("type") ?? undefined,
    search: url.searchParams.get("search") ?? undefined,
    serialNumber: url.searchParams.get("serialNumber") ?? undefined,
    responsible: url.searchParams.get("responsible") ?? undefined,
    responsibleId: url.searchParams.get("responsibleId") ?? undefined,
    wbLogin: url.searchParams.get("wbLogin") ?? undefined,
    model: url.searchParams.get("model") ?? undefined,
    deliveredFrom: url.searchParams.get("deliveredFrom") ?? url.searchParams.get("deliveryDateFrom") ?? undefined,
    deliveredTo: url.searchParams.get("deliveredTo") ?? url.searchParams.get("deliveryDateTo") ?? undefined,
    page: Number(url.searchParams.get("page")) || undefined,
    limit: Number(url.searchParams.get("limit")) || undefined
  }));
}

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos", issues: parsed.error.flatten() }, { status: 400 });
  }
  const actor = await getApiActor();
  const result = await saveEquipment(actor, parsed.data);

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }

  return NextResponse.json(result, { status: 201 });
}

export async function PATCH(request: Request) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos", issues: parsed.error.flatten() }, { status: 400 });
  }
  const actor = await getApiActor();
  const result = await saveEquipment(actor, parsed.data);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 409 });
  return NextResponse.json(result);
}

export async function DELETE(request: Request) {
  const actor = await getApiActor();
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Informe o equipamento." }, { status: 400 });
  const result = await deleteEquipment(actor, id);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 409 });
  return NextResponse.json(result);
}
