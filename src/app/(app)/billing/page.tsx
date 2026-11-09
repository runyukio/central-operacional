import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { getDefaultBillingReferenceMonth } from "@/lib/billing-reference-month-service";

import { BillingPage } from "@/components/billing-page";
import { authOptions } from "@/lib/auth-options";
import { canAccessBilling } from "@/lib/billing-permissions";
import { getDefaultPathForRole } from "@/lib/navigation";

export const dynamic = "force-dynamic";

export default async function BillingRoute() {
  const session = await getServerSession(authOptions);
  if (!session?.user || !canAccessBilling({ ...session.user, role: session.user.role })) {
    redirect(getDefaultPathForRole(session?.user?.role));
  }

  return <BillingPage defaultReferenceMonth={await getDefaultBillingReferenceMonth()} />;
}
