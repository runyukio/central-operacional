import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import { errorResponse, errorStatus, mapZodError } from "@/lib/api-errors";
import { getOwnSecurityQuestion, saveOwnSecurityQuestion } from "@/lib/password-recovery-service";

const schema = z.object({
  question: z.string().trim().min(1).max(100),
  answer: z.string().min(1).max(128),
  currentPassword: z.string().min(1).max(128)
});

export async function GET() {
  const result = await getOwnSecurityQuestion(await getApiActor());
  if ("error" in result) return errorResponse(result, errorStatus(result));
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return errorResponse(mapZodError(parsed.error));
  const result = await saveOwnSecurityQuestion(await getApiActor(), parsed.data);
  if ("error" in result) return errorResponse(result, errorStatus(result));
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
