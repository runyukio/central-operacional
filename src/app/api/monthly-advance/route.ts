import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import {
  getMyMonthlyAdvanceCycles,
  listMonthlyAdvances,
  parseAdvanceOptIn,
  removeMonthlyAdvance,
  respondMonthlyAdvance,
  upsertMonthlyAdvance
} from "@/lib/monthly-advance-service";

const respondSchema = z.object({
  referenceMonth: z.string().min(1),
  optIn: z.boolean()
});

const upsertSchema = z.object({
  employeeId: z.string().optional(),
  wbLogin: z.string().optional(),
  referenceMonth: z.string().min(1),
  optIn: z.boolean(),
  observation: z.string().optional()
});

const deleteSchema = z.object({
  id: z.string().min(1)
});

export async function GET(request: Request) {
  const actor = await getApiActor();
  const url = new URL(request.url);
  if (url.searchParams.get("scope") === "mine") {
    const result = await getMyMonthlyAdvanceCycles(actor);
    if ("error" in result) return NextResponse.json({ error: result.error, message: result.error }, { status: result.status ?? 400 });
    return NextResponse.json(result);
  }

  const result = await listMonthlyAdvances(actor, {
    referenceMonth: url.searchParams.get("referenceMonth") ?? undefined,
    lob: url.searchParams.get("lob") ?? undefined,
    supervisorId: url.searchParams.get("supervisorId") ?? undefined,
    optIn: url.searchParams.get("optIn") ?? undefined,
    search: url.searchParams.get("search") ?? undefined,
    page: url.searchParams.get("page") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined
  });
  if ("error" in result) return NextResponse.json({ error: result.error, message: result.error }, { status: result.status ?? 400 });
  return NextResponse.json(result);
}

export async function DELETE(request: Request) {
  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Registro de adiantamento inválido.", message: "Registro de adiantamento inválido." }, { status: 400 });
  }
  const actor = await getApiActor();
  const result = await removeMonthlyAdvance(actor, parsed.data.id);
  if ("error" in result) return NextResponse.json({ error: result.error, message: result.error }, { status: result.status ?? 400 });
  return NextResponse.json(result);
}

export async function POST(request: Request) {
  const parsed = respondSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos para responder adiantamento mensal.", message: "Dados inválidos para responder adiantamento mensal." }, { status: 400 });
  }
  const actor = await getApiActor();
  const result = await respondMonthlyAdvance(actor, parsed.data);
  if ("error" in result) return NextResponse.json({ error: result.error, message: result.error }, { status: result.status ?? 400 });
  return NextResponse.json(result, { status: 201 });
}

export async function PATCH(request: Request) {
  const parsed = upsertSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos para atualizar adiantamento mensal.", message: "Dados inválidos para atualizar adiantamento mensal." }, { status: 400 });
  }
  const optIn = parseAdvanceOptIn(parsed.data.optIn);
  const actor = await getApiActor();
  const result = await upsertMonthlyAdvance(actor, {
    ...parsed.data,
    optIn: Boolean(optIn)
  });
  if ("error" in result) return NextResponse.json({ error: result.error, message: result.error }, { status: result.status ?? 400 });
  return NextResponse.json(result);
}
