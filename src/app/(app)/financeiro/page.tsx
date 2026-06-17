import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { FinanceiroPage } from "@/components/financeiro-page";
import { authOptions } from "@/lib/auth-options";
import { canAccessFinanceiro } from "@/lib/financeiro-permissions";
import { getDefaultPathForRole } from "@/lib/navigation";

export default async function Page() {
  const session = await getServerSession(authOptions);
  if (!session?.user || !canAccessFinanceiro(session.user)) {
    redirect(getDefaultPathForRole(session?.user?.role));
  }
  return <FinanceiroPage />;
}
