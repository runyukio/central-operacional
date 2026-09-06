import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { RegistrationApprovalsPage } from "@/components/modules/registration-approvals-page";
import { authOptions } from "@/lib/auth-options";
import { canApproveRegistration } from "@/lib/permissions";

export default async function CadastrosRoute() {
  const session = await getServerSession(authOptions);
  if (!canApproveRegistration({ role: session?.user?.role, status: "ACTIVE" })) {
    redirect("/central-operacional");
  }
  return <RegistrationApprovalsPage />;
}
