import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { listErrorLogs } from "@/lib/mock-db";
import { canAccessAuditLogs } from "@/lib/permissions";

export async function GET() {
  const actor = await getApiActor();
  if (!canAccessAuditLogs(actor)) {
    return NextResponse.json({ error: "Acesso restrito a Admin/Gestão." }, { status: 403 });
  }

  return NextResponse.json({ data: listErrorLogs(actor) });
}
