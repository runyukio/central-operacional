import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, errorStatus, mapZodError } from "@/lib/api-errors";
import { authOptions } from "@/lib/auth-options";
import { changeUserPassword } from "@/lib/password-service";
import { clientIpFromHeaders } from "@/lib/auth-rate-limit";

const schema = z.object({
  email: z.string().trim().max(254).optional(),
  currentPassword: z.string().max(4096).optional(),
  newPassword: z.string().max(128).optional(),
  confirmPassword: z.string().max(128).optional()
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return errorResponse(mapZodError(parsed.error));

  const session = await getServerSession(authOptions);
  const result = await changeUserPassword({
    ...parsed.data,
    actorEmail: session?.user?.email,
    ipAddress: clientIpFromHeaders(request.headers)
  });
  if ("rateLimited" in result && result.rateLimited) return NextResponse.json(result, {
    status: 429, headers: { "Retry-After": String(result.retryAfter), "Cache-Control": "no-store" }
  });
  if ("error" in result) return NextResponse.json(result, { status: errorStatus(result) });

  return NextResponse.json(result);
}
