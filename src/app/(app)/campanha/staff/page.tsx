import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { CampaignRafflePage } from "@/components/campaign-raffle-page";
import { authOptions } from "@/lib/auth-options";
import { canAccessCampaignAgent, canManageCampaignStaff } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function CampaignStaffRoute() {
  const session = await getServerSession(authOptions);
  const user = { ...session?.user, status: "ACTIVE" };
  if (!canManageCampaignStaff(user)) {
    redirect(canAccessCampaignAgent(user) ? "/campanha/agente" : "/meu-perfil");
  }
  return <CampaignRafflePage view="staff" />;
}
