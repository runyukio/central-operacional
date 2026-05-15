import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import { getSystemSettings, updateSystemSettings } from "@/lib/settings-service";

const settingsSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("lob"),
    id: z.string().optional(),
    name: z.string().min(1),
    description: z.string().optional(),
    status: z.enum(["ACTIVE", "INACTIVE"]).optional()
  }),
  z.object({
    type: z.literal("shift"),
    id: z.string().optional(),
    name: z.string().min(1),
    startsAt: z.string().min(1),
    endsAt: z.string().min(1),
    color: z.string().optional(),
    status: z.enum(["ACTIVE", "INACTIVE"]).optional()
  }),
  z.object({
    type: z.literal("roleTitle"),
    name: z.string().min(1),
    previousName: z.string().optional(),
    status: z.enum(["ACTIVE", "INACTIVE"]).optional()
  }),
  z.object({
    type: z.literal("defaultMonth"),
    value: z.string().regex(/^\d{4}-\d{2}$/)
  })
]);

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
