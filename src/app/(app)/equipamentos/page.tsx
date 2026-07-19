import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { EquipmentPage } from "@/components/modules";
import { authOptions } from "@/lib/auth-options";
import { canAccessEquipment } from "@/lib/permissions";

export default async function EquipamentosRoute() {
  const session = await getServerSession(authOptions);
  if (!canAccessEquipment({ role: session?.user?.role })) {
    redirect("/central-operacional");
  }
  return <EquipmentPage />;
}
