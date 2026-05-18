import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import { createShiftReport, deleteShiftReport, listShiftReports } from "@/lib/shift-report-service";

const absenceSchema = z.object({
  employeeId: z.string().min(1),
  employeeName: z.string().min(1),
  absenceReason: z.string().min(1),
  observation: z.string().optional(),
  impactsAbs: z.boolean().default(true),
  impactsCoverage: z.boolean().default(true)
});

const schema = z.object({
  reportDate: z.string().min(1),
  shift: z.string().min(1),
  lob: z.string().min(1),
  operation: z.string().min(1),
  supervisor: z.string().optional(),
  rta: z.string().min(1),
  importance: z.enum(["Baixa", "Média", "Alta", "Crítica"]),
  plannedHeadcount: z.number().int().nonnegative(),
  actualHeadcount: z.number().int().nonnegative(),
  onlineAgents: z.number().int().nonnegative(),
  absCount: z.number().int().nonnegative(),
  absJustification: z.string().optional().default(""),
  absentEmployees: z.array(absenceSchema).default([]),
  queueStatusStart: z.string().min(1),
  queueStatusEnd: z.string().min(1),
  backlogStart: z.number().int().nonnegative().default(0),
  backlogEnd: z.number().int().nonnegative().default(0),
  latencyStart: z.string().optional().default(""),
  latencyEnd: z.string().optional().default(""),
  occurrenceCategory: z.string().min(1),
  impactLevel: z.string().min(1),
  occurrences: z.string().optional().default(""),
  pendingTasks: z.string().optional().default(""),
  generalMood: z.string().min(1),
  leadersPresent: z.string().optional().default(""),
  mainRisks: z.string().optional().default(""),
  actionsTaken: z.string().optional().default(""),
  nextShiftAttentionPoints: z.string().optional().default(""),
  requiresFollowUp: z.boolean().default(false),
  followUpOwner: z.string().optional().default(""),
  followUpDueDate: z.string().optional(),
  followUpStatus: z.string().optional().default("Aberto"),
  additionalComments: z.string().optional().default("")
});

export async function GET(request: Request) {
  const actor = await getApiActor();
  const url = new URL(request.url);
  return NextResponse.json(await listShiftReports(actor, {
    startDate: url.searchParams.get("startDate") ?? undefined,
    endDate: url.searchParams.get("endDate") ?? undefined,
    shift: url.searchParams.get("shift") ?? undefined,
    supervisor: url.searchParams.get("supervisor") ?? undefined,
    rta: url.searchParams.get("rta") ?? undefined,
    importance: url.searchParams.get("importance") ?? undefined,
    mood: url.searchParams.get("mood") ?? undefined,
    search: url.searchParams.get("search") ?? undefined
  }));
}

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos", issues: parsed.error.flatten() }, { status: 400 });
  }

  const actor = await getApiActor();
  const result = createShiftReport(actor, parsed.data);
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
