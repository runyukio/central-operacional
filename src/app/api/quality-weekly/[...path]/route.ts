import { requireQualityWeeklyUser } from "@/lib/quality-weekly/scope";
import { qualityWeeklyHandler, qualityWeeklyFailure } from "@/lib/quality-weekly/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
async function handle(request: Request) {
  try { return await qualityWeeklyHandler(request, await requireQualityWeeklyUser()); }
  catch (error) { return qualityWeeklyFailure(error); }
}
export { handle as GET, handle as POST, handle as PUT };
