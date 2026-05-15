import { NextResponse } from "next/server";

import { submitOperationalRegistration } from "@/lib/employee-registration-service";
import { parseRegistrationPayload } from "@/lib/registration-validation";

export async function POST(request: Request) {
  const parsed = await parseRegistrationPayload(request);
  if (!parsed.success) {
    return NextResponse.json(parsed, { status: 400 });
  }

  const result = await submitOperationalRegistration(parsed.data);
  if ("error" in result) {
    const type = "type" in result ? result.type : undefined;
    const status = type === "DUPLICATE_ERROR" ? 409 : type === "DB_CONNECTION_ERROR" || type === "DB_ENV_ERROR" ? 503 : 400;
    return NextResponse.json({ success: false, ...result }, { status });
  }

  return NextResponse.json(result, { status: 201 });
}
