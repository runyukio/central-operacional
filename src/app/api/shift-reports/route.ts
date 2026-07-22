import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import {
  createShiftReportWorkspace,
  deleteShiftReportWorkspace,
  listShiftReportWorkspace
} from "@/lib/shift-report-workspace-service";

const absenceSchema = z.object({
  wbLogin: z.string().trim().min(1, "Informe o WB/Login."),
  reason: z.string().trim().min(1, "Informe o motivo da falta.").max(500)
});

const schema = z.object({
  reportDate: z.string().min(1, "Data do turno é obrigatória."),
  shiftId: z.string().min(1, "Turno é obrigatório."),
  lobId: z.string().min(1, "LOB é obrigatória."),
  responsibleId: z.string().min(1, "Responsável é obrigatório."),
  importance: z.enum(["REPORT", "ATTENTION", "CRITICAL"]),
  onlineAgents: z.number().int().nonnegative("Agentes online deve ser um número válido."),
  absences: z.array(absenceSchema).max(100).default([]),
  queueStatusStart: z.enum(["ON_TARGET", "OVER_TARGET"]),
  queueStatusEnd: z.enum(["ON_TARGET", "OVER_TARGET"]),
  occurrence: z.string().trim().max(5000).optional().default(""),
  pendingTasks: z.string().trim().max(5000).optional().default(""),
  generalMood: z.enum(["HAPPY", "NEUTRAL", "SAD"]),
  leaderIds: z.array(z.string()).max(100).default([])
});

function queryFrom(request: Request) {
  const url = new URL(request.url);
  return {
    startDate: url.searchParams.get("startDate") ?? undefined,
    endDate: url.searchParams.get("endDate") ?? undefined,
    shift: url.searchParams.get("shift") ?? undefined,
    lob: url.searchParams.get("lob") ?? undefined,
    responsible: url.searchParams.get("responsible") ?? undefined,
    importance: url.searchParams.get("importance") ?? undefined,
    mood: url.searchParams.get("mood") ?? undefined,
    search: url.searchParams.get("search") ?? undefined
  };
}

export async function GET(request: Request) {
  const actor = await getApiActor();
  const result = await listShiftReportWorkspace(actor, queryFrom(request));
  return NextResponse.json(result, { status: "error" in result ? 403 : 200 });
}

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Revise os campos do report.", issues: parsed.error.flatten() }, { status: 400 });
  }

  const actor = await getApiActor();
  const result = await createShiftReportWorkspace(actor, parsed.data);
  return NextResponse.json(result, { status: "error" in result ? 403 : 201 });
}

export async function DELETE(request: Request) {
  const actor = await getApiActor();
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Informe o report de turno." }, { status: 400 });
  const result = await deleteShiftReportWorkspace(actor, id);
  return NextResponse.json(result, { status: "error" in result ? 403 : 200 });
}
