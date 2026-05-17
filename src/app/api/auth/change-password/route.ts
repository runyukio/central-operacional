import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, errorStatus, mapZodError } from "@/lib/api-errors";
import { authOptions } from "@/lib/auth-options";
import { changeUserPassword } from "@/lib/password-service";

const schema = z.object({
  email: z.string().trim().optional(),
  currentPassword: z.string().optional(),
  newPassword: z.string().optional(),
  confirmPassword: z.string().optional()
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return errorResponse(mapZodError(parsed.error));

  const session = await getServerSession(authOptions);
  const result = await changeUserPassword({
    ...parsed.data,
    actorEmail: session?.user?.email
  });
  if ("error" in result) return NextResponse.json(result, { status: errorStatus(result) });

  return NextResponse.json(result);
}
