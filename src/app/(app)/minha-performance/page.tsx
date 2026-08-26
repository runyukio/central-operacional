import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { MyPerformancePage } from "@/components/my-performance-page";
import { authOptions } from "@/lib/auth-options";
import { canAccessOwnPerformance } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function MinhaPerformanceRoute({
  searchParams
}: {
  searchParams: Promise<{ startDate?: string; endDate?: string }>;
}) {
  const [session, params] = await Promise.all([getServerSession(authOptions), searchParams]);
  if (!canAccessOwnPerformance({
    role: session?.user?.role,
    email: session?.user?.email,
    name: session?.user?.name,
    roleTitle: session?.user?.roleTitle,
    jobTitle: session?.user?.jobTitle,
    skill: session?.user?.skill,
    status: "ACTIVE"
  })) {
    redirect("/meu-perfil");
  }

  return <MyPerformancePage initialStartDate={validDate(params.startDate)} initialEndDate={validDate(params.endDate)} />;
}

function validDate(value?: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value ?? "") ? value : undefined;
}
