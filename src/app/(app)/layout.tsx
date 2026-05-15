import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { SessionProvider } from "@/components/session-provider";
import { authOptions } from "@/lib/auth-options";

export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <SessionProvider session={session}>
      <AppShell user={session.user}>{children}</AppShell>
    </SessionProvider>
  );
}
