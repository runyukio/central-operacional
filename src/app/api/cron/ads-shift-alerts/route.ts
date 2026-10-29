import { operationalCronResponse } from "@/lib/ads-operational-alerts-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  return operationalCronResponse(request, "shift");
}
