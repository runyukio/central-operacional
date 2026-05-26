import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { ClimatePage } from "@/components/modules";
import { authOptions } from "@/lib/auth-options";
import { normalizeRole } from "@/lib/permissions";

export default async function ClimaRoute() {
  const session = await getServerSession(authOptions);
  const role = normalizeRole(session?.user?.role);
  if (!["ADMIN", "COLABORADOR"].includes(role)) {
    redirect("/central-operacional");
  }
  return <ClimatePage />;
}
