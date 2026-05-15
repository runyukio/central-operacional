import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { getPlatformUsage } from "@/lib/mock-db";

export async function GET() {
  const actor = await getApiActor();
  const data = getPlatformUsage(actor);
  if ("error" in data) return NextResponse.json(data, { status: 403 });
  return NextResponse.json({ data });
}
