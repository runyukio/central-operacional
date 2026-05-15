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
  admissionDate: z.string().trim().optional(),
  trainingStartDate: z.string().trim().optional(),
  siteOperation: z.string().trim().optional(),
  internalNotes: z.string().trim().optional(),
  primaryPhone: z.string().trim().optional(),
  city: z.string().trim().optional(),
  stateUf: z.string().trim().optional(),
  preferredSchedule: z.string().trim().optional()
});

export async function GET() {
  const actor = await getApiActor();
  return NextResponse.json({ data: await listOperationalEmployees(actor) });
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
