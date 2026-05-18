import { ReportsPage } from "@/components/modules";
import { requireAdminRoute } from "@/lib/admin-route";

export default async function RelatoriosRoute() {
  await requireAdminRoute();
  return <ReportsPage />;
}
