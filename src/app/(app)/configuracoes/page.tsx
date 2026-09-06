import { SettingsPage } from "@/components/modules/settings-page";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/lib/auth-options";
import { normalizeRole } from "@/lib/permissions";

export default async function ConfiguracoesRoute() {
  const session = await getServerSession(authOptions);
  if (normalizeRole(session?.user?.role) !== "ADMIN") {
    redirect("/central-operacional");
  }
  return <SettingsPage />;
}
