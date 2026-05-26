import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { HierarchyPage } from "@/components/modules";
import { authOptions } from "@/lib/auth-options";
import { canAccessHierarchy } from "@/lib/permissions";

export default async function HierarquiaRoute() {
  const session = await getServerSession(authOptions);
  if (!canAccessHierarchy({ role: session?.user?.role, status: "ACTIVE" })) {
    redirect("/central-operacional");
  }
  return <HierarchyPage />;
}
