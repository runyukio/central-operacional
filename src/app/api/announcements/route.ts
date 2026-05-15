import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { listAnnouncements } from "@/lib/mock-db";

export async function GET() {
  const actor = await getApiActor();
  return NextResponse.json({ data: listAnnouncements(actor) });
}
