import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { PerformanceMyDataPage } from "@/components/performance-my-data-page";
import { authOptions } from "@/lib/auth-options";
import { getDefaultDateRange } from "@/lib/default-date-range";
import { getDefaultPathForRole } from "@/lib/navigation";
import { canAccessOwnPerformance } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function PerformanceMyDataRoute() {
  const session = await getServerSession(authOptions);
  const user = {
    role: session?.user?.role,
    email: session?.user?.email,
    name: session?.user?.name,
    roleTitle: session?.user?.roleTitle,
    jobTitle: session?.user?.jobTitle,
    status: "ACTIVE"
  };

  if (!canAccessOwnPerformance(user)) {
    redirect(getDefaultPathForRole(session?.user?.role));
  }

  return <PerformanceMyDataPage initialPeriod={getDefaultDateRange()} />;
}
