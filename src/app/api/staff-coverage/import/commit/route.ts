import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { commitStaffCoverageImport } from "@/lib/staff-coverage-service";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const fileName = typeof body.fileName === "string" ? body.fileName : undefined;
  const actor = await getApiActor();
  const result = await commitStaffCoverageImport(actor, rows, fileName);
  if ("error" in result) return NextResponse.json(result, { status: result.status ?? 400 });
  return NextResponse.json(result);
}
