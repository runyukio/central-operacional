import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { CampaignRafflePage } from "@/components/campaign-raffle-page";
import { authOptions } from "@/lib/auth-options";
import { canAccessCampaignAgent, canManageCampaignStaff } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function CampaignAgentRoute() {
  const session = await getServerSession(authOptions);
  const user = { ...session?.user, status: "ACTIVE" };
  if (!canAccessCampaignAgent(user)) {
    redirect(canManageCampaignStaff(user) ? "/campanha/staff" : "/meu-perfil");
  }
  return <CampaignRafflePage view="agent" />;
}
