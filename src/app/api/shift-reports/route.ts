import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import { createShiftReport, deleteShiftReport, listShiftReports } from "@/lib/shift-report-service";

const timeBlockSchema = z.object({
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  category: z.string().min(1),
  description: z.string().optional().default("")
});

const schema = z.object({
  reportDate: z.string().min(1, "Data do report é obrigatória."),
  shift: z.string().min(1, "Turno é obrigatório."),
  lob: z.string().min(1, "LOB é obrigatória."),
  rta: z.string().min(1, "RTA responsável é obrigatório."),
  importance: z.enum(["Baixa", "Média", "Alta", "Crítica"]),
  plannedHeadcount: z.number().int().nonnegative("HC escalado deve ser um número válido."),
  actualHeadcount: z.number().int().nonnegative("HC real deve ser um número válido."),
  absCount: z.number().int().nonnegative("ABS total deve ser um número válido."),
  backlogStart: z.number().int().nonnegative("Backlog início deve ser um número válido.").default(0),
  backlogEnd: z.number().int().nonnegative("Backlog final deve ser um número válido.").default(0),
  latencyStart: z.string().min(1, "SLA latência início é obrigatório."),
  latencyEnd: z.string().min(1, "SLA latência final é obrigatório."),
  occurrences: z.string().optional().default(""),
  pendingTasks: z.string().optional().default(""),
  generalMood: z.string().min(1, "Humor geral é obrigatório."),
  mainRisks: z.string().optional().default(""),
  actionsTaken: z.string().optional().default(""),
  nextShiftAttentionPoints: z.string().optional().default(""),
  requiresFollowUp: z.boolean().default(false),
  followUpOwner: z.string().optional().default(""),
  followUpDueDate: z.string().optional(),
  additionalComments: z.string().optional().default(""),
  timeBlocks: z.array(timeBlockSchema).default([])
}).superRefine((data, ctx) => {
  if (!data.requiresFollowUp) return;
  if (!data.followUpOwner?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["followUpOwner"], message: "Responsável follow-up é obrigatório quando há follow-up." });
  }
  if (!data.followUpDueDate?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["followUpDueDate"], message: "Prazo follow-up é obrigatório quando há follow-up." });
  }
});

export async function GET(request: Request) {
  const actor = await getApiActor();
  const url = new URL(request.url);
  return NextResponse.json(await listShiftReports(actor, {
    startDate: url.searchParams.get("startDate") ?? undefined,
    endDate: url.searchParams.get("endDate") ?? undefined,
    shift: url.searchParams.get("shift") ?? undefined,
    lob: url.searchParams.get("lob") ?? undefined,
    rta: url.searchParams.get("rta") ?? undefined,
    importance: url.searchParams.get("importance") ?? undefined,
    mood: url.searchParams.get("mood") ?? undefined,
    followUp: url.searchParams.get("followUp") ?? undefined,
    search: url.searchParams.get("search") ?? undefined
  }));
}

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos", issues: parsed.error.flatten() }, { status: 400 });
  }

  const actor = await getApiActor();
  const result = await createShiftReport(actor, parsed.data);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 403 });
  }

  return NextResponse.json(result, { status: 201 });
}

export async function DELETE(request: Request) {
  const actor = await getApiActor();
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Informe o report de turno." }, { status: 400 });
  const result = await deleteShiftReport(actor, id);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 403 });
  return NextResponse.json(result);
}
