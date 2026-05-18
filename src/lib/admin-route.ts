import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/lib/auth-options";
import { normalizeRole } from "@/lib/permissions";

export async function requireAdminRoute() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  if (normalizeRole(session.user.role) !== "ADMIN") redirect("/central-operacional");
}
