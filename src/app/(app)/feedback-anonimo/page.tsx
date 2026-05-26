import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { AnonymousFeedbackPage } from "@/components/modules";
import { authOptions } from "@/lib/auth-options";
import { normalizeRole } from "@/lib/permissions";

export default async function FeedbackAnonimoRoute() {
  const session = await getServerSession(authOptions);
  const role = normalizeRole(session?.user?.role);
  if (!["ADMIN", "COLABORADOR"].includes(role)) {
    redirect("/central-operacional");
  }
  return <AnonymousFeedbackPage />;
}
