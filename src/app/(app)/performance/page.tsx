import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/lib/auth-options";
import { getDefaultPathForRole } from "@/lib/navigation";

export const dynamic = "force-dynamic";

export default async function PerformanceRoute() {
  const session = await getServerSession(authOptions);
  redirect(getDefaultPathForRole(session?.user?.role));
}
