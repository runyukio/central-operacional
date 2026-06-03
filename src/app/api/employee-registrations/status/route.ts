import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import { reviewOperationalRegistration } from "@/lib/employee-registration-service";

const operationalSchema = z.object({
	  wbLogin: z.string().min(1),
	  lob: z.string().min(1),
	  supervisor: z.string().optional().default(""),
	  shift: z.string().min(1),
	  skill: z.string().optional().default(""),
	  wave: z.string().optional().default(""),
	  roleTitle: z.string().min(1),
  employeeStatus: z.string().min(1),
  contractType: z.string().min(1),
  admissionDate: z.string().min(1),
  nestingStartDate: z.string().min(1),
  goLiveDate: z.string().min(1),
  internalNotes: z.string().optional()
});

const schema = z.object({
  id: z.string().min(1),
  action: z.enum(["approve", "reject", "request_adjustment"]),
  reviewNotes: z.string().min(1),
  operationalData: operationalSchema.optional()
});

export async function PATCH(request: Request) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    const fields = Object.fromEntries(
      parsed.error.issues.map((issue) => [issue.path.join(".") || "form", issue.message])
    );
    return NextResponse.json({
      error: `Revise os dados obrigatórios da aprovação: ${Object.keys(fields).join(", ")}.`,
      fields,
      issues: parsed.error.flatten()
    }, { status: 400 });
  }

  const actor = await getApiActor();
  const result = await reviewOperationalRegistration(actor, parsed.data);
  if ("error" in result) {
    const failure = result as { error: string; type?: string; fields?: Record<string, string> };
    return NextResponse.json({ error: failure.error, type: failure.type, fields: failure.fields }, { status: 409 });
  }

  return NextResponse.json(result);
}
