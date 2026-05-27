import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import { getOperationalAttendance, updateOperationalAttendance } from "@/lib/schedule-service";

const schema = z.object({
  attendanceRecordId: z.string().optional(),
  scheduleId: z.string().optional(),
  employeeId: z.string().min(1),
  date: z.string().min(1),
  shift: z.string().min(1),
  status: z.string().min(1),
  absenceReason: z.string().optional(),
  reasonCategory: z.string().optional(),
  supervisorJustification: z.string().optional(),
  hasEvidence: z.boolean().optional(),
  evidenceUrl: z.string().optional(),
  impactsAbs: z.boolean().optional(),
  impactsCoverage: z.boolean().optional()
});

export async function GET(request: Request) {
  const actor = await getApiActor();
  const url = new URL(request.url);
  return NextResponse.json(await getOperationalAttendance(actor, {
    date: url.searchParams.get("date") ?? undefined,
    startDate: url.searchParams.get("startDate") ?? undefined,
    endDate: url.searchParams.get("endDate") ?? undefined,
    month: url.searchParams.get("month") ? Number(url.searchParams.get("month")) : undefined,
    year: url.searchParams.get("year") ? Number(url.searchParams.get("year")) : undefined,
    lob: url.searchParams.get("lob") ?? undefined,
    supervisor: url.searchParams.get("supervisor") ?? undefined,
    shift: url.searchParams.get("shift") ?? undefined,
    collaborator: url.searchParams.get("collaborator") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    roleTitle: url.searchParams.get("roleTitle") ?? undefined,
    skill: url.searchParams.get("skill") ?? undefined,
    reason: url.searchParams.get("reason") ?? undefined,
    justification: url.searchParams.get("justification") ?? undefined,
    includeJustified: url.searchParams.get("includeJustified") ?? undefined,
    summaryOnly: url.searchParams.get("summaryOnly") ?? undefined,
    skipSummary: url.searchParams.get("skipSummary") ?? undefined,
    detailType: url.searchParams.get("detailType") ?? undefined,
    employeeId: url.searchParams.get("employeeId") ?? undefined
  }));
}

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos", issues: parsed.error.flatten() }, { status: 400 });
  }

  const actor = await getApiActor();
  const result = await updateOperationalAttendance(actor, parsed.data);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }

  return NextResponse.json(result);
}
