import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { SessionProvider } from "@/components/session-provider";
import { authOptions } from "@/lib/auth-options";
import { canAccessBilling } from "@/lib/billing-permissions";
import { canAccessFinanceiro } from "@/lib/financeiro-permissions";

export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <SessionProvider session={session}>
      <AppShell user={session.user} billingAccess={canAccessBilling({ ...session.user, role: session.user.role })} financeiroAccess={canAccessFinanceiro(session.user)}>{children}</AppShell>
    </SessionProvider>
  );
}
