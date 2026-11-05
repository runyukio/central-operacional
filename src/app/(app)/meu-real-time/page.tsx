import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { MyRealtimePage } from "@/components/my-realtime-page";
import { authOptions } from "@/lib/auth-options";
import { canAccessOwnRealtimeHours } from "@/lib/realtime-hours-permissions";

export default async function MeuRealTimeRoute() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");
  if (!canAccessOwnRealtimeHours({ ...session.user, status: "ACTIVE" })) redirect("/meu-perfil");
  return <MyRealtimePage />;
}
