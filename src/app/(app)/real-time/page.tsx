import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { RealTimePage } from "@/components/realtime-page";
import { authOptions } from "@/lib/auth-options";
import { canAccessRealTimeQueues } from "@/lib/permissions";

export default async function RealTimeRoute() {
  const session = await getServerSession(authOptions);
  if (!canAccessRealTimeQueues({
    role: session?.user?.role,
    email: session?.user?.email,
    name: session?.user?.name,
    roleTitle: session?.user?.roleTitle,
    jobTitle: session?.user?.jobTitle,
    skill: session?.user?.skill,
    status: "ACTIVE"
  })) {
    redirect("/central-operacional");
  }
  return <RealTimePage userRole={session?.user?.role ?? ""} />;
}
