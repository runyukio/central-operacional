import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { WorkSessionMonitoringPage } from "@/components/modules";
import { authOptions } from "@/lib/auth-options";
import { canAccessWorkSessionMonitoring } from "@/lib/permissions";

export default async function MonitoramentoJornadaRoute() {
  const session = await getServerSession(authOptions);
  if (!canAccessWorkSessionMonitoring({ role: session?.user?.role, email: session?.user?.email, name: session?.user?.name, status: "ACTIVE" })) {
    redirect("/central-operacional");
  }
  return <WorkSessionMonitoringPage />;
}
