import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/lib/auth-options";
import { canAccessCampaignAgent, canManageCampaignStaff } from "@/lib/permissions";

export default async function CampaignRoute() {
  const session = await getServerSession(authOptions);
  const user = { ...session?.user, status: "ACTIVE" };
  if (canManageCampaignStaff(user)) redirect("/campanha/staff");
  if (canAccessCampaignAgent(user)) redirect("/campanha/agente");
  redirect("/meu-perfil");
}
