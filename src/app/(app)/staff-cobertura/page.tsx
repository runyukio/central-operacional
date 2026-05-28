import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { StaffCoveragePage } from "@/components/modules";
import { authOptions } from "@/lib/auth-options";
import { canAccessStaffCoverage } from "@/lib/permissions";

export default async function StaffCoberturaRoute() {
  const session = await getServerSession(authOptions);
  if (!canAccessStaffCoverage({ role: session?.user?.role, email: session?.user?.email, name: session?.user?.name, status: "ACTIVE" })) {
    redirect("/central-operacional");
  }
  return <StaffCoveragePage />;
}
