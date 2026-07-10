import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { RealtimeHoursWorkspacePage } from "@/components/realtime-hours-workspace-page";
import { authOptions } from "@/lib/auth-options";
import {
  canAccessRealtimeHoursCapture,
  canApproveRealtimeHoursCaptureAdjustment,
  canManageRealtimeHoursMappings,
  canRequestRealtimeHoursCaptureAdjustment
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

  return (
    <RealtimeHoursWorkspacePage
      canManageMappings={canManageRealtimeHoursMappings(session?.user?.email)}
      canRequestAdjustments={canRequestRealtimeHoursCaptureAdjustment(actor)}
      canApproveAdjustments={canApproveRealtimeHoursCaptureAdjustment(actor)}
    />
  );
}
