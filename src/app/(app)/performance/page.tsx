import { getServerSession } from "next-auth";

import { PerformanceAutomationPage, PerformanceRestrictedPage } from "@/components/performance-automation-page";
import { authOptions } from "@/lib/auth-options";
import { canAccessPerformance } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function PerformanceRoute({
  searchParams
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const session = await getServerSession(authOptions);
  const params = await searchParams;

  if (!canAccessPerformance({ role: session?.user?.role, status: "ACTIVE" })) {
    return <PerformanceRestrictedPage />;
  }

  return <PerformanceAutomationPage initialTab={params.view === "wfh" ? "wfh" : "queue"} />;
}
