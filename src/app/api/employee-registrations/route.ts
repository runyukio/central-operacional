import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { deleteOperationalRegistration, listOperationalRegistrations, submitOperationalRegistration } from "@/lib/employee-registration-service";
import { parseRegistrationPayload } from "@/lib/registration-validation";

export async function GET() {
  const actor = await getApiActor();
  return NextResponse.json({ data: await listOperationalRegistrations(actor) });
}

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

export async function DELETE(request: Request) {
  const body = await request.json().catch(() => ({}));
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "Informe o cadastro que será excluído." }, { status: 400 });

  const actor = await getApiActor();
  const result = await deleteOperationalRegistration(actor, id);
  if ("error" in result) return NextResponse.json(result, { status: 403 });

  return NextResponse.json(result);
}
