import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { commitEquipmentImport } from "@/lib/equipment-service";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const actor = await getApiActor();
  const result = await commitEquipmentImport(actor, rows);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 409 });
  return NextResponse.json(result);
}
