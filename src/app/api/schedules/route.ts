import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import { createPermissionError, errorResponse } from "@/lib/api-errors";
import { canUpdateScheduleSlot } from "@/lib/permissions";
import { auditPermissionDenied } from "@/lib/permission-audit";
import { editOperationalSchedule, getOperationalSchedules, removeOperationalSchedules } from "@/lib/schedule-service";

const editSchema = z.object({
  employeeId: z.string().min(1),
  date: z.string().min(1),
  shift: z.string().min(1),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
  status: z.string().min(1),
  absenceReason: z.string().optional(),
  reasonCategory: z.string().optional(),
  supervisorJustification: z.string().optional(),
  lob: z.string().optional(),
  supervisor: z.string().optional(),
  observation: z.string().optional(),
  pendingJustification: z.boolean().optional(),
  hasEvidence: z.boolean().optional(),
  evidenceUrl: z.string().optional(),
  impactsAbs: z.boolean().optional(),
  impactsCoverage: z.boolean().optional()
});

export async function GET(request: Request) {
  const actor = await getApiActor();
  const url = new URL(request.url);
  return NextResponse.json({
    data: await getOperationalSchedules(actor, {
      startDate: url.searchParams.get("startDate") ?? undefined,
      endDate: url.searchParams.get("endDate") ?? undefined,
      month: Number(url.searchParams.get("month")) || undefined,
      year: Number(url.searchParams.get("year")) || undefined,
      view: url.searchParams.get("view") === "mine" ? "mine" : undefined,
      employeeId: url.searchParams.get("employeeId") ?? undefined,
      collaborator: url.searchParams.get("collaborator") ?? undefined,
      lob: url.searchParams.get("lob") ?? undefined,
      supervisor: url.searchParams.get("supervisor") ?? undefined,
      shift: url.searchParams.get("shift") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      roleTitle: url.searchParams.get("roleTitle") ?? undefined,
      skill: url.searchParams.get("skill") ?? undefined,
      page: Number(url.searchParams.get("page")) || undefined,
      limit: Number(url.searchParams.get("limit")) || undefined,
      skipSummary: url.searchParams.get("skipSummary") ?? undefined,
      includeImports: url.searchParams.get("includeImports") ?? undefined
    }),
    actor: { role: actor.role, name: actor.name }
  });
}

export async function PATCH(request: Request) {
  const parsed = editSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos", issues: parsed.error.flatten() }, { status: 400 });
  }

  const actor = await getApiActor();
  if (!canUpdateScheduleSlot({ role: actor.role, status: "ACTIVE" })) {
    const reason = actor.role === "SUPERVISOR" ? "Supervisor pode justificar ou solicitar ajuste, mas não pode alterar o Cronograma diretamente." : "Sem permissão para editar cronograma.";
    await auditPermissionDenied(actor, { action: "SCHEDULE_UPDATE", entity: "Schedule", reason, entityId: parsed.data.employeeId });
    return errorResponse(createPermissionError(reason));
  }
  const result = await editOperationalSchedule(actor, parsed.data);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }

  return NextResponse.json(result);
}

const removeSchema = z.object({
  employeeId: z.string().min(1),
  month: z.number().optional(),
  year: z.number().optional(),
  scope: z.enum(["month", "all"]).optional()
});

export async function DELETE(request: Request) {
  const parsed = removeSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos para remover cronograma.", issues: parsed.error.flatten() }, { status: 400 });
  }

  const actor = await getApiActor();
  if (!canUpdateScheduleSlot({ role: actor.role, status: "ACTIVE" })) {
    const reason = actor.role === "SUPERVISOR" ? "Supervisor pode justificar ou solicitar ajuste, mas não pode alterar o Cronograma diretamente." : "Sem permissão para remover cronogramas.";
    await auditPermissionDenied(actor, { action: "SCHEDULE_DELETE", entity: "Schedule", reason, entityId: parsed.data.employeeId });
    return errorResponse(createPermissionError(reason));
  }
  const result = await removeOperationalSchedules(actor, parsed.data);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 409 });

  return NextResponse.json(result);
}
