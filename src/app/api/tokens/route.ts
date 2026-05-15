import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { getTokenState } from "@/lib/mock-db";

export async function GET() {
  const actor = await getApiActor();
  return NextResponse.json({ data: getTokenState(actor) });
}
