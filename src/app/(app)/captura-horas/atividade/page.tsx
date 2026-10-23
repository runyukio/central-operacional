import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { WorkstationActivityPage } from "@/components/workstation-activity-page";
import { authOptions } from "@/lib/auth-options";
import { canAccessRealtimeHoursActivity } from "@/lib/realtime-hours-permissions";

export default async function WorkstationActivityRoute() {
  const session = await getServerSession(authOptions);
  const actor = {
    role: session?.user?.role,
    email: session?.user?.email,
    name: session?.user?.name,
    roleTitle: session?.user?.roleTitle,
    jobTitle: session?.user?.jobTitle,
    skill: session?.user?.skill,
    status: "ACTIVE"
  };

  if (!canAccessRealtimeHoursActivity(actor)) {
    redirect("/central-operacional");
  }

  return <WorkstationActivityPage />;
}
