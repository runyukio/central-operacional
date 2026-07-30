import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { applyDueFixedShiftChanges } from "@/lib/shift-change-effective-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function isAuthorized(authorization: string | null) {
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  const provided = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  if (!secret || !provided) return false;
  const expected = Buffer.from(secret);
  const received = Buffer.from(provided);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET?.trim()) {
    return NextResponse.json({ success: false, error: "CRON_SECRET não configurado." }, { status: 500 });
  }
  if (!isAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ success: false, error: "Token da rotina de troca de turno inválido." }, { status: 401 });
  }

  try {
    const result = await applyDueFixedShiftChanges();
    return NextResponse.json(result, { status: result.success ? 200 : 207 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível aplicar as trocas de turno em vigência.";
    console.error("[cron/shift-changes-effective]", error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
