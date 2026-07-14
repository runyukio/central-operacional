import { getServerSession } from "next-auth";

import { PerformanceAutomationPage, PerformanceRestrictedPage } from "@/components/performance-automation-page";
import { authOptions } from "@/lib/auth-options";
import { canAccessPerformance } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function PerformanceRoute() {
  const session = await getServerSession(authOptions);
  if (!canAccessPerformance({
    role: session?.user?.role,
    email: session?.user?.email,
    name: session?.user?.name,
    roleTitle: session?.user?.roleTitle,
    jobTitle: session?.user?.jobTitle,
    skill: session?.user?.skill,
    status: "ACTIVE"
  })) return <PerformanceRestrictedPage />;
  return <PerformanceAutomationPage />;
}
