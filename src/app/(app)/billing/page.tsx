import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { BillingPage } from "@/components/billing-page";
import { authOptions } from "@/lib/auth-options";
import { canAccessBilling } from "@/lib/billing-permissions";
import { getDefaultPathForRole } from "@/lib/navigation";

export default async function BillingRoute() {
  const session = await getServerSession(authOptions);
  if (!session?.user || !canAccessBilling(session.user)) {
    redirect(getDefaultPathForRole(session?.user?.role));
  }

  return <BillingPage />;
}
