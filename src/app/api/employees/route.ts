import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import { errorResponse, errorStatus, mapZodError } from "@/lib/api-errors";
import { listOperationalEmployees, updateOperationalEmployee } from "@/lib/employee-service";

const updateSchema = z.object({
  id: z.string().min(1),
  fullName: z.string().trim().optional(),
  socialName: z.string().trim().optional(),
  email: z.string().trim().optional(),
  userStatus: z.string().trim().optional(),
  wbLogin: z.string().trim().optional(),
  roleTitle: z.string().trim().optional(),
  operationalStatus: z.string().trim().optional(),
  roleName: z.string().trim().optional(),
  supervisorId: z.string().trim().optional(),
  lobId: z.string().trim().optional(),
  teamId: z.string().trim().optional(),
  shiftId: z.string().trim().optional(),
  scheduleType: z.string().trim().optional(),
  contractType: z.string().trim().optional(),
  skill: z.string().trim().optional(),
  wave: z.string().trim().optional(),
  admissionDate: z.string().trim().optional(),
  trainingStartDate: z.string().trim().optional(),
  siteOperation: z.string().trim().optional(),
  internalNotes: z.string().trim().optional(),
  primaryPhone: z.string().trim().optional(),
  city: z.string().trim().optional(),
  stateUf: z.string().trim().optional(),
  preferredSchedule: z.string().trim().optional()
});

export async function GET(request: Request) {
  const actor = await getApiActor();
  const url = new URL(request.url);
  const page = Number(url.searchParams.get("page")) || 1;
  const limit = Number(url.searchParams.get("limit")) || 100;
  const result = await listOperationalEmployees(actor, {
    summary: url.searchParams.get("summary") !== "false",
    page,
    limit,
    search: url.searchParams.get("search") ?? undefined,
    lob: url.searchParams.get("lob") ?? undefined,
    lobId: url.searchParams.get("lobId") ?? undefined,
    supervisorId: url.searchParams.get("supervisorId") ?? undefined,
    teamId: url.searchParams.get("teamId") ?? undefined,
    shiftId: url.searchParams.get("shiftId") ?? undefined,
    skill: url.searchParams.get("skill") ?? undefined,
    wave: url.searchParams.get("wave") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    role: url.searchParams.get("role") ?? undefined
  });
  if (Array.isArray(result)) return NextResponse.json({ data: result, total: result.length, page, limit, totalPages: 1 });
  return NextResponse.json(result);
}

export async function PATCH(request: Request) {
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return errorResponse(mapZodError(parsed.error));
  }

  const actor = await getApiActor();
  const result = await updateOperationalEmployee(actor, parsed.data);
  if ("error" in result) return NextResponse.json(result, { status: errorStatus(result) });

  return NextResponse.json(result);
}
