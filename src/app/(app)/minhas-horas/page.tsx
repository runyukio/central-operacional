import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { MyRealtimeHoursPage } from "@/components/my-realtime-hours-page";
import { authOptions } from "@/lib/auth-options";
import { canAccessOwnRealtimeHours } from "@/lib/realtime-hours-permissions";

export default async function MinhasHorasRoute() {
  const session = await getServerSession(authOptions);
  if (!canAccessOwnRealtimeHours({
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

  return <MyRealtimeHoursPage />;
}
