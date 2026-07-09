import { getServerSession } from "next-auth";

import { PerformanceAutomationPage, PerformanceRestrictedPage } from "@/components/performance-automation-page";
import { authOptions } from "@/lib/auth-options";

export const dynamic = "force-dynamic";

const allowedPerformanceEmails = new Set(["runyukio@gmail.com"]);

export default async function PerformanceRoute() {
  const session = await getServerSession(authOptions);
  const email = String(session?.user?.email ?? "").trim().toLowerCase();
  if (!allowedPerformanceEmails.has(email)) return <PerformanceRestrictedPage />;
  return <PerformanceAutomationPage />;
}
