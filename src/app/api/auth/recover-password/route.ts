import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, errorStatus, mapZodError } from "@/lib/api-errors";
import { recoverPasswordWithSecurityQuestion } from "@/lib/password-recovery-service";
import { clientIpFromHeaders } from "@/lib/auth-rate-limit";

const schema = z.object({
  email: z.string().trim().email().max(254),
  wbLogin: z.string().trim().min(1).max(100),
  question: z.string().trim().min(1).max(100),
  answer: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128),
  confirmPassword: z.string().min(1).max(128)
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return errorResponse(mapZodError(parsed.error));
  const result = await recoverPasswordWithSecurityQuestion(parsed.data, {
    ipAddress: clientIpFromHeaders(request.headers),
    userAgent: request.headers.get("user-agent")
  });
  if ("error" in result) {
    if ("rateLimited" in result && result.rateLimited) {
      return NextResponse.json(result, { status: 429, headers: {
        "Cache-Control": "no-store", "Retry-After": String(result.retryAfter)
      } });
    }
    return NextResponse.json(result, { status: errorStatus(result), headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
