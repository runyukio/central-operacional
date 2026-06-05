import { NextResponse } from "next/server";

import { enrollWorkSessionDevice } from "@/lib/work-session-service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const payload = await request.json().catch(() => ({}));
  const result = await enrollWorkSessionDevice(payload);
  if ("error" in result) return NextResponse.json(result, { status: result.status ?? 400 });
  return NextResponse.json(result);
}
