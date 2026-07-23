import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { RealtimeHoursPage } from "@/components/realtime-hours-page";
import { authOptions } from "@/lib/auth-options";
import {
  canAccessRealtimeHoursCapture,
  canManageRealtimeHoursMappings
} from "@/lib/realtime-hours-permissions";

export default async function CapturaHorasRoute() {
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

  if (!canAccessRealtimeHoursCapture(actor)) {
    redirect("/central-operacional");
  }

  return <RealtimeHoursPage canManageMappings={canManageRealtimeHoursMappings(actor)} />;
}
