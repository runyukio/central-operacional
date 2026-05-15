import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import { getSystemSettings, updateSystemSettings } from "@/lib/settings-service";

const settingsSchema = z.object({ type: z.string().min(1) }).passthrough();

export async function GET() {
  const actor = await getApiActor();
  return NextResponse.json(await getSystemSettings(actor));
}

export async function POST(request: Request) {
  const parsed = settingsSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos para configurações.", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const actor = await getApiActor();
  const result = await updateSystemSettings(actor, parsed.data);
  if ("error" in result) return NextResponse.json(result, { status: 403 });

  return NextResponse.json(result);
}
