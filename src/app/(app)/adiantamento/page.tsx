import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { AdvanceManagementPage } from "@/components/modules/advance-management-page";
import { authOptions } from "@/lib/auth-options";
import { canAccessAdvanceModule } from "@/lib/permissions";

export default async function AdiantamentoRoute() {
  const session = await getServerSession(authOptions);
  if (!canAccessAdvanceModule({ role: session?.user?.role, status: "ACTIVE" })) {
    redirect("/central-operacional");
  }
  return <AdvanceManagementPage />;
}
