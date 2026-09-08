import { redirect } from "next/navigation";
import { QualityWeeklyPage } from "@/components/quality-weekly/page";
import { requireQualityWeeklyUser } from "@/lib/quality-weekly/scope";
import { QualityWeeklyError } from "@/lib/quality-weekly/access";

export const dynamic = "force-dynamic";
export default async function Page() {
  try { await requireQualityWeeklyUser(); }
  catch (error) {
    if (error instanceof QualityWeeklyError && error.status === 401) redirect("/login?callbackUrl=%2Fweekly-quality-report");
    if (error instanceof QualityWeeklyError && error.status === 403) return <QualityWeeklyPage accessError={error.message} />;
    throw error;
  }
  return <QualityWeeklyPage />;
}
